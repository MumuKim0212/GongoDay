import Link from "next/link";

import { CATEGORY_LABELS, type Category } from "@/lib/sources/category";
import type { PolicyListRow } from "@/lib/policies/query";
import { normalize } from "@/lib/verdict/normalize";
import { SCORE_HINTS, scoreOf } from "@/lib/verdict/score";
import type { DecidedVerdict } from "@/lib/verdict/validate";

import { CategoryBadge, ScoreBadge, SourceKicker, VerdictBadgeSkeleton } from "./badges";

/**
 * 목록 카드 (ARCHITECTURE §6.1 · docs/DESIGN.md §5.1)
 *
 * **`아님`도 사라지지 않는다.** 접어둘 뿐이고 `blockers`로 "왜 여기 있는지"를 말해준다 —
 * PRD §1.2 후기 불만 #1("지원도 못하는 공고가 보인다")에 대한 답이다.
 * 걸러 없애는 것과 이유를 붙여 보여주는 것은 다르다. 전자는 사용자가 신청 기회를 잃는다.
 *
 * **배지는 출처 키커와 같은 줄, 카드 오른쪽 위다** (DESIGN.md §5.1). 전에는 카드가 가로 두
 * 칸이어서 배지가 오른쪽 열을 통째로 차지했는데, 375px에서 카드 335px 중 배지가 100px 넘게
 * 먹어 **제목이 180px대로 눌렸다** (§7에 미정으로 남아 있던 자리). 머리줄로 올리면 제목부터는 어느
 * 폭에서도 카드 폭을 다 쓰고, 배지의 x좌표는 그대로라 목록을 훑는 눈은 여전히 한 열만 따라간다.
 * 상세 화면의 제목 + 배지도 같은 형태다 (§5.2).
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

  // 기관과 신청기간은 한 줄로 붙인다. 없는 것은 자리도 차지하지 않는다.
  const facts = [
    policy.org_name,
    policy.apply_period ? `신청기간 ${policy.apply_period}` : null,
  ].filter((v): v is string => v !== null);

  return (
    // `.card`의 세로 흐름 그대로다. 안쪽 간격만 `gap-1.5`로 좁힌다 — 카드 한 장 안의 줄 간격이다.
    <article className={`card elev-sm gap-1.5 ${dimmed ? "opacity-60" : ""}`}>
      {/* 머리줄 — 왼쪽은 출처, 오른쪽은 점수. 배지는 줄지 않는다(`.tag`의 `shrink-0`) */}
      <div className="flex items-start justify-between gap-4">
        <SourceKicker source={policy.source} />

        {verdict && score ? (
          <ScoreBadge
            score={score}
            checkCount={verdict.checks.length}
            decidedBy={verdict.decided_by}
          />
        ) : judging ? (
          <VerdictBadgeSkeleton />
        ) : null}
      </div>

      <Link href={`/policies/${policy.id}`} className="card-title underline-offset-2 hover:underline">
        {policy.title}
      </Link>

      {facts.length > 0 ? <p className="card-body">{facts.join(" · ")}</p> : null}

      {policy.categories.length > 0 ? (
        <div className="card-meta flex-wrap">
          {policy.categories.slice(0, 3).map((c) => (
            <CategoryBadge key={c} label={CATEGORY_LABELS[c as Category] ?? c} />
          ))}
        </div>
      ) : null}

      {verdict ? (
        <VerdictDetail verdict={verdict} />
      ) : (
        <p className="card-body line-clamp-2">{policy.summary ?? policy.eligibility_text ?? ""}</p>
      )}
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
    <div className="mt-0.5 flex flex-col gap-1.5">
      {verdict.reason ? <p className="text-compact">{verdict.reason}</p> : null}

      {/* 인용 검증을 통과한 것만 원문 근거로 보여준다 (PRD §7.4) */}
      {shownQuote ? (
        <blockquote className="border-l-2 border-[var(--divider)] pl-2 text-micro text-muted">
          {shownQuote}
        </blockquote>
      ) : null}

      {/*
        점수의 근거다 (§5.6). "왜 4점인지"가 이 목록이고, 사용자가 다음에 할 일이기도 하다 —
        애매를 "판단 실패"가 아니라 "이것만 확인하면 된다"로 읽히게 하는 것이 이 블록의 목적이다.
        카드가 이미 surface라, 안에 한 겹 더 들어가는 이 블록은 종이색으로 되돌려 구분한다.
      */}
      {checks.length > 0 ? (
        <div className="rounded-sm bg-[var(--paper)] p-2">
          <p className="text-micro font-semibold">확인이 필요한 것</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {checks.map((c) => (
              <li key={c} className="text-micro text-muted">
                · {c}
              </li>
            ))}
          </ul>
        </div>
      ) : verdict.verdict === "unclear" ? (
        <p className="text-micro text-muted">{SCORE_HINTS[2]}</p>
      ) : null}

      {blockers.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {blockers.map((b) => (
            <li key={b} className="text-micro text-muted">
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
        <p className="text-micro text-muted">
          해당하는 조건이 있다면{" "}
          <Link href="/profile" className="text-accent-ink underline underline-offset-2">
            내 조건
          </Link>
          에 추가해 보세요.
        </p>
      ) : null}
    </div>
  );
}
