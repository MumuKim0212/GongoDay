import { errorMessage, log } from "@/lib/log";
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

/**
 * 누가 돌렸는가. **로그에만 쓴다** — 수집 동작은 둘이 똑같다.
 *
 * 이 값이 없으면 로그에서 "매시간 크론이 도는 중"과 "운영자가 버튼을 눌렀다"가 구분되지 않는다.
 * 갑자기 호출이 몰릴 때 원인을 가리는 유일한 단서다.
 */
export type SyncTrigger = "cron" | "admin";

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
async function withRetry<T>(
  ctx: { source: string; page: number },
  fn: () => Promise<T>,
  tries = 4,
): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      // 재시도가 삼킨 실패다. 안 남기면 소스가 흔들려도 "가끔 수집이 느리다"로만 보인다 —
      // 마지막 시도까지 실패해야 비로소 드러나는데, 그때는 이미 원인을 되짚을 수 없다.
      log.warn("sync.retry", { ...ctx, attempt: i + 1, tries, message: errorMessage(e) });
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

export async function runSync(source: SourceName, trigger: SyncTrigger): Promise<SyncResult> {
  const mod = SOURCES[source];
  const db = createAdminClient();
  const startedAt = Date.now();

  // 이어받기: 직전 실행이 끝까지 못 갔으면 그 다음 페이지부터 (§4).
  const { data: prev } = await db
    .from("sync_runs")
    .select("last_page, finished_at")
    .eq("source", source)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: run, error: runError } = await db
    .from("sync_runs")
    .insert({ source, last_page: prev?.last_page ?? 0 })
    .select("id")
    .single();

  // 실행 행이 없으면 아래 update가 통째로 건너뛰어진다 — 이어받기 기준(`last_page`)도,
  // 화면의 "마지막 갱신"도 갱신되지 않는다. **수집은 계속 도는데 진행이 안 쌓이는** 상태라
  // 밖에서는 "몇 시간째 같은 자리"로만 보인다. 사람이 손대야 하므로 error다.
  if (runError) log.error("sync.run_row_failed", { source, trigger, message: runError.message });

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

  log.info("sync.start", { source, trigger, fromPage: page });

  try {
    for (let n = 0; n < PAGES_PER_CALL; n++) {
      // 두 소스를 공통 인터페이스로 묶지 않아서(PRD §9.4) 반환 타입이 union이다.
      // gov24만 joinMisses를 준다.
      const res: { items: unknown[]; totalCount: number; joinMisses?: number } = await withRetry(
        { source, page },
        () => mod.fetchPage(page, PAGE_SIZE),
      );
      totalPages = Math.ceil(res.totalCount / PAGE_SIZE);
      joinMisses += res.joinMisses ?? 0;
      fetched += res.items.length;

      let saved = 0;
      if (res.items.length > 0) {
        // toPolicy는 throw하지 않는다. external_id가 빈 건만 걸러낸다.
        const rows = (res.items as unknown[])
          .map((it) => mod.toPolicy(it) as PolicyInsert)
          .filter((p) => p.external_id);

        const { error: upsertError, count } = await db
          .from("policies")
          .upsert(rows, { onConflict: "source,external_id", count: "exact" });
        if (upsertError) throw new Error(`upsert 실패: ${upsertError.message}`);
        saved = count ?? rows.length;
        upserted += saved;
      }

      lastCompleted = page;

      // **페이지마다 남긴다.** 한 번에 최대 10페이지를 도는데 라우트 상한(60초)에 걸려 잘리면
      // 아래 `sync.done`이 아예 안 나온다 — 그때 어디까지 갔는지 말해주는 건 이 줄뿐이다.
      log.info("sync.page", { source, trigger, page, totalPages, fetched: res.items.length, upserted: saved });

      if (res.items.length < PAGE_SIZE || page >= totalPages) {
        done = true;
        break;
      }
      page++;
    }
  } catch (e) {
    // 실패한 페이지는 lastCompleted에 반영되지 않으므로 다음 호출이 그 페이지부터 다시 받는다.
    error = errorMessage(e);
    // `sync_runs.error`에도 남지만 그건 **행이 만들어졌을 때만**이다. 여기 한 줄은 항상 남는다.
    log.error("sync.failed", { source, trigger, page, fetched, upserted, message: error });
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

  // 한 바퀴의 요약 한 줄. **성공·실패와 무관하게 항상 나간다** — 이 줄이 없는 실행은
  // 중간에 잘린 실행이라는 뜻이고, 그 자체가 신호다 (라우트 상한 60초).
  log.info("sync.done", {
    source,
    trigger,
    fetched,
    upserted,
    joinMisses,
    lastCompleted,
    totalPages,
    done,
    durationMs: Date.now() - startedAt,
    error,
  });

  return { source, fetched, upserted, joinMisses, nextPage: lastPage + 1, lastCompleted, totalPages, done, error };
}
