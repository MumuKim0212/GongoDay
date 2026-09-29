import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 운영 로그 정리 배치 — **하루 1회 크론 전용** (`.github/workflows/sync.yml`).
 *
 * `verdict_runs` · `notify_runs` · `sync_runs`는 실행마다 한 행씩 쌓이는 순수 장부라
 * 무한히 늘어난다. `RETENTION_DAYS`보다 오래된 행을 지운다.
 *
 * `policies` / `verdicts`는 대상이 아니다 — 서비스가 보여주는 데이터라 삭제 기준을
 * 여기서 시간만으로 정할 수 없다.
 */

// 빼먹으면 로컬은 되고 배포에서만 끊긴다 (§4, §5.1.1과 같은 이유).
export const maxDuration = 60;

const RETENTION_DAYS = 90;

// sync_runs만 시각 칸 이름이 started_at이다 (schema.sql 참고).
const TABLES = [
  { name: "verdict_runs", column: "created_at" },
  { name: "notify_runs", column: "created_at" },
  { name: "sync_runs", column: "started_at" },
] as const;

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("cleanup.rejected", { reason: "no_cron_secret" });
    return NextResponse.json({ error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    log.warn("cleanup.rejected", { reason: "bad_auth" });
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  const db = createAdminClient();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const deleted: Record<string, number> = {};
  for (const { name, column } of TABLES) {
    const { error, count } = await db
      .from(name)
      .delete({ count: "exact" })
      .lt(column, cutoff);
    if (error) {
      log.error("cleanup.delete_failed", { table: name, message: error.message });
      continue;
    }
    deleted[name] = count ?? 0;
  }

  log.info("cleanup.done", { cutoff, deleted });
  return NextResponse.json({ cutoff, deleted });
}
