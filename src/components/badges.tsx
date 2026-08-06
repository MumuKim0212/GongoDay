import { SCORE_HINTS, scoreLabel, type Score } from "@/lib/verdict/score";

/** 두 소스가 한 목록에 섞이므로 어디서 온 정보인지 보여야 한다 (F-03a) */
export function SourceBadge({ source }: { source: "youth" | "gov24" }) {
  const label = source === "youth" ? "온통청년" : "정부24";
  const tone =
    source === "youth"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/20"
      : "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-400/20";

  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {label}
    </span>
  );
}

/**
 * 5단계 점수 배지 (§5.6).
 *
 * 숫자를 앞에 세우고 뜻을 붙인다 — `4`만 보이면 무슨 척도인지 모르고, `확인 1개`만 보이면
 * 목록에서 순서가 읽히지 않는다. 점수는 모델이 아니라 확인 항목 수에서 나온다 (`lib/verdict/score.ts`).
 */
const SCORE_STYLE: Record<Score, string> = {
  5: "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300 dark:ring-green-400/20",
  4: "bg-teal-50 text-teal-800 ring-teal-600/20 dark:bg-teal-950 dark:text-teal-300 dark:ring-teal-400/20",
  3: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20",
  2: "bg-slate-100 text-slate-700 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-400/20",
  1: "bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-400/20",
};

/** `decided_by`를 함께 보여준다 — 코드로 확정한 것과 AI가 판정한 것은 신뢰의 성격이 다르다 (F-11b) */
export function ScoreBadge({
  score,
  checkCount,
  decidedBy,
}: {
  score: Score;
  checkCount: number;
  decidedBy?: "code" | "ai" | null;
}) {
  return (
    <span
      title={SCORE_HINTS[score]}
      className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${SCORE_STYLE[score]}`}
    >
      <span className="tabular-nums" aria-hidden>
        {score}
      </span>
      <span className="sr-only">5점 만점에 {score}점 — </span>
      {scoreLabel(score, checkCount)}
      {decidedBy ? (
        <span className="font-normal opacity-70">{decidedBy === "code" ? "· 코드" : "· AI"}</span>
      ) : null}
    </span>
  );
}

/** 판정을 기다리는 동안 배지 자리를 지킨다 — 결과가 도착해도 카드가 튀지 않는다 (§7) */
export function VerdictBadgeSkeleton() {
  return (
    <span
      role="status"
      aria-label="판정 중"
      className="inline-flex h-[22px] w-14 shrink-0 animate-pulse rounded bg-gray-200 dark:bg-gray-800"
    />
  );
}

export function CategoryBadge({ label }: { label: string }) {
  return (
    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
      {label}
    </span>
  );
}
