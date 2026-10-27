import type { SupabaseClient } from "@supabase/supabase-js";

import { errorMessage, log } from "@/lib/log";
import * as gov24 from "@/lib/sources/gov24";
import { timestamp, type PolicyInsert } from "@/lib/sources/types";

/**
 * 정부24 증분 수집 — 전량 순회(`run.ts`) 앞에 붙는 **가속 장치**다.
 *
 * 전량 순회는 커서가 그 페이지에 닿아야 새 공고를 넣는다. 정부24는 110페이지라 한 바퀴가
 * 트리거 11번이고, 새 공고가 그만큼 늦게 들어왔다. `serviceList`는 `등록일시`·`수정일시`
 * 범위 조건을 받으므로 **최근에 바뀐 것만 먼저** 받아 다음 트리거 한 번 안에 넣는다.
 *
 * **정합성은 여전히 전량 순회가 책임진다.** 여기서 상한에 걸려 건너뛴 건, 조건 조회가 실패한 건,
 * 조회 창 밖으로 밀려난 건은 전량 순회가 한 바퀴 안에 다시 받는다. 그래서 이 함수의 실패는
 * 수집 실패가 아니다 — 로그만 남기고 전량 순회는 그대로 돈다.
 */

/**
 * 조회 창 — 어제(KST) 0시부터. 날짜 단위로 묻고, 트리거가 몇 시간 밀려도 창 안에 남도록 하루를 더 본다.
 * 창이 겹쳐 같은 건이 매번 다시 오지만 DB와 대조해 바뀐 것만 처리하므로 비용은 목록 조회뿐이다.
 */
const LOOKBACK_DAYS = 1;

/**
 * 목록이 이보다 많으면 증분을 포기한다. 일괄 수정이 있었거나, 조건이 무시돼 전량이 돌아온 경우다
 * (전량은 10,964건이라 확실히 걸린다). 어느 쪽이든 전량 순회의 몫이다.
 */
const MAX_LISTED = 500;

/**
 * 한 번에 저장하는 상한. 건마다 `supportConditions`를 따로 부르므로 라우트 상한(60초)을 지키려고 둔다.
 * 남은 건은 DB와 여전히 다르므로 다음 트리거가 자연스럽게 이어받는다.
 */
const MAX_UPSERT = 100;

/** 조건 조회 동시 호출 수 */
const COND_CONCURRENCY = 10;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

type Raw = Record<string, unknown>;

export type IncrementalResult = {
  /** 조회 창 안에서 목록이 돌려준 건수 (두 필드 합집합) */
  listed: number;
  /** 그 중 DB와 달라 저장 대상이 된 건수 */
  changed: number;
  upserted: number;
  /** 조건 조회에 실패해 이번에 건너뛴 건수 */
  failed: number;
  /** 증분을 통째로 건너뛴 이유. null이면 정상 수행 */
  skipped: string | null;
};

/**
 * 조건 값의 모양을 원문에 맞춘다. `등록일시`는 `"20260727"`·`"2026-07-27 09:30:00"` 꼴이 섞여 온다
 * (`types.ts` `timestamp`) — odcloud가 문자열로 비교하는지 날짜로 비교하는지 명세에 없어서,
 * DB에 저장된 원문 한 건의 모양을 그대로 따른다.
 */
function sinceValue(sample: string): string {
  const d = new Date(Date.now() + KST_OFFSET_MS);
  d.setUTCDate(d.getUTCDate() - LOOKBACK_DAYS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return /^\d{4}-\d{2}-\d{2}/.test(sample) ? `${y}-${m}-${day}` : `${y}${m}${day}`;
}

/** 원문 날짜 표본 — 가장 최근에 수정된 정부24 정책 하나의 `raw.svc.수정일시`. */
async function dateSample(db: SupabaseClient): Promise<string> {
  const { data } = await db
    .from("policies")
    .select("raw")
    .eq("source", "gov24")
    .not("source_updated_at", "is", null)
    .order("source_updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const svc = (data?.raw as { svc?: Raw } | undefined)?.svc;
  return String(svc?.["수정일시"] ?? svc?.["등록일시"] ?? "");
}

/** 같은 시각인가. DB는 `+00:00`, `timestamp()`는 `Z`로 돌려주므로 문자열로 비교하지 않는다. */
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return Date.parse(a) === Date.parse(b);
}

/** DB에 있는 정부24 정책의 `source_updated_at`. URL 길이 때문에 200개씩 묻는다. */
async function storedUpdatedAt(db: SupabaseClient, ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from("policies")
      .select("external_id, source_updated_at")
      .eq("source", "gov24")
      .in("external_id", ids.slice(i, i + 200));
    if (error) throw new Error(`기존 정책 조회 실패: ${error.message}`);
    for (const r of data ?? []) out.set(r.external_id as string, r.source_updated_at as string | null);
  }
  return out;
}

export async function syncGov24Changes(db: SupabaseClient): Promise<IncrementalResult> {
  const result: IncrementalResult = { listed: 0, changed: 0, upserted: 0, failed: 0, skipped: null };
  const since = sinceValue(await dateSample(db));

  // 두 필드를 따로 묻고 서비스ID로 합친다. 신규 건은 수정일시가 비어 올 수 있다.
  const byId = new Map<string, Raw>();
  for (const field of ["등록일시", "수정일시"] as const) {
    const { items, totalCount } = await gov24.fetchChangedList(field, since, MAX_LISTED);
    if (items === null) {
      result.skipped = `too_many:${field}:${totalCount}`;
      log.warn("sync.incremental_skipped", { source: "gov24", field, since, totalCount, max: MAX_LISTED });
      return result;
    }
    for (const svc of items) {
      const id = String(svc["서비스ID"] ?? "").trim();
      if (id) byId.set(id, svc);
    }
  }
  result.listed = byId.size;
  if (byId.size === 0) return result;

  // 바뀐 것만 남긴다. **DB에 없는 것(신규)을 앞에 둔다** — 상한에 걸리면 기다리는 쪽은 신규다.
  const stored = await storedUpdatedAt(db, [...byId.keys()]);
  const fresh: Raw[] = [];
  const modified: Raw[] = [];
  for (const [id, svc] of byId) {
    if (!stored.has(id)) fresh.push(svc);
    else if (!sameInstant(stored.get(id) ?? null, timestamp(svc["수정일시"]))) modified.push(svc);
  }
  const targets = [...fresh, ...modified];
  result.changed = targets.length;
  if (targets.length === 0) return result;

  const rows: PolicyInsert[] = [];
  const batch = targets.slice(0, MAX_UPSERT);
  for (let i = 0; i < batch.length; i += COND_CONCURRENCY) {
    const settled = await Promise.allSettled(
      batch.slice(i, i + COND_CONCURRENCY).map(async (svc) => {
        const cond = await gov24.fetchConditions(String(svc["서비스ID"]));
        return gov24.toPolicy({ svc, cond });
      }),
    );
    for (const s of settled) {
      // 조건 조회가 실패한 건은 **저장하지 않는다.** 조건 없이 upsert하면 기존 자격 코드가 지워져
      // 게이트가 "조건 없음"으로 통과시킨다. 다음 트리거나 전량 순회가 다시 받는다.
      if (s.status === "fulfilled") rows.push(s.value);
      else {
        result.failed++;
        log.warn("sync.incremental_cond_failed", { source: "gov24", message: errorMessage(s.reason) });
      }
    }
  }

  const valid = rows.filter((p) => p.external_id);
  if (valid.length > 0) {
    const { error, count } = await db
      .from("policies")
      .upsert(valid, { onConflict: "source,external_id", count: "exact" });
    if (error) throw new Error(`증분 upsert 실패: ${error.message}`);
    result.upserted = count ?? valid.length;
  }

  log.info("sync.incremental", {
    source: "gov24",
    since,
    ...result,
    fresh: fresh.length,
    deferred: targets.length - batch.length,
  });
  return result;
}
