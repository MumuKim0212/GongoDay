import type { Verdict } from "@/lib/verdict/validate";

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

const VERDICT_STYLE: Record<Verdict, { label: string; mark: string; tone: string }> = {
  eligible: {
    label: "해당",
    mark: "✅",
    tone: "bg-green-50 text-green-800 ring-green-600/20 dark:bg-green-950 dark:text-green-300 dark:ring-green-400/20",
  },
  unclear: {
    label: "애매",
    mark: "❔",
    tone: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/20",
  },
  ineligible: {
    label: "아님",
    mark: "✖",
    tone: "bg-gray-100 text-gray-600 ring-gray-500/20 dark:bg-gray-800 dark:text-gray-400 dark:ring-gray-400/20",
  },
};

/** `decided_by`를 함께 보여준다 — 코드로 확정한 것과 AI가 판정한 것은 신뢰의 성격이 다르다 (F-11b) */
export function VerdictBadge({
  verdict,
  decidedBy,
}: {
  verdict: Verdict;
  decidedBy?: "code" | "ai" | null;
}) {
  const s = VERDICT_STYLE[verdict];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${s.tone}`}
    >
      <span aria-hidden>{s.mark}</span>
      {s.label}
      {decidedBy ? (
        <span className="font-normal opacity-70">{decidedBy === "code" ? "· 코드" : "· AI"}</span>
      ) : null}
    </span>
  );
}

export function CategoryBadge({ label }: { label: string }) {
  return (
    <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400">
      {label}
    </span>
  );
}
