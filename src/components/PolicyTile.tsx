import Link from "next/link";

import { CATEGORY_LABELS, type Category } from "@/lib/sources/category";
import type { PolicyListRow } from "@/lib/policies/query";
import { scoreOf } from "@/lib/verdict/score";
import type { DecidedVerdict } from "@/lib/verdict/validate";

import { ScoreBadge, SourceKicker, VerdictBadgeSkeleton } from "./badges";

/**
 * 그리드로 훑을 때의 카드 (docs/DESIGN.md §5.1 보기 전환)
 *
 * `PolicyCard`와 **같은 정보를 덜 보여준다.** 인용문·확인 항목 목록·블로커는 여기 없다 —
 * 3열에 들어가려면 카드가 짧아야 하고, 짧은 카드에 그것들을 우겨넣으면 어느 것도 안 읽힌다.
 * 대신 판정 이유 두 줄은 남긴다. 배지만 남기면 "왜 4점인지"를 알 수 없어 목록이 점수표가 된다.
 *
 * 전부 보려면 목록 보기로 바꾸거나 카드를 열면 된다 — 그래서 전환이 있다.
 */
export function PolicyTile({
  policy,
  verdict,
  judging = false,
}: {
  policy: PolicyListRow;
  verdict: DecidedVerdict | null;
  judging?: boolean;
}) {
  const score = verdict ? scoreOf(verdict) : null;
  const dimmed = score === 1;

  const facts = [
    policy.org_name,
    policy.apply_period ? `신청기간 ${policy.apply_period}` : null,
  ].filter((v): v is string => v !== null);

  // 판정 전에는 원문 요약이, 판정 후에는 판정 이유가 그 자리를 쓴다.
  const blurb = verdict?.reason ?? policy.summary ?? policy.eligibility_text ?? null;

  const category = policy.categories[0] as Category | undefined;

  return (
    <article className={`tile ${dimmed ? "opacity-60" : ""}`}>
      <div className="tile-band">
        <span className="tile-band-label">
          {category ? (CATEGORY_LABELS[category] ?? category) : "기타"}
        </span>

        {verdict && score ? (
          <ScoreBadge score={score} checkCount={verdict.checks.length} decidedBy={verdict.decided_by} />
        ) : judging ? (
          <VerdictBadgeSkeleton />
        ) : null}
      </div>

      <div className="tile-body">
        <SourceKicker source={policy.source} />

        <Link
          href={`/policies/${policy.id}`}
          className="card-title line-clamp-2 underline-offset-2 hover:underline"
        >
          {policy.title}
        </Link>

        {facts.length > 0 ? <p className="card-body line-clamp-1">{facts.join(" · ")}</p> : null}

        {/* `mt-auto`가 이 줄을 바닥에 붙인다 — 제목이 한 줄인 타일과 두 줄인 타일의
            아래쪽 여백이 달라 보이면 그리드가 흔들린다 */}
        {blurb ? <p className="card-body mt-auto line-clamp-2 pt-1">{blurb}</p> : null}
      </div>
    </article>
  );
}
