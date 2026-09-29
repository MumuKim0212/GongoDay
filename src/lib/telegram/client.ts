/**
 * 텔레그램 Bot API 호출 (ARCHITECTURE §11)
 *
 * `gemini.ts`와 같은 원칙 — **이 파일은 절대 throw하지 않는다.** 발송 실패 하나가 알림 배치
 * 전체를 무너뜨리면 안 된다. 실패는 이유와 함께 반환값으로 돌려주고 호출자가 로그를 남긴다.
 */
import { errorMessage } from "@/lib/log";

const TIMEOUT_MS = 5_000;

export type SendResult = { ok: true } | { ok: false; reason: string };

export async function sendMessage(chatId: string, text: string): Promise<SendResult> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return { ok: false, reason: "no_bot_token" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        // 정책명·원문 텍스트를 이어붙인 메시지라 링크 미리보기가 뜬금없는 카드로 뜬다
        disable_web_page_preview: true,
      }),
    });

    if (!res.ok) {
      // 403 = 사용자가 봇을 차단함. 흔한 케이스라 status로 구분해 로그에서 걸러 볼 수 있게 한다.
      return { ok: false, reason: `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "AbortError";
    return { ok: false, reason: timedOut ? "timeout" : `network:${errorMessage(e)}` };
  } finally {
    clearTimeout(timer);
  }
}
