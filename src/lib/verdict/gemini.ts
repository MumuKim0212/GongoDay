/**
 * Gemini 호출 (ARCHITECTURE §5.1.1)
 *
 * **이 파일은 절대 throw하지 않는다.** 키 누락·전송 실패·비200·본문 없음·JSON 파싱 실패·타임아웃을
 * 전부 `null`로 흡수하고 호출자가 `unclear`로 처리한다 (§5.2). 판정 하나의 실패가 라우트를 무너뜨리면
 * "어떤 실패도 화면을 비우지 않는다"가 깨진다 (§7).
 *
 * 모델은 `gemini-3.5-flash`로 실측 확정했다 (§5.1.2) — 인용검증 100% · 결정론 100% · p95 5.0초.
 */
import { SYSTEM_PROMPT, buildUserText } from "./prompt";

/** 5개 모델 실측으로 정했다. 바꾸면 §5.1.2를 다시 재야 한다 — `scripts/model-eval.mts` */
const MODEL = "gemini-3.5-flash";

/** 건당 상한. 10건 병렬이므로 라우트 상한 60초 안에 넉넉히 들어간다 (실측 p95 5.0초) */
const TIMEOUT_MS = 15_000;

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

/** `validate.ts`가 어차피 다시 검사한다 — 1단 검증을 모델 쪽에서 미리 걸러주는 장치일 뿐이다 (§7.4) */
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["eligible", "unclear", "ineligible"] },
    reason: { type: "STRING" },
    quote: { type: "STRING" },
    blockers: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["verdict", "reason", "quote", "blockers"],
};

type GenerateContentResponse = {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
};

/**
 * 판정 한 건. 성공하면 파싱된 JSON을, 어떤 이유로든 실패하면 `null`을 돌려준다.
 *
 * 반환값을 검증하지 않는다 — 그건 `validateVerdict`의 일이고, 그래야 "모델 출력을 신뢰하지 않는다"가
 * 한 곳에서만 구현된다.
 */
export async function callGemini(profileText: string, sourceText: string): Promise<unknown | null> {
  // env.ts와 달리 여기서는 throw하지 않는다. 키가 없으면 전건 '애매'로 흡수되는 편이 낫다.
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

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

    if (!res.ok) return null;

    const body = (await res.json()) as GenerateContentResponse;
    const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") return null;

    return JSON.parse(text);
  } catch {
    // 타임아웃(abort) · 네트워크 오류 · JSON 파싱 실패가 모두 여기로 온다
    return null;
  } finally {
    clearTimeout(timer);
  }
}
