import Link from "next/link";

import { CATEGORY_LABELS, type Category } from "@/lib/sources/category";
import type { PolicyListRow } from "@/lib/policies/query";
import type { Verdict } from "@/lib/verdict/validate";

import { CategoryBadge, SourceBadge, VerdictBadge } from "./badges";

export type CardVerdict = {
  verdict: Verdict;
  decided_by: "code" | "ai";
  reason: string | null;
  quote: string | null;
  quote_verified: boolean;
  blockers: string[];
};

/**
 * 목록 카드 (ARCHITECTURE §6.1)
 *
 * **`아님`도 사라지지 않는다.** 접어둘 뿐이고 `blockers`로 "왜 여기 있는지"를 말해준다 —
 * PRD §1.2 후기 불만 #1("지원도 못하는 공고가 보인다")에 대한 답이다.
 * 걸러 없애는 것과 이유를 붙여 보여주는 것은 다르다. 전자는 사용자가 신청 기회를 잃는다.
 */
export function PolicyCard({
  policy,
  verdict,
}: {
  policy: PolicyListRow;
  verdict: CardVerdict | null;
}) {
  const dimmed = verdict?.verdict === "ineligible";

  return (
    <article
      className={`border-b border-gray-200 p-4 dark:border-gray-800 ${dimmed ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2">
        {verdict ? (
          <VerdictBadge verdict={verdict.verdict} decidedBy={verdict.decided_by} />
        ) : null}
        <div className="min-w-0 flex-1">
          <Link
            href={`/policies/${policy.id}`}
            className="font-medium underline-offset-2 hover:underline"
          >
            {policy.title}
          </Link>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <SourceBadge source={policy.source} />
            {policy.categories.slice(0, 3).map((c) => (
              <CategoryBadge key={c} label={CATEGORY_LABELS[c as Category] ?? c} />
            ))}
            {policy.org_name ? (
              <span className="text-xs text-gray-500">{policy.org_name}</span>
            ) : null}
          </div>

          {verdict ? (
            <VerdictDetail verdict={verdict} />
          ) : (
            <p className="mt-2 line-clamp-2 text-sm text-gray-600 dark:text-gray-400">
              {policy.summary ?? policy.eligibility_text ?? ""}
            </p>
          )}

          {policy.apply_period ? (
            <p className="mt-2 text-xs text-gray-500">신청기간 · {policy.apply_period}</p>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function VerdictDetail({ verdict }: { verdict: CardVerdict }) {
  return (
    <div className="mt-2 text-sm">
      {verdict.reason ? (
        <p className="text-gray-700 dark:text-gray-300">{verdict.reason}</p>
      ) : null}

      {/* 인용 검증을 통과한 것만 원문 근거로 보여준다 (PRD §7.4) */}
      {verdict.quote && verdict.quote_verified ? (
        <blockquote className="mt-1.5 border-l-2 border-gray-300 pl-2 text-xs text-gray-600 dark:border-gray-600 dark:text-gray-400">
          {verdict.quote}
        </blockquote>
      ) : null}

      {verdict.blockers.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {verdict.blockers.map((b) => (
            <li key={b} className="text-xs text-gray-600 dark:text-gray-400">
              · {b}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
