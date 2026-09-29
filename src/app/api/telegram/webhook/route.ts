import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendMessage } from "@/lib/telegram/client";

/**
 * 텔레그램 웹훅 수신 — 딥링크 연동의 착지점 (ARCHITECTURE §11)
 *
 * 사용자가 `t.me/<bot>?start=<token>`을 열고 "시작"을 누르면 텔레그램이 `/start <token>`
 * 메시지를 이 라우트로 보낸다. 토큰으로 `telegram_link_tokens`를 찾아 `profiles.telegram_chat_id`를 채운다.
 *
 * **Telegram에는 항상 200으로 응답한다.** 실패해도 200을 주지 않으면 같은 update를 계속
 * 재전송한다 — 실패는 봇 메시지로만 사용자에게 알린다 (§sync.ts의 "화면을 비우지 않는다"와 같은 사고방식).
 */

const START_PATTERN = /^\/start\s+(\S+)/;

export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    log.error("telegram.webhook_rejected", { reason: "no_webhook_secret" });
    return NextResponse.json({ error: "TELEGRAM_WEBHOOK_SECRET이 설정되지 않았습니다." }, { status: 503 });
  }
  if (req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    log.warn("telegram.webhook_rejected", { reason: "bad_secret" });
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  const body: unknown = await req.json().catch(() => null);
  const message = (body as { message?: { text?: string; chat?: { id?: number } } } | null)?.message;
  const text = message?.text;
  const chatId = message?.chat?.id;

  if (typeof text !== "string" || typeof chatId !== "number") {
    // /start가 아닌 다른 update(멤버 변경 등)일 수 있다 — 무시하고 200
    return NextResponse.json({ ok: true });
  }

  const match = START_PATTERN.exec(text);
  if (!match) {
    await sendMessage(String(chatId), "연결 링크를 사이트에서 다시 눌러주세요.");
    return NextResponse.json({ ok: true });
  }

  const token = match[1];
  const db = createAdminClient();

  const { data: tokenRow, error: tokenError } = await db
    .from("telegram_link_tokens")
    .select("profile_id, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (tokenError) {
    log.error("telegram.webhook_lookup_failed", { message: tokenError.message });
    await sendMessage(String(chatId), "연결 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    return NextResponse.json({ ok: true });
  }

  const expired = tokenRow !== null && new Date(tokenRow.expires_at).getTime() < Date.now();
  if (tokenRow === null || tokenRow.used_at !== null || expired) {
    await sendMessage(String(chatId), "연결 링크가 만료되었거나 이미 사용되었습니다. 사이트에서 다시 시도해 주세요.");
    return NextResponse.json({ ok: true });
  }

  // **update가 아니라 upsert다.** 조건을 한 번도 저장하지 않은 계정은 `profiles` 행 자체가 없고
  // (행은 `saveProfile`에서만 생긴다), update는 0행을 고치고도 에러를 주지 않는다 —
  // 토큰만 소비하고 "연결되었습니다"라고 답하는데 실제로는 아무것도 연결되지 않는다.
  const { error: profileError } = await db
    .from("profiles")
    .upsert({ id: tokenRow.profile_id, telegram_chat_id: String(chatId) }, { onConflict: "id" });

  // 이 텔레그램 계정이 이미 다른 계정에 물려 있으면 유니크 인덱스에 걸린다 — 토큰은 소비하지 않는다
  if (profileError) {
    log.error("telegram.webhook_link_failed", { message: profileError.message });
    await sendMessage(
      String(chatId),
      "이 텔레그램 계정은 이미 다른 계정에 연결되어 있습니다. 그쪽에서 연동을 해제한 뒤 다시 시도해 주세요.",
    );
    return NextResponse.json({ ok: true });
  }

  await db.from("telegram_link_tokens").update({ used_at: new Date().toISOString() }).eq("token", token);

  await sendMessage(
    String(chatId),
    "연결되었습니다. 사이트의 내 조건 페이지에서 알림 받을 최소 점수를 설정해 주세요.",
  );

  log.info("telegram.linked", { profileId: tokenRow.profile_id });
  return NextResponse.json({ ok: true });
}
