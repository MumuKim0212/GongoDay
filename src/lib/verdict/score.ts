/**
 * 5단계 점수 (ARCHITECTURE §5.6)
 *
 * **모델이 점수를 매기지 않는다.** 판정값과 `checks`(확인해야 할 항목) 개수에서 유도한다.
 *
 * 모델에게 "4점"을 물으면 그 4가 맞는지 대조할 대상이 원문에 없다. 이 프로젝트가 AI를 신뢰하는
 * 근거는 인용 검증 하나뿐인데(PRD §7.4), 검증할 수 없는 숫자를 카드 맨 앞에 둘 수는 없다.
 * 유도값이면 **"왜 4점인지"를 확인 항목 목록으로 그대로 보여줄 수 있다.**
 *
 * 2점이 3점보다 낮은 이유: 확인할 항목이 둘이라도 **무엇을 확인할지는 아는 상태**라 사용자가 스스로
 * 걸러낼 수 있다. 조건 미기재는 그마저 못 한다. 제한이 없어서 안 적힌 것일 수도 있지만 원문에서
 * 빠진 것일 수도 있어서, 위로 올리면 "지원도 못 하는 공고가 위에 있다"를 다시 만든다 (PRD §1.2).
 */
import type { Verdict } from "./validate";

export type Score = 1 | 2 | 3 | 4 | 5;

export function scoreOf(v: { verdict: Verdict; checks: string[] }): Score {
  if (v.verdict === "eligible") return 5;
  if (v.verdict === "ineligible") return 1;
  if (v.checks.length === 0) return 2;
  return v.checks.length === 1 ? 4 : 3;
}

/** 배지에 들어가는 짧은 말. 3점은 개수가 정보라 숫자를 그대로 쓴다. */
export function scoreLabel(score: Score, checkCount: number): string {
  switch (score) {
    case 5:
      return "신청 가능";
    case 4:
      return "확인 1개";
    case 3:
      return `확인 ${checkCount}개`;
    case 2:
      return "조건 미기재";
    case 1:
      return "아님";
  }
}

/** 점수의 뜻을 한 문장으로. 목록 안내문과 상세 화면이 같은 문장을 쓴다. */
export const SCORE_HINTS: Record<Score, string> = {
  5: "원문 근거로 자격을 충족합니다.",
  4: "아래 한 가지만 확인하면 신청 여부가 갈립니다.",
  3: "아래 항목을 확인해야 신청 여부가 갈립니다.",
  2: "원문에 자격 조건이 적혀 있지 않습니다. 제한이 없어서일 수도, 원문에 빠졌을 수도 있으니 원문을 확인하세요.",
  1: "원문 근거로 자격을 충족하지 않습니다.",
};

/** 판정값의 등급 이름. 배지 툴팁 앞머리에 붙는다. */
export const VERDICT_LABEL: Record<Verdict, string> = {
  eligible: "적합",
  unclear: "애매",
  ineligible: "부적합",
};

/** 배지를 호버·탭했을 때 뜨는 한 줄. 등급 + AI(또는 게이트)가 준 사유 그대로다 — 새로 지어내지 않는다. */
export function scoreHint(verdict: Verdict, reason: string | null, score: Score): string {
  return `${VERDICT_LABEL[verdict]}. ${reason ?? SCORE_HINTS[score]}`;
}
