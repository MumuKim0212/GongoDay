/**
 * AI 응답 3단 검증 (ARCHITECTURE §5.2, PRD §7.4)
 *
 * 모델 출력을 신뢰하지 않는다. 실패는 예외가 아니라 `unclear`라는 정상 상태로 흡수한다.
 * 2단(인용 대조)이 핵심 방어다 — AI가 자격 요건을 지어내면 그 문장은 원문에 없으므로 문자열 대조로 잡힌다.
 */
import { locateQuote } from "./normalize";

export type Verdict = "eligible" | "unclear" | "ineligible";

export type ValidatedVerdict = {
  verdict: Verdict;
  reason: string;
  /** 검증을 통과한 인용만 남긴다 */
  quote: string | null;
  quote_verified: boolean;
  blockers: string[];
  /** 원문(sourceText) 기준 하이라이트 구간 (§5.4) */
  highlight: { start: number; end: number } | null;
};

/**
 * 확정된 판정 한 건 — `verdicts` 행이자 판정 API의 응답이자 카드가 그리는 모양이다 (§2.3).
 *
 * 셋을 한 타입으로 묶는다. 모양이 갈라지면 저장된 판정과 방금 받은 판정이 화면에서 다르게 보인다.
 */
export type DecidedVerdict = {
  verdict: Verdict;
  /** 코드 게이트가 확정했는가, AI가 판정했는가 (F-11b) */
  decided_by: "code" | "ai";
  reason: string | null;
  quote: string | null;
  quote_verified: boolean;
  blockers: string[];
};

const VERDICTS: string[] = ["eligible", "unclear", "ineligible"];

/** 배지 아래 한 문장으로 들어간다 */
const REASON_MAX = 200;

const UNREADABLE = "판정 결과를 읽지 못했습니다.";
const QUOTE_NOT_FOUND = "근거를 원문에서 찾지 못했습니다.";

export function validateVerdict(raw: unknown, sourceText: string): ValidatedVerdict {
  // 1단 — 형태. responseSchema가 대부분 사전 차단하지만 서버가 모델을 신뢰하지 않는다 (PRD §7.4)
  if (typeof raw !== "object" || raw === null) return unclear(UNREADABLE);

  const fields = raw as Record<string, unknown>;
  if (typeof fields.verdict !== "string" || !VERDICTS.includes(fields.verdict)) {
    return unclear(UNREADABLE);
  }

  const verdict = fields.verdict as Verdict;
  // 3단 — 제어문자 제거 + 길이 상한. 잘라내고 통과시킨다
  const reason = sanitize(fields.reason);
  const blockers = toStringArray(fields.blockers).map(sanitize).filter((b) => b.length > 0);
  const quote =
    typeof fields.quote === "string" && fields.quote.trim().length > 0 ? fields.quote : null;

  // 2단 — 인용이 원문에 문자 그대로 있는가
  const highlight = quote === null ? null : locateQuote(sourceText, quote);
  if (highlight === null) {
    // 인용 없이 unclear를 낸 것은 "모르겠다"는 정상 응답이다 — 그 이유는 살린다
    const saidUnclear = verdict === "unclear" && quote === null && reason.length > 0;
    return {
      verdict: "unclear",
      reason: saidUnclear ? reason : QUOTE_NOT_FOUND,
      quote: null,
      quote_verified: false,
      blockers,
      highlight: null,
    };
  }

  return { verdict, reason, quote, quote_verified: true, blockers, highlight };
}

function unclear(reason: string): ValidatedVerdict {
  return {
    verdict: "unclear",
    reason,
    quote: null,
    quote_verified: false,
    blockers: [],
    highlight: null,
  };
}

function sanitize(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = Array.from(value, (ch) => (ch < " " || ch === "\u007f" ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > REASON_MAX ? `${text.slice(0, REASON_MAX)}…` : text;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}
