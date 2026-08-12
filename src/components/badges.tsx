import { scoreHint, scoreLabel, type Score } from "@/lib/verdict/score";
import type { Verdict } from "@/lib/verdict/validate";

/**
 * 출처 표시 (F-03a · docs/DESIGN.md §4.2)
 *
 * **배지가 아니라 카드 키커다.** 두 소스가 같은 잉크를 쓰고 구분은 글자가 한다 —
 * 소스마다 색을 주면 판정 배지의 시안·마젠타와 경쟁해서 정작 중요한 것이 묻힌다.
 */
export function SourceKicker({ source }: { source: "youth" | "gov24" }) {
  return <span className="card-kicker">{source === "youth" ? "온통청년" : "정부24"}</span>;
}

/**
 * 5단계 점수 배지 (§5.6 · DESIGN.md §4.1)
 *
 * 숫자를 앞에 세우고 뜻을 붙인다 — `4`만 보이면 무슨 척도인지 모르고, `확인 1개`만 보이면
 * 목록에서 순서가 읽히지 않는다. 점수는 모델이 아니라 확인 항목 수에서 나온다 (`lib/verdict/score.ts`).
 *
 * **색조가 아니라 잉크 농도가 서열이다.** 채움은 5점 하나뿐이라 목록에서 "볼 게 있는지"가
 * 한눈에 잡히고, 색을 못 보는 사용자에게도 순서가 남는다. 3점의 마젠타는 "나쁨"이 아니라
 * "여기를 봐야 함"이다 — 4점(시안)과 잉크가 다를 뿐 둘 다 옅다.
 */
const SCORE_TAG: Record<Score, string> = {
  5: "tag-solid",
  4: "tag-accent",
  3: "tag-accent-2",
  2: "tag-neutral",
  1: "tag-quiet",
};

/**
 * 호버·탭하면 등급 + 사유 한 줄이 뜬다. `<button>`이라 탭에서도 포커스를 받는다(iOS는 `<span
 * tabIndex>`를 탭으로 포커스하지 않는다) — 그래서 보이기·숨기기에 JS 없이 `:hover`/`:focus`만 쓴다.
 */
export function ScoreBadge({
  score,
  checkCount,
  verdict,
  reason,
}: {
  score: Score;
  checkCount: number;
  verdict: Verdict;
  reason: string | null;
}) {
  const hint = scoreHint(verdict, reason, score);
  return (
    <button type="button" className={`tag group relative shrink-0 ${SCORE_TAG[score]}`}>
      <span className="tabular-nums font-semibold" aria-hidden>
        {score}점.
      </span>
      <span className="sr-only">5점 만점에 {score}점 — </span>
      {scoreLabel(score, checkCount)}
      <span
        aria-hidden
        className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 w-max max-w-[220px] rounded-sm bg-[var(--ink)] px-2 py-1.5 text-left text-micro whitespace-normal text-[var(--paper)] opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
      >
        {hint}
      </span>
    </button>
  );
}

/**
 * 판정 시도 자체가 실패했을 때 (§7) — AI 호출 실패·타임아웃. **점수가 아니다**, 그래서
 * 1~5점 배지와 다른 잉크(danger)를 쓴다. "조건 미기재"(2점)와 섞이면 사용자가 자기 조건
 * 탓으로 오해한다.
 */
export function ErrorBadge({ reason }: { reason: string | null }) {
  return (
    <button type="button" className="tag group relative shrink-0 tag-danger">
      판정 에러
      <span
        aria-hidden
        className="pointer-events-none absolute top-full right-0 z-20 mt-1.5 w-max max-w-[220px] rounded-sm bg-[var(--ink)] px-2 py-1.5 text-left text-micro whitespace-normal text-[var(--paper)] opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100"
      >
        {reason ?? "서버 오류로 적합도 판정에 실패했습니다."}
      </span>
    </button>
  );
}

/**
 * 판정을 기다리는 동안 배지 자리를 지킨다 — 결과가 도착해도 카드가 튀지 않는다 (§7 · DESIGN.md §4.6)
 *
 * 높이를 숫자로 박지 않고 `.tag`에서 그대로 받는다. 배지의 글자 크기나 패딩이 바뀌어도
 * 자리 크기가 따라오지 않으면 이 컴포넌트의 존재 이유가 사라진다. 안의 문자가 줄 박스를
 * 만들어 실제 배지와 같은 높이를 낸다 — 접근성 이름은 `aria-label`이 준다.
 *
 * **`&nbsp;`여야 한다.** `.tag`가 `inline-flex`라 보통 공백뿐인 텍스트는 익명 플렉스 항목으로
 * 렌더되지 않고(CSS Flexbox §4) 높이가 0으로 무너진다.
 *
 * **낭독에서는 뺀다** (DESIGN.md §6.4). 전에는 `role="status" aria-label="판정 중"`이었는데,
 * 한 화면에 열 장이 동시에 서므로 **같은 말이 열 번 낭독됐다.** 진행 상태는 목록 위 상태 줄
 * 하나가 `aria-live`로 말한다 — 이 자리는 배지가 도착할 때 카드가 튀지 않게 하는 장치일 뿐이다.
 *
 * ⚠️ `animate-pulse`가 이 요소의 유일한 표식으로 남아야 한다 — 검사 스크립트 셋이
 * `article span.animate-pulse`로 스켈레톤을 센다(역할로는 더 이상 찾을 수 없다).
 */
export function VerdictBadgeSkeleton() {
  return (
    <span aria-hidden className="tag tag-neutral w-20 shrink-0 animate-pulse">
      &nbsp;
    </span>
  );
}

export function CategoryBadge({ label }: { label: string }) {
  return <span className="tag tag-neutral">{label}</span>;
}
