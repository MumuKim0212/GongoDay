import Link from "next/link";
import { notFound } from "next/navigation";

import { ScoreBadge } from "@/components/badges";
import { QuoteHighlight } from "@/components/QuoteHighlight";
import { CATEGORY_LABELS, type Category } from "@/lib/sources/category";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/verdict/gate";
import { locateQuote } from "@/lib/verdict/normalize";
import { buildSourceText, type PolicySourceFields } from "@/lib/verdict/prompt";
import { SIGNATURE_COLUMNS, profileSignature } from "@/lib/verdict/signature";
import { SCORE_HINTS, scoreOf } from "@/lib/verdict/score";
import type { DecidedVerdict } from "@/lib/verdict/validate";

import { toggleScrap } from "./actions";

/** 판정과 스크랩이 사용자마다 다르다. 목록과 같은 이유로 매 요청 조회한다. */
export const dynamic = "force-dynamic";

/** 조립에 쓰는 칸(§5.3) + 표시 전용 칸. `raw`는 화면이 쓰지 않으므로 뺀다. */
const DETAIL_COLUMNS =
  "id, source, title, summary, org_name, org_type, eligibility_text, criteria_text," +
  "support_text, income_text, etc_text, apply_period, biz_period_etc," +
  "apply_method_text, document_text, screening_text, categories, source_url";

type DetailRow = PolicySourceFields & {
  id: string;
  source: "youth" | "gov24";
  org_type: string | null;
  apply_method_text: string | null;
  document_text: string | null;
  screening_text: string | null;
  categories: string[];
  source_url: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function PolicyDetailPage({ params }: PageProps<"/policies/[id]">) {
  const { id } = await params;
  // uuid가 아니면 조회 자체가 22P02로 실패한다. 없는 정책과 같은 자리이므로 404로 보낸다.
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("policies")
    .select(DETAIL_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  // 조회 실패를 '없는 정책'으로 흘리면 안 된다 — 목록·프로필과 같은 형태의 사고다.
  if (error) {
    return (
      <Shell>
        <Notice
          title="정책을 불러오지 못했습니다"
          body="잠시 후 새로고침해 주세요. 수집된 데이터는 그대로 남아 있습니다."
        />
      </Shell>
    );
  }
  if (!data) notFound();

  const policy = data as unknown as DetailRow;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profileRow } = user
    ? await supabase.from("profiles").select(SIGNATURE_COLUMNS).eq("id", user.id).maybeSingle()
    : { data: null };
  const profile = profileRow as unknown as Profile | null;

  // 목록과 같은 규칙 — 서명이 다른 판정은 지금 조건의 판정이 아니다 (§5.5)
  const { data: verdictRow } = user && profile
    ? await supabase
        .from("verdicts")
        .select("verdict, decided_by, reason, quote, quote_verified, blockers, checks")
        .eq("user_id", user.id)
        .eq("policy_id", policy.id)
        .eq("profile_signature", profileSignature(profile))
        .maybeSingle()
    : { data: null };
  const verdict = verdictRow as unknown as DecidedVerdict | null;

  const { data: scrapRow } = user
    ? await supabase
        .from("scraps")
        .select("policy_id")
        .eq("user_id", user.id)
        .eq("policy_id", policy.id)
        .maybeSingle()
    : { data: null };

  // **판정에 넘긴 것과 같은 문자열이다.** 여기서 다시 조립하는 것이 곧 "같다"의 보장이다 (§5.3).
  const sourceText = buildSourceText(policy);
  // 하이라이트 구간은 저장하지 않고 매번 다시 찾는다 — 원문이 갱신되면 구간도 따라 움직여야 한다.
  const highlight =
    verdict?.quote && verdict.quote_verified ? locateQuote(sourceText, verdict.quote) : null;

  const guide: [string, string | null][] = [
    ["신청방법", policy.apply_method_text],
    ["구비서류", policy.document_text],
    ["심사방법", policy.screening_text],
  ];
  const hasGuide = guide.some(([, v]) => v !== null);

  return (
    <Shell>
      <header>
        <h1 className="text-xl font-bold">{policy.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">
            {policy.source === "youth" ? "온통청년" : "정부24"}
          </span>
          {policy.categories.map((c) => (
            <span key={c} className="rounded bg-gray-100 px-1.5 py-0.5 dark:bg-gray-800">
              {CATEGORY_LABELS[c as Category] ?? c}
            </span>
          ))}
          {policy.org_name ? <span>{policy.org_name}</span> : null}
        </div>
      </header>

      <section className="mt-4 flex flex-wrap items-center gap-2">
        {policy.source_url ? (
          <a
            href={policy.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            원문 보기 ↗
          </a>
        ) : (
          // 온통청년의 21%는 링크가 없다. 없는 것을 없다고 말한다.
          <span className="text-xs text-gray-500">이 정책에는 원문 링크가 없습니다</span>
        )}

        {user ? (
          <form action={toggleScrap}>
            <input type="hidden" name="policy_id" value={policy.id} />
            <input type="hidden" name="scrapped" value={scrapRow ? "1" : "0"} />
            <button
              type="submit"
              className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
            >
              {scrapRow ? "★ 스크랩 해제" : "☆ 스크랩"}
            </button>
          </form>
        ) : (
          <span className="text-xs text-gray-500">세션이 없어 스크랩할 수 없습니다</span>
        )}
      </section>

      {/* 판정 결과 — 목록에서 이미 판정한 것을 그대로 읽는다. 이 화면은 Gemini를 부르지 않는다 */}
      <section className="mt-5 rounded border border-gray-200 p-4 dark:border-gray-800">
        {verdict ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <ScoreBadge
                score={scoreOf(verdict)}
                checkCount={verdict.checks.length}
                decidedBy={verdict.decided_by}
              />
              {verdict.reason ? <p className="text-sm">{verdict.reason}</p> : null}
            </div>
            <p className="mt-1.5 text-xs text-gray-500">{SCORE_HINTS[scoreOf(verdict)]}</p>

            {/* 점수의 근거 (§5.6). 목록 카드와 같은 목록을 보여준다 */}
            {verdict.checks.length > 0 ? (
              <div className="mt-2 rounded bg-gray-50 p-3 dark:bg-gray-900">
                <p className="text-sm font-medium">확인이 필요한 것</p>
                <ul className="mt-1 space-y-0.5">
                  {verdict.checks.map((c) => (
                    <li key={c} className="text-sm text-gray-700 dark:text-gray-300">
                      · {c}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {verdict.blockers.length > 0 ? (
              <ul className="mt-2 space-y-0.5">
                {verdict.blockers.map((b) => (
                  <li key={b} className="text-xs text-gray-600 dark:text-gray-400">
                    · {b}
                  </li>
                ))}
              </ul>
            ) : null}
            {verdict.quote_verified && highlight === null ? (
              // 저장할 때는 원문에 있었는데 지금은 없다 = 그 사이 수집이 원문을 갱신했다
              <p className="mt-2 text-xs text-gray-500">
                근거를 원문에서 찾지 못했습니다. 원문이 갱신되었을 수 있습니다.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            아직 판정하지 않은 정책입니다.{" "}
            <Link href="/" className="underline underline-offset-2">
              목록
            </Link>
            에서 <strong>판정하기</strong>를 누르면 이 정책도 함께 판정됩니다.
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">판정 근거 원문</h2>
        <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
          AI에게 넘긴 텍스트 그대로입니다.
          {highlight ? " 표시된 문장이 판정 근거로 인용된 문장입니다." : ""}
        </p>
        <div className="mt-2 rounded border border-gray-200 p-4 dark:border-gray-800">
          <QuoteHighlight text={sourceText} range={highlight} />
        </div>
      </section>

      <section className="mt-6">
        <h2 className="font-semibold">신청 안내</h2>
        <p className="mt-0.5 text-xs text-gray-600 dark:text-gray-400">
          {/* 판정에 안 쓴 텍스트를 섞으면 "이 문장을 보고 판정했나"를 알 수 없다 (§5.3) */}
          판정에는 쓰이지 않은 정보입니다. 최종 확인은 원문에서 해주세요.
        </p>
        <div className="mt-2 rounded border border-gray-200 p-4 text-sm dark:border-gray-800">
          {hasGuide ? (
            <dl className="space-y-3">
              {guide.map(([label, value]) =>
                value === null ? null : (
                  <div key={label}>
                    <dt className="text-xs font-medium text-gray-500">{label}</dt>
                    <dd className="mt-0.5 whitespace-pre-wrap break-words leading-relaxed">
                      {value}
                    </dd>
                  </div>
                ),
              )}
            </dl>
          ) : (
            <p className="text-gray-600 dark:text-gray-400">
              이 정책에는 신청 안내가 제공되지 않습니다. 원문에서 확인해 주세요.
            </p>
          )}
        </div>
      </section>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <Link
        href="/"
        className="text-sm text-gray-600 underline-offset-2 hover:underline dark:text-gray-400"
      >
        ← 목록으로
      </Link>
      <div className="mt-3">{children}</div>
    </main>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded border border-gray-200 p-4 dark:border-gray-800">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{body}</p>
    </div>
  );
}
