import { createAdminClient } from "@/lib/supabase/admin";
import * as gov24 from "@/lib/sources/gov24";
import * as youth from "@/lib/sources/youth";
import type { PolicyInsert } from "@/lib/sources/types";

/**
 * 수집 1회분 (ARCHITECTURE §4).
 *
 * 부르는 곳이 둘이라 라우트에서 빼냈다 — 매시간 크론(`POST /api/sync`)과
 * 운영자 갱신 버튼(admin 서버 액션)이다. 버튼이 라우트를 거치지 않는 이유는
 * `CRON_SECRET`을 브라우저로 내려보내지 않기 위해서다.
 */

const PAGE_SIZE = 100;

/**
 * 한 번에 받는 페이지 수. 라우트 상한(60초) 안에 들어가야 한다.
 *
 * 전량은 한 번에 안 끝난다 — 온통청년 27페이지(3회), 정부24 110페이지(11회).
 * `last_page`로 이어받으므로 **매시간 트리거가 몇 시간에 걸쳐 한 바퀴를 채운다.**
 */
const PAGES_PER_CALL = 10;

// 소스별 분기는 여기서 끝난다. 판정 로직은 소스를 모른다 (PRD §7.1).
const SOURCES = { youth, gov24 };
export type SourceName = keyof typeof SOURCES;

export function isSourceName(v: unknown): v is SourceName {
  return typeof v === "string" && v in SOURCES;
}

export type SyncResult = {
  source: string;
  fetched: number;
  upserted: number;
  joinMisses: number;
  nextPage: number;
  lastCompleted: number;
  totalPages: number;
  /** 전량을 끝까지 받았는가. 다음 트리거는 1페이지부터 다시 훑는다 */
  done: boolean;
  error: string | null;
};

/** 호출 전에 걸러진 요청. 수집을 시도하지 않았으므로 건수는 전부 0이다. */
export function syncRejected(source: string, error: string): SyncResult {
  return {
    source,
    fetched: 0,
    upserted: 0,
    joinMisses: 0,
    nextPage: 0,
    lastCompleted: 0,
    totalPages: 0,
    done: false,
    error,
  };
}

/**
 * 지수 백오프 재시도. 온통청년 전량 수집 중 **HTTP 500이 1회** 발생했다(14페이지).
 * 한 페이지 실패가 전체 수집을 중단시켜서는 안 된다 (§4 / 검증기록 §7.6).
 */
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

export async function runSync(source: SourceName): Promise<SyncResult> {
  const mod = SOURCES[source];
  const db = createAdminClient();

  // 이어받기: 직전 실행이 끝까지 못 갔으면 그 다음 페이지부터 (§4).
  const { data: prev } = await db
    .from("sync_runs")
    .select("last_page, finished_at")
    .eq("source", source)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: run } = await db
    .from("sync_runs")
    .insert({ source, last_page: prev?.last_page ?? 0 })
    .select("id")
    .single();

  let page = (prev?.last_page ?? 0) + 1;
  // 실제로 upsert까지 끝낸 페이지. `page`는 '다음에 받을 페이지'라 이어받기 기준으로 쓰면
  // 루프가 정상 종료했을 때 한 페이지가 통째로 건너뛰어진다.
  let lastCompleted = prev?.last_page ?? 0;
  let fetched = 0;
  let upserted = 0;
  let joinMisses = 0;
  let totalPages = 0;
  let done = false;
  let error: string | null = null;

  try {
    for (let n = 0; n < PAGES_PER_CALL; n++) {
      // 두 소스를 공통 인터페이스로 묶지 않아서(PRD §9.4) 반환 타입이 union이다.
      // gov24만 joinMisses를 준다.
      const res: { items: unknown[]; totalCount: number; joinMisses?: number } = await withRetry(
        () => mod.fetchPage(page, PAGE_SIZE),
      );
      totalPages = Math.ceil(res.totalCount / PAGE_SIZE);
      joinMisses += res.joinMisses ?? 0;
      fetched += res.items.length;

      if (res.items.length > 0) {
        // toPolicy는 throw하지 않는다. external_id가 빈 건만 걸러낸다.
        const rows = (res.items as unknown[])
          .map((it) => mod.toPolicy(it) as PolicyInsert)
          .filter((p) => p.external_id);

        const { error: upsertError, count } = await db
          .from("policies")
          .upsert(rows, { onConflict: "source,external_id", count: "exact" });
        if (upsertError) throw new Error(`upsert 실패: ${upsertError.message}`);
        upserted += count ?? rows.length;
      }

      lastCompleted = page;

      if (res.items.length < PAGE_SIZE || page >= totalPages) {
        done = true;
        break;
      }
      page++;
    }
  } catch (e) {
    // 실패한 페이지는 lastCompleted에 반영되지 않으므로 다음 호출이 그 페이지부터 다시 받는다.
    error = e instanceof Error ? e.message : String(e);
  }

  // 끝까지 갔으면 0으로 되돌린다 — 다음 트리거는 1페이지부터 다시 훑는다.
  // 화면의 "마지막 갱신"은 이 값이 0인 실행만 읽는다 (app/page.tsx `fetchLastSync`).
  const lastPage = done ? 0 : lastCompleted;

  if (run) {
    await db
      .from("sync_runs")
      .update({
        finished_at: new Date().toISOString(),
        last_page: lastPage,
        fetched_count: fetched,
        upserted_count: upserted,
        error,
      })
      .eq("id", run.id);
  }

  return { source, fetched, upserted, joinMisses, nextPage: lastPage + 1, lastCompleted, totalPages, done, error };
}
