/**
 * 판정 한 건 처리 — `/api/verdicts`와 `/api/notify`가 공유하는 조각만 (ARCHITECTURE §5, §11)
 *
 * 두 라우트는 캐시 조회·저장·통계 집계·응답 형태(스트림 vs 배치 요약)가 서로 달라 그 부분까지
 * 합치지 않는다. 여기 뽑은 것은 "게이트/AI가 정책 하나 + 프로필 하나를 어떻게 `DecidedVerdict`로
 * 바꾸는가"라는, 두 곳에서 토씨 하나 안 틀리고 같아야 하는 부분뿐이다.
 */
import { checkGate, type PolicyConditions, type Profile } from "./gate";
import { callGemini, type Usage } from "./gemini";
import { buildSourceText, type PolicySourceFields } from "./prompt";
import { validateVerdict, type DecidedVerdict } from "./validate";

const GATE_REASON = "입력하신 조건과 맞지 않는 항목이 있습니다.";
const AI_FAILED_REASON = "서버 오류로 적합도 판정에 실패했습니다.";

/** 게이트가 결론냈으면 `DecidedVerdict`, 통과했으면 `null`(= AI로 넘긴다). */
export function applyGate(policy: PolicyConditions, profile: Profile): DecidedVerdict | null {
  const gate = checkGate(policy, profile);
  if (gate.pass) return null;

  return {
    verdict: "ineligible",
    decided_by: "code",
    reason: GATE_REASON,
    quote: null,
    quote_verified: false,
    blockers: gate.blockers,
    checks: [],
  };
}

/**
 * Gemini 호출 → 검증까지. `decided`는 항상 값이 있다 — 호출 자체가 실패해도 `unclear`로 흡수한다.
 * `failed`가 "저장해도 되는 판정인지"를 가른다: true면 판정이 아니라 판정 못 함이라 저장하지 않는다.
 */
export async function callAndValidate(
  profileText: string,
  policy: PolicySourceFields,
): Promise<{ decided: DecidedVerdict; usage: Usage; failed: boolean }> {
  const sourceText = buildSourceText(policy);
  const { data: raw, usage } = await callGemini(profileText, sourceText);

  if (raw === null) {
    return {
      decided: {
        verdict: "unclear",
        decided_by: "ai",
        reason: AI_FAILED_REASON,
        quote: null,
        quote_verified: false,
        blockers: [],
        checks: [],
      },
      usage,
      failed: true,
    };
  }

  const v = validateVerdict(raw, sourceText);
  const decided: DecidedVerdict = {
    verdict: v.verdict,
    decided_by: "ai",
    reason: v.reason,
    quote: v.quote,
    quote_verified: v.quote_verified,
    blockers: v.blockers,
    checks: v.checks,
  };
  return { decided, usage, failed: false };
}
