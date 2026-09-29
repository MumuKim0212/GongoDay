/**
 * OpenAI 호출 (gemini.ts와 같은 구조 — ARCHITECTURE §5.1.1)
 *
 * **이 파일은 절대 throw하지 않는다.** 키 누락·전송 실패·비200·본문 없음·JSON 파싱 실패·타임아웃을
 * 전부 `null`로 흡수하고 호출자가 `unclear`로 처리한다 (§5.2). 판정 하나의 실패가 라우트를 무너뜨리면
 * "어떤 실패도 화면을 비우지 않는다"가 깨진다 (§7).
 *
 * `gpt-5.4-mini`로 확정했다 (`scripts/model-eval.mts` 실측) — 인용검증 100% · 규칙 6(§ 프롬프트)
 * 보강 후 결정론 100%(경계 케이스 20회 반복 재현). gemini.ts는 회귀 비교용으로 남겨뒀다.
 * `decide.ts`가 이 파일을 프로덕션 판정 경로로 쓴다.
 */
import { errorMessage, log } from "@/lib/log";

import { SYSTEM_PROMPT, buildUserText } from "./prompt";

const MODEL = "gpt-5.4-mini";

/** 건당 상한. 10건 병렬이므로 라우트 상한 60초 안에 넉넉히 들어간다 */
const TIMEOUT_MS = 15_000;

const ENDPOINT = "https://api.openai.com/v1/chat/completions";

/**
 * gemini.ts의 RESPONSE_SCHEMA와 같은 필드를 요구한다 — validateVerdict가 두 모델의 출력을
 * 같은 형태로 취급하므로 스키마가 갈라지면 안 된다.
 */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["eligible", "unclear", "ineligible"] },
    reason: { type: "string" },
    quote: { type: "string" },
    blockers: { type: "array", items: { type: "string" } },
    checks: { type: "array", items: { type: "string" } },
  },
  required: ["verdict", "reason", "quote", "blockers", "checks"],
  additionalProperties: false,
};

type ChatCompletionResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/** gemini.ts의 Usage와 같은 모양 — decide.ts가 둘을 구분 없이 합산한다 */
export type Usage = { promptTokens: number; outputTokens: number };

const NO_USAGE: Usage = { promptTokens: 0, outputTokens: 0 };

/**
 * 판정 한 건. 성공하면 파싱된 JSON과 토큰 사용량을, 어떤 이유로든 실패하면 `data: null`을 돌려준다.
 *
 * gemini.ts의 callGemini와 동일한 계약이다 — 반환값을 검증하지 않는다(validateVerdict의 일),
 * 실패해도 이미 청구된 토큰은 usage로 돌려준다.
 */
export async function callOpenAI(
  profileText: string,
  sourceText: string,
): Promise<{ data: unknown | null; usage: Usage }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log.error("openai.failed", { reason: "no_api_key" });
    return { data: null, usage: NO_USAGE };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: buildUserText(profileText, sourceText) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "verdict", strict: true, schema: RESPONSE_SCHEMA },
        },
      }),
    });

    if (!res.ok) {
      log.warn("openai.failed", { reason: "http_error", status: res.status });
      return { data: null, usage: NO_USAGE };
    }

    const body = (await res.json()) as ChatCompletionResponse;
    const usage: Usage = {
      promptTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };

    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      log.warn("openai.failed", { reason: "empty_body" });
      return { data: null, usage };
    }

    try {
      return { data: JSON.parse(text), usage };
    } catch (e) {
      log.warn("openai.failed", { reason: "parse", message: errorMessage(e) });
      return { data: null, usage };
    }
  } catch (e) {
    const timedOut = e instanceof Error && e.name === "AbortError";
    log.warn("openai.failed", {
      reason: timedOut ? "timeout" : "network",
      message: errorMessage(e),
    });
    return { data: null, usage: NO_USAGE };
  } finally {
    clearTimeout(timer);
  }
}
