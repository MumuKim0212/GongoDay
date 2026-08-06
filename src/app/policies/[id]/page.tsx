import Link from "next/link";
import { notFound } from "next/navigation";

import { CategoryBadge, ScoreBadge } from "@/components/badges";
import { QuoteHighlight } from "@/components/QuoteHighlight";
import { CATEGORY_LABELS, type Category } from "@/lib/sources/category";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/lib/verdict/gate";
import { locateQuote } from "@/lib/verdict/normalize";
import { buildSourceText, sourceSections, type PolicySourceFields } from "@/lib/verdict/prompt";
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
  // 화면은 라벨을 제목으로 세우므로 조각째 받는다. 본문도 구간도 위 문자열 기준 그대로다 (§5.4).
  const sections = sourceSections(policy);
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
        {/* 제목과 점수를 같은 줄에 둔다 — 목록에서 본 배지가 그 자리에 그대로 있어야 이어진다 */}
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-title">{policy.title}</h1>
          {verdict ? (
            <ScoreBadge
              score={scoreOf(verdict)}
              checkCount={verdict.checks.length}
              decidedBy={verdict.decided_by}
            />
          ) : null}
        </div>

        {/* 출처와 기관은 알약이 아니라 메타 한 줄이다 (DESIGN.md §5.2) */}
        <p className="text-small text-muted mt-2">
          {[policy.source === "youth" ? "온통청년" : "정부24", policy.org_name]
            .filter((v): v is string => Boolean(v))
            .join(" · ")}
        </p>

        {policy.categories.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {policy.categories.map((c) => (
              <CategoryBadge key={c} label={CATEGORY_LABELS[c as Category] ?? c} />
            ))}
          </div>
        ) : null}
      </header>

      <section className="mt-4 flex flex-wrap items-center gap-2">
        {policy.source_url ? (
          <a
            href={policy.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            원문 보기 ↗
          </a>
        ) : (
          // 온통청년의 21%는 링크가 없다. 없는 것을 없다고 말한다.
          <span className="text-micro text-muted">이 정책에는 원문 링크가 없습니다</span>
        )}

        {user ? (
          <form action={toggleScrap}>
            <input type="hidden" name="policy_id" value={policy.id} />
            <input type="hidden" name="scrapped" value={scrapRow ? "1" : "0"} />
            {/* 이미 스크랩한 것은 물러난다 — 해제는 되돌리는 동작이지 권하는 동작이 아니다 */}
            <button type="submit" className={scrapRow ? "btn btn-ghost" : "btn btn-secondary"}>
              {scrapRow ? "★ 스크랩 해제" : "☆ 스크랩"}
            </button>
          </form>
        ) : (
          <span className="text-micro text-muted">세션이 없어 스크랩할 수 없습니다</span>
        )}
      </section>

      {/* 머리(제목·버튼)와 읽을 것 사이를 가르는 줄 */}
      <hr className="border-divider mt-5 border-t" />

      {/*
        판정 결과 — 목록에서 이미 판정한 것을 그대로 읽는다. 이 화면은 Gemini를 부르지 않는다.
        **이 화면에서 상자를 두르는 블록은 여기 하나뿐이다** (DESIGN.md §5.2). 나머지 구획은
        제목과 여백이, 성격이 바뀌는 두 자리에서는 가로줄이 나눈다.
      */}
      <section className="card elev-sm mt-5">
        <div className="card-kicker">판정 근거</div>
        {verdict ? (
          <>
            {verdict.reason ? <p className="text-compact">{verdict.reason}</p> : null}
            <p className="text-micro text-muted">{SCORE_HINTS[scoreOf(verdict)]}</p>

            {/* 점수의 근거 (§5.6). 목록 카드와 같은 목록을 보여준다 */}
            {verdict.checks.length > 0 ? (
              <div className="rounded-sm bg-[var(--paper)] p-3">
                <p className="text-compact font-semibold">확인이 필요한 것</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {verdict.checks.map((c) => (
                    <li key={c} className="text-compact">
                      · {c}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {verdict.blockers.length > 0 ? (
              <ul className="flex flex-col gap-0.5">
                {verdict.blockers.map((b) => (
                  <li key={b} className="text-micro text-muted">
                    · {b}
                  </li>
                ))}
              </ul>
            ) : null}
            {verdict.quote_verified && highlight === null ? (
              // 저장할 때는 원문에 있었는데 지금은 없다 = 그 사이 수집이 원문을 갱신했다
              <p className="text-micro text-muted">
                근거를 원문에서 찾지 못했습니다. 원문이 갱신되었을 수 있습니다.
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-compact">
            아직 판정하지 않은 정책입니다.{" "}
            <Link href="/" className="text-accent-ink underline underline-offset-2">
              목록
            </Link>
            에서 <strong>판정하기</strong>를 누르면 이 정책도 함께 판정됩니다.
          </p>
        )}
      </section>

      {/* 판정 근거 원문 — 조각의 라벨이 곧 제목이라 블록에는 따로 제목을 두지 않는다 */}
      <section id="evidence" className="mt-6">
        <QuoteHighlight sections={sections} range={highlight} />
      </section>

      {/* 판정에 안 쓴 텍스트가 근거 블록에 섞이면 "이 문장을 보고 판정했나"를 알 수 없다 (§5.3) */}
      <hr className="border-divider mt-6 border-t" />

      <section id="guide" className="mt-6">
        <h2 className="text-sub">신청 안내</h2>
        <div className="text-compact mt-2">
          {hasGuide ? (
            <dl className="flex flex-col gap-4">
              {guide.map(([label, value]) =>
                value === null ? null : (
                  <div key={label}>
                    <dt className="text-micro text-muted">{label}</dt>
                    <dd className="mt-0.5 leading-[1.7] break-words whitespace-pre-wrap">
                      {dropEchoedLabel(label, value)}
                    </dd>
                  </div>
                ),
              )}
            </dl>
          ) : (
            <p className="text-muted">
              이 정책에는 신청 안내가 제공되지 않습니다. 원문에서 확인해 주세요.
            </p>
          )}
        </div>
      </section>
    </Shell>
  );
}

/**
 * 원문 첫 줄이 라벨과 같은 말이면 그 줄만 지운다 — 기관이 한 칸 안에 소제목을 또 써 둔 경우다
 * (`apply_method_text`가 `○ 신청방법`으로 시작하고 아래에 `○ 신청경로`가 이어지는 식).
 *
 * **여기서만 한다.** 판정 근거 원문은 AI에 넘긴 문자열 그대로여야 하므로 한 줄도 빼지 않는다 (§5.3).
 * 지우고 나면 아무것도 안 남는 칸은 그냥 둔다 — 겹쳐 보이는 편이 빈 칸보다 낫다.
 */
function dropEchoedLabel(label: string, text: string): string {
  const [first, ...rest] = text.split("\n");
  const head = first.replace(/^[^\p{L}\p{N}]+/u, "").replace(/[\s:：]+$/u, "");
  if (head !== label) return text;
  const body = rest.join("\n").trimStart();
  return body === "" ? text : body;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    // 읽는 화면이라 목록보다 좁다 — 한 줄이 길어지면 눈이 다음 줄 첫 글자를 놓친다 (§2.4)
    <main className="max-w-read mx-auto w-full px-4 py-8">
      {/* `px-0`으로 고스트 버튼의 안쪽 여백을 지워 본문 왼쪽 끝에 맞춘다 */}
      <Link href="/" className="btn btn-ghost px-0">
        ← 목록으로
      </Link>
      <div className="mt-3">{children}</div>
    </main>
  );
}

/** 빈 상태와 같은 형태다 — 상자를 두르지 않고 여백으로 세운다 (§4.7) */
function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-8">
      <p className="text-sub">{title}</p>
      <p className="text-small text-muted mt-1">{body}</p>
    </div>
  );
}
