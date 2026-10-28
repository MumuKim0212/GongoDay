import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import * as gov24 from "@/lib/sources/gov24";
import { timestamp, type PolicyInsert } from "@/lib/sources/types";

/**
 * 정부24 증분 수집 — 전량 순회(`run.ts`) 앞에 붙는 **가속 장치**다.
 *
 * 전량 순회는 커서가 그 페이지에 닿아야 새 공고를 넣는다. 정부24는 110페이지라 한 바퀴가
 * 트리거 11번이고, 새 공고가 그만큼 늦게 들어왔다. `serviceList`는 `등록일시`·`수정일시`
 * 범위 조건을 받으므로 **최근에 바뀐 것만 먼저** 받아 다음 트리거 한 번 안에 넣는다.
 *
 * **정합성은 여전히 전량 순회가 책임진다.** 여기서 상한에 걸려 건너뛴 건, 지원조건이 없어 건너뛴 건,
 * 조회 창 밖으로 밀려난 건은 전량 순회가 한 바퀴 안에 다시 받는다. 그래서 이 함수의 실패는
 * 수집 실패가 아니다 — 로그만 남기고 전량 순회는 그대로 돈다.
 */

/**
 * 조회 창 — 지금(KST)부터 3시간 전까지. 트리거는 20분 간격이니 GitHub가 실행을 몇 번 건너뛰어도
 * 창 안에 남는다. 창이 겹쳐 같은 건이 매번 다시 오지만 DB와 대조해 바뀐 것만 처리하므로
 * 비용은 목록 조회 한 번이다.
 *
 * **하루 단위로 잡으면 안 된다.** 정부24는 수정이 잦다 — 어제 0시부터 약 34시간 동안 수정 820건,
 * 신규 0건이었다 (실측). 하루 창이면 상한(아래)에 걸려 증분이 매번 포기된다.
 */
const LOOKBACK_HOURS = 3;

/**
 * 목록이 이보다 많으면 증분을 포기한다. 일괄 수정이 있었던 경우다 — 전량 순회의 몫이다.
 * 3시간 창의 평소 건수는 수십 건이다 (하루 수정 약 580건 기준).
 */
const MAX_LISTED = 500;

/**
 * 한 번에 저장하는 상한. 라우트 상한(60초) 안에서 전량 순회에 시간을 남기려고 둔다.
 * 남은 건은 DB와 여전히 다르므로 다음 트리거가 자연스럽게 이어받는다.
 */
const MAX_UPSERT = 300;

/** upsert 한 번에 보내는 행 수 — 전량 순회의 페이지 크기와 같다 */
const UPSERT_CHUNK = 100;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

type Raw = Record<string, unknown>;

export type IncrementalResult = {
  /** 조회 창 안에서 목록이 돌려준 건수 (두 필드 합집합) */
  listed: number;
  /** 그 중 DB와 달라 저장 대상이 된 건수 */
  changed: number;
  upserted: number;
  /** 지원조건 전량에 없어 이번에 건너뛴 기존 정책 수 (기존 자격 코드를 지우지 않으려고) */
  missingCond: number;
  /** 증분을 통째로 건너뛴 이유. null이면 정상 수행 */
  skipped: string | null;
};

/**
 * 조건 값 — `YYYYMMDDHHmmss`, KST. **odcloud는 이 필드를 문자열로 비교하고**(실측) 원문 값이
 * KST 14자리 문자열이라 같은 꼴이어야 한다. 하이픈 꼴(`2026-10-27`)은 엉뚱한 건을 잔뜩 걸어 온다.
 */
function sinceValue(): string {
  const d = new Date(Date.now() + KST_OFFSET_MS - LOOKBACK_HOURS * 60 * 60 * 1000);
  return d.toISOString().slice(0, 19).replace(/\D/g, "");
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
  const result: IncrementalResult = { listed: 0, changed: 0, upserted: 0, missingCond: 0, skipped: null };
  const since = sinceValue();

  // 두 필드를 따로 묻고 서비스ID로 합친다. 신규 건은 수정일시가 비어 올 수 있다.
  const byId = new Map<string, Raw>();
  for (const field of ["등록일시", "수정일시"] as const) {
    const { items, matchCount } = await gov24.fetchChangedList(field, since, MAX_LISTED);
    if (items === null) {
      result.skipped = `too_many:${field}:${matchCount}`;
      log.warn("sync.incremental_skipped", { source: "gov24", field, since, matchCount, max: MAX_LISTED });
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

  // 지원조건은 **전량을 받아 서비스ID로 맞춘다.** 건별 조회(`cond[서비스ID::EQ]`)는 10건씩만 동시에
  // 불러도 429로 절반이 막혔다 (실측: 100건 중 51건). 전량은 2,000건씩 6번, 수 초다.
  const conds = await gov24.fetchAllConditions();

  const rows: PolicyInsert[] = [];
  const batch = targets.slice(0, MAX_UPSERT);
  for (const svc of batch) {
    const id = String(svc["서비스ID"]).trim();
    const cond = conds.get(id) ?? null;
    // 조건이 없는 **기존** 정책은 저장하지 않는다. 조건 없이 upsert하면 기존 자격 코드가 지워져
    // 게이트가 "조건 없음"으로 통과시킨다. 신규는 조건 없이 넣는다 — 전량 순회의 조인 실패와 같은 처리다.
    if (!cond && stored.has(id)) {
      result.missingCond++;
      continue;
    }
    rows.push(gov24.toPolicy({ svc, cond }));
  }

  const valid = rows.filter((p) => p.external_id);
  for (let i = 0; i < valid.length; i += UPSERT_CHUNK) {
    const chunk = valid.slice(i, i + UPSERT_CHUNK);
    const { error, count } = await db
      .from("policies")
      .upsert(chunk, { onConflict: "source,external_id", count: "exact" });
    if (error) throw new Error(`증분 upsert 실패: ${error.message}`);
    result.upserted += count ?? chunk.length;
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
