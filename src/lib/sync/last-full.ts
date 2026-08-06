import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 소스별 마지막 **전량** 갱신 시각 (ISO). 사용자 화면 푸터와 운영 화면이 같이 쓴다.
 *
 * ⚠️ **`last_page = 0`(= 끝까지 받은 실행)만 읽어야 한다.** 수집은 매시간 10페이지씩 끊어 도는데,
 * 그 중간 실행까지 세면 정부24 뒷페이지가 11시간 전 것인데도 화면은 **매시간 "방금 갱신됨"**이라고
 * 말하게 된다.
 *
 * 실패한 실행도 제외한다 — "갱신됨"으로 읽히면 안 된다.
 *
 * `limit`은 완주한 실행만 세므로 넉넉하다. 매시간 트리거 기준으로 온통청년이 하루 8회,
 * 정부24가 하루 2회 완주하니 50건이면 며칠분이다.
 */
export async function lastFullSync(
  db: SupabaseClient,
): Promise<{ youth: string | null; gov24: string | null }> {
  const { data } = await db
    .from("sync_runs")
    .select("source, finished_at")
    .is("error", null)
    .not("finished_at", "is", null)
    .eq("last_page", 0)
    .order("finished_at", { ascending: false })
    .limit(50);

  const out: { youth: string | null; gov24: string | null } = { youth: null, gov24: null };
  for (const r of data ?? []) {
    const key = r.source as "youth" | "gov24";
    if (key in out && out[key] === null) out[key] = r.finished_at as string;
  }
  return out;
}
