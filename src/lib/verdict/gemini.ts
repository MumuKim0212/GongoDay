/**
 * Gemini 호출 (ARCHITECTURE §5.1.1)
 *
 * **이 파일은 절대 throw하지 않는다.** 키 누락·전송 실패·비200·본문 없음·JSON 파싱 실패·타임아웃을
 * 전부 `null`로 흡수하고 호출자가 `unclear`로 처리한다 (§5.2). 판정 하나의 실패가 라우트를 무너뜨리면
 * "어떤 실패도 화면을 비우지 않는다"가 깨진다 (§7).
 *
 * 모델은 `gemini-3.5-flash`로 실측 확정했다 (§5.1.2) — 인용검증 100% · 결정론 100% · p95 5.0초.
 */
import { errorMessage, log } from "@/lib/log";

import { SYSTEM_PROMPT, buildUserText } from "./prompt";

/** 5개 모델 실측으로 정했다. 바꾸면 §5.1.2를 다시 재야 한다 — `scripts/model-eval.mts` */
const MODEL = "gemini-3.5-flash";

/** 건당 상한. 10건 병렬이므로 라우트 상한 60초 안에 넉넉히 들어간다 (실측 p95 5.0초) */
const TIMEOUT_MS = 15_000;

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/**
 * `validate.ts`가 어차피 다시 검사한다 — 1단 검증을 모델 쪽에서 미리 걸러주는 장치일 뿐이다 (§7.4).
 *
 * **`scripts/model-eval.mts`가 이걸 가져다 쓴다.** 예전엔 스크립트가 사본을 들고 있었는데,
 * 여기에 `checks`를 추가했을 때 사본이 안 따라와서 실측이 통째로 빈 배열을 재는 사고가 났다.
 */
export const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["eligible", "unclear", "ineligible"] },
    reason: { type: "STRING" },
    quote: { type: "STRING" },
    blockers: { type: "ARRAY", items: { type: "STRING" } },
    checks: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["verdict", "reason", "quote", "blockers", "checks"],
};

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
};

/**
 * 호출 한 번이 실제로 쓴 토큰. **청구는 호출 수가 아니라 토큰으로 매겨지므로** 이 값이 비용이다.
 *
 * 응답에 `usageMetadata`가 없으면 0으로 남긴다 — 추정하지 않는다. 운영 화면에서
 * "호출은 있는데 토큰이 0"이 보이면 모델이 이 필드를 안 준다는 뜻이고, 그건 그것대로 사실이다.
 */
export type Usage = { promptTokens: number; outputTokens: number };

const NO_USAGE: Usage = { promptTokens: 0, outputTokens: 0 };

/**
 * 판정 한 건. 성공하면 파싱된 JSON과 토큰 사용량을, 어떤 이유로든 실패하면 `data: null`을 돌려준다.
 *
 * **실패해도 `usage`는 돌려준다.** 응답을 받고 나서 실패한 경우(파싱 실패)에도 토큰은 이미 청구되기
 * 때문이다 — 실패분을 0으로 세면 장부가 실제 청구보다 작아진다.
 *
 * 반환값을 검증하지 않는다 — 그건 `validateVerdict`의 일이고, 그래야 "모델 출력을 신뢰하지 않는다"가
 * 한 곳에서만 구현된다.
 *
 * ⚠️ **`null`을 돌려줄 때는 반드시 이유를 로그에 남긴다.** 사용자에게는 다섯 갈래가 전부
 * "판정하지 못했습니다" 한 문장으로 뭉개져 나가므로, 키가 없는 것인지·쿼터가 찬 것인지·
 * 느려서 끊긴 것인지 밖에서 구분할 방법이 여기 말고는 없다.
 */
export async function callGemini(
  profileText: string,
  sourceText: string,
): Promise<{ data: unknown | null; usage: Usage }> {
  // env.ts와 달리 여기서는 throw하지 않는다. 키가 없으면 전건 '애매'로 흡수되는 편이 낫다.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // 설정 누락은 재시도로 낫지 않는다. 사람이 손대야 하므로 유일하게 error다.
    log.error("gemini.failed", { reason: "no_api_key" });
    return { data: null, usage: NO_USAGE };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      // 키를 쿼리스트링에 붙이지 않는다 — 로그·리퍼러에 그대로 남는다
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: buildUserText(profileText, sourceText) }] }],
        generationConfig: {
          // 같은 입력에 같은 판정이 나와야 캐시(§5.5)가 의미를 갖는다
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    if (!res.ok) {
      // 429(쿼터)와 5xx(모델 장애)를 가르는 건 status뿐이다. 본문은 키가 섞일 수 있어 넣지 않는다.
      log.warn("gemini.failed", { reason: "http_error", status: res.status });
      return { data: null, usage: NO_USAGE };
    }

    const body = (await res.json()) as GenerateContentResponse;
    // 본문을 받은 뒤로는 어떻게 끝나든 토큰이 청구된 것이다. 아래 두 실패 경로가 이 값을 같이 들고 나간다.
    const usage: Usage = {
      promptTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
    };

    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") {
      // 안전필터에 걸리면 candidates가 비어서 온다 — 200이라 위에서 안 걸린다.
      log.warn("gemini.failed", { reason: "empty_body" });
      return { data: null, usage };
    }

    try {
      return { data: JSON.parse(text), usage };
    } catch (e) {
      // 파싱 실패는 아래 catch로 흘려보내면 토큰을 잃는다 — 이미 청구된 호출이라 여기서 따로 받는다.
      log.warn("gemini.failed", { reason: "parse", message: errorMessage(e) });
      return { data: null, usage };
    }
  } catch (e) {
    // 타임아웃(abort) · 네트워크 오류가 여기로 온다. 응답 본문을 못 받은 경우라 토큰을 알 수 없다.
    // 타임아웃만 따로 세는 이유는 그것만 대책이 다르기 때문이다 — TIMEOUT_MS나 병렬 수를 조정한다.
    const timedOut = e instanceof Error && e.name === "AbortError";
    log.warn("gemini.failed", {
      reason: timedOut ? "timeout" : "network",
      message: errorMessage(e),
    });
    return { data: null, usage: NO_USAGE };
  } finally {
    clearTimeout(timer);
  }
}
