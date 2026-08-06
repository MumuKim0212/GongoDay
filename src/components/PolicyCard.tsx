import Link from "next/link";

import { CATEGORY_LABELS, type Category } from "@/lib/sources/category";
import type { PolicyListRow } from "@/lib/policies/query";
import { normalize } from "@/lib/verdict/normalize";
import { SCORE_HINTS, scoreOf } from "@/lib/verdict/score";
import type { DecidedVerdict } from "@/lib/verdict/validate";

import { CategoryBadge, ScoreBadge, SourceKicker, VerdictBadgeSkeleton } from "./badges";

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
  judging = false,
}: {
  policy: PolicyListRow;
  verdict: DecidedVerdict | null;
  /** 이 카드의 판정을 기다리는 중 — 배지 자리에 스켈레톤을 둔다 (§7) */
  judging?: boolean;
}) {
  const score = verdict ? scoreOf(verdict) : null;
  const dimmed = score === 1;

  return (
    <article
      className={`border-b border-gray-200 p-4 dark:border-gray-800 ${dimmed ? "opacity-60" : ""}`}
    >
      <div className="flex items-start gap-2">
        {verdict && score ? (
          <ScoreBadge score={score} checkCount={verdict.checks.length} decidedBy={verdict.decided_by} />
        ) : judging ? (
          <VerdictBadgeSkeleton />
        ) : null}
        <div className="min-w-0 flex-1">
          <Link
            href={`/policies/${policy.id}`}
            className="font-medium underline-offset-2 hover:underline"
          >
            {policy.title}
          </Link>

          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <SourceKicker source={policy.source} />
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

function VerdictDetail({ verdict }: { verdict: DecidedVerdict }) {
  // 모델이 인용문을 blockers에 그대로 다시 적는 일이 잦다. 같은 문장을 두 번 보여주지 않는다.
  const shownQuote = verdict.quote && verdict.quote_verified ? verdict.quote : null;
  const quoteText = shownQuote === null ? "" : normalize(shownQuote).text;
  const blockers = verdict.blockers.filter((b) => !quoteText.includes(normalize(b).text));
  // 확인 항목도 인용문을 그대로 다시 적어 오는 일이 있다. 같은 문장을 두 번 보여주지 않는다.
  const checks = verdict.checks.filter((c) => !quoteText.includes(normalize(c).text));

  return (
    <div className="mt-2 text-sm">
      {verdict.reason ? (
        <p className="text-gray-700 dark:text-gray-300">{verdict.reason}</p>
      ) : null}

      {/* 인용 검증을 통과한 것만 원문 근거로 보여준다 (PRD §7.4) */}
      {shownQuote ? (
        <blockquote className="mt-1.5 border-l-2 border-gray-300 pl-2 text-xs text-gray-600 dark:border-gray-600 dark:text-gray-400">
          {shownQuote}
        </blockquote>
      ) : null}

      {/*
        점수의 근거다 (§5.6). "왜 4점인지"가 이 목록이고, 사용자가 다음에 할 일이기도 하다 —
        애매를 "판단 실패"가 아니라 "이것만 확인하면 된다"로 읽히게 하는 것이 이 블록의 목적이다.
      */}
      {checks.length > 0 ? (
        <div className="mt-1.5 rounded bg-gray-50 p-2 dark:bg-gray-900">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">확인이 필요한 것</p>
          <ul className="mt-0.5 space-y-0.5">
            {checks.map((c) => (
              <li key={c} className="text-xs text-gray-600 dark:text-gray-400">
                · {c}
              </li>
            ))}
          </ul>
        </div>
      ) : verdict.verdict === "unclear" ? (
        <p className="mt-1.5 text-xs text-gray-500">{SCORE_HINTS[2]}</p>
      ) : null}

      {blockers.length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {blockers.map((b) => (
            <li key={b} className="text-xs text-gray-600 dark:text-gray-400">
              · {b}
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        코드 게이트가 확정한 '아님'의 회수 장치다 (§5.0.2의 잔여 오판 위험 상한 3.8%).
        블로커가 정책 대상을 한글로 적어주고, 여기서 고칠 자리를 알려준다.
      */}
      {verdict.verdict === "ineligible" && verdict.decided_by === "code" ? (
        <p className="mt-1.5 text-xs text-gray-500">
          해당하는 조건이 있다면{" "}
          <Link href="/profile" className="underline underline-offset-2">
            내 조건
          </Link>
          에 추가해 보세요.
        </p>
      ) : null}
    </div>
  );
}
