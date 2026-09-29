import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { isSourceName, runSync } from "@/lib/sync/run";

/**
 * 수집 트리거 — **매시간 크론 전용** (`.github/workflows/sync.yml`).
 *
 * Vercel Hobby 크론은 하루 1회까지라(`0 * * * *`는 배포가 실패한다) 트리거를 GitHub Actions에 둔다.
 * 한 번에 10페이지씩이라 정부24 한 바퀴는 11시간에 걸쳐 채워진다 — 어디서 끊기든
 * `last_page`가 남고 다음 정각이 이어받으므로 체인이나 감시 장치가 필요 없다.
 *
 * **인증이 없으면 누구나 두 소스 수집을 계속 돌릴 수 있다** — 공공 API 키 쿼터가 그대로 탄다.
 * 운영자용 갱신 버튼은 이 라우트를 거치지 않는다 (admin 서버 액션이 `runSync`를 직접 부른다).
 */

// 빼먹으면 로컬은 되고 배포에서만 끊긴다 (§4).
export const maxDuration = 60;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  // 값이 없을 때 통과시키면 "잠근 줄 알았는데 열려 있는" 상태가 된다 (admin `access.ts`와 같은 판단).
  if (!secret) {
    log.error("sync.rejected", { reason: "no_cron_secret" });
    return NextResponse.json({ error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    // **거절은 조용히 지나가면 안 된다.** 크론이 막히면 증상은 "수집이 안 된다"뿐이고,
    // 시크릿이 어긋난 것인지 GitHub 스케줄이 꺼진 것인지(워크플로 주석 참고) 이 줄로만 갈린다.
    log.warn("sync.rejected", { reason: "bad_auth" });
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => ({}));
  const source = (body as { source?: unknown }).source;
  if (!isSourceName(source)) {
    log.warn("sync.rejected", { reason: "bad_source", source: String(source) });
    return NextResponse.json({ error: "source는 youth 또는 gov24" }, { status: 400 });
  }

  const result = await runSync(source, "cron");
  return NextResponse.json(result, { status: result.error ? 500 : 200 });
}
