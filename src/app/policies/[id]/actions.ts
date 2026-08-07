"use server";

import { revalidatePath } from "next/cache";

import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

/**
 * 스크랩 토글 (F-20, ARCHITECTURE §6.2)
 *
 * 본인 행만 쓴다 — `user_id`를 세션 값으로 고정하고 RLS가 한 번 더 막는다 (§2.5).
 * 폼 제출 하나로 끝나므로 클라이언트 자바스크립트가 없다.
 */
export async function toggleScrap(formData: FormData): Promise<void> {
  const policyId = String(formData.get("policy_id") ?? "");
  const on = formData.get("scrapped") === "1";
  if (!policyId) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 익명 세션 생성 실패 (§7). 화면에서 이미 버튼 대신 안내를 띄우지만, 폼을 우회한 요청도 여기로 온다.
  if (!user) return;

  // 쓰기가 실패하면 버튼 상태가 그대로 남는다 — 거짓으로 "스크랩됨"이 되지 않으므로 그대로 둔다.
  // 화면이 사실을 말하는 쪽이라 별도의 오류 표시를 위해 클라이언트 상태를 들이지 않는다.
  let result;
  if (on) {
    result = await supabase.from("scraps").delete().eq("user_id", user.id).eq("policy_id", policyId);
  } else {
    // 이미 있으면 그대로 둔다 — 두 번 눌러 들어온 요청이 오류가 되면 안 된다.
    result = await supabase
      .from("scraps")
      .upsert({ user_id: user.id, policy_id: policyId }, { onConflict: "user_id,policy_id" });
  }

  // 화면에 아무 표시도 하지 않기로 한 실패다(위 주석). 그래서 **로그가 유일한 흔적이다** —
  // "스크랩이 안 눌린다"는 제보가 와도 여기가 비어 있으면 확인할 방법이 없다.
  if (result.error) log.error("scrap.write_failed", { scrapped: on, message: result.error.message });

  revalidatePath(`/policies/${policyId}`);

  // **목록도 이 값을 읽는다** — '스크랩만 보기'가 켜져 있으면 조회 대상 자체가 스크랩 목록이다.
  // 상세에서 해제하고 뒤로 돌아가면 클라이언트 캐시의 옛 목록이 그대로 나오므로(§5.2 되돌아가기)
  // 여기서 그 항목을 버린다. 스크랩을 눌렀을 때만 무효화되니 왕복은 값이 바뀐 경우로 한정된다.
  revalidatePath("/");
}
