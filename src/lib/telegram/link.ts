import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 텔레그램 딥링크 연동 (ARCHITECTURE §11)
 *
 * `t.me/<bot>?start=<token>` 형태로 사용자를 텔레그램 앱으로 보내고, 봇이 받은 `/start <token>`
 * 메시지를 웹훅(`api/telegram/webhook`)이 이 토큰으로 되짚어 `profiles.telegram_chat_id`를 채운다.
 * 사용자가 chat id를 직접 알아내거나 입력할 필요가 없다.
 *
 * `telegram_link_tokens`는 클라이언트 write 정책이 없다(§2.5와 같은 이유 — verdicts처럼
 * service_role 전용). 발급도 소비(웹훅)도 admin 클라이언트로 한다. 대신 호출자가 `profileId`를
 * 세션에서 직접 확인한 뒤 넘겨야 한다 — 여기서는 RLS가 대신 막아주지 않는다.
 */

const TOKEN_TTL_MS = 10 * 60 * 1000;

export async function createLinkToken(
  profileId: string,
): Promise<{ token: string } | { error: string }> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

  const { error } = await createAdminClient()
    .from("telegram_link_tokens")
    .insert({ token, profile_id: profileId, expires_at: expiresAt });

  if (error) return { error: error.message };
  return { token };
}

export function buildDeepLink(token: string): string {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  return `https://t.me/${username}?start=${token}`;
}
