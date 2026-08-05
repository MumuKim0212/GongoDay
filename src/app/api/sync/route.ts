import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import * as gov24 from "@/lib/sources/gov24";
import * as youth from "@/lib/sources/youth";
import type { PolicyInsert } from "@/lib/sources/types";

// 빼먹으면 로컬은 되고 배포에서만 끊긴다 (§4).
export const maxDuration = 60;

const PAGE_SIZE = 100;
const PAGES_PER_CALL = 10;

// 소스별 분기는 여기서 끝난다. 판정 로직은 소스를 모른다 (PRD §7.1).
const SOURCES = { youth, gov24 };
type SourceName = keyof typeof SOURCES;

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

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const source = (body as { source?: string }).source as SourceName;
  if (!SOURCES[source]) {
    return NextResponse.json({ error: "source는 youth 또는 gov24" }, { status: 400 });
  }

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

  // 끝까지 갔으면 0으로 되돌린다 — 다음 '갱신'은 1페이지부터 다시 훑는다.
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

  return NextResponse.json(
    { source, fetched, upserted, joinMisses, nextPage: lastPage + 1, lastCompleted, totalPages, done, error },
    { status: error ? 500 : 200 },
  );
}
