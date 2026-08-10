"use server";

import { isAdminAllowed } from "@/lib/admin/access";
import { log } from "@/lib/log";
import { isSourceName, runSync, syncRejected, type SyncResult } from "@/lib/sync/run";

/**
 * 운영자용 수동 갱신 (F-05).
 *
 * 평소 수집은 매시간 크론이 한다. 이 버튼은 **지금 당장 한 바퀴 더 돌릴 때**만 쓴다 —
 * 그래서 사용자 화면이 아니라 운영 화면에 있다.
 *
 * 라우트(`POST /api/sync`)를 부르지 않고 `runSync`를 직접 부른다. 라우트를 부르려면
 * `CRON_SECRET`이 필요한데, 그 값을 브라우저까지 내려보내면 잠근 의미가 없다.
 */
export async function syncAction(slug: string[] | undefined, source: string): Promise<SyncResult> {
  // 화면이 이미 slug로 걸러지지만 **서버 액션은 화면과 따로 호출될 수 있다.** 여기서 다시 본다.
  // 그 우회 호출이 실제로 오는지는 이 로그로만 알 수 있다 — 화면에는 흔적이 남지 않는다.
  if (!isAdminAllowed(slug)) {
    log.warn("sync.rejected", { reason: "forbidden", trigger: "admin", source });
    return syncRejected(source, "권한이 없습니다.");
  }
  if (!isSourceName(source)) {
    log.warn("sync.rejected", { reason: "bad_source", trigger: "admin", source });
    return syncRejected(source, "source는 youth 또는 gov24");
  }

  return runSync(source, "admin");
}
