import Image from "next/image";
import Link from "next/link";
import { Fragment } from "react";

import { ListControls } from "@/components/ListControls";
import { Pager } from "@/components/Pager";
import { PolicyList } from "@/components/PolicyList";
import { ViewToggle } from "@/components/ViewToggle";
import { CODE_LABELS } from "@/lib/profile/schema";
import { CATEGORIES, DEFAULT_CATEGORIES, type Category } from "@/lib/sources/category";
import { SIDO_NAMES } from "@/lib/sources/region";
import { PAGE_SIZE, defaultFilters, fetchPolicies, type ListFilters } from "@/lib/policies/query";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { lastFullSync } from "@/lib/sync/last-full";
import type { Profile } from "@/lib/verdict/gate";
import { SIGNATURE_COLUMNS, profileSignature } from "@/lib/verdict/signature";
import type { DecidedVerdict } from "@/lib/verdict/validate";

/** 매 요청 조회한다 — 프로필과 판정이 사용자마다 다르다. */
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export default async function Home({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const supabase = await createClient();

  // 세션이 없어도 목록은 보여야 한다 (§7 "익명 세션 생성 실패"). 프로필만 못 읽을 뿐이다.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 판정 서명을 계산해야 하므로 게이트가 읽는 칸을 통째로 읽는다 (§5.5).
  const { data: profileRow } = user
    ? await supabase
        .from("profiles")
        .select(`${SIGNATURE_COLUMNS}, interests`)
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const profile = profileRow as unknown as (Profile & { interests: string[] }) | null;

  // 스크랩만 보기 (F-20). RLS가 본인 행만 주므로 여기서 사용자를 한 번 더 거를 필요가 없다.
  const scrapsOnly = one(sp.scrap) === "1";
  const { data: scrapRows } = scrapsOnly && user
    ? await supabase.from("scraps").select("policy_id").eq("user_id", user.id)
    : { data: null };

  const filters: ListFilters = {
    ...defaultFilters(),
    scrapPolicyIds: scrapsOnly ? (scrapRows ?? []).map((r) => r.policy_id as string) : null,
    birthYear: profile?.birth_year ?? null,
    regionSido: profile?.region_sido ?? null,
    regionSigungu: profile?.region_sigungu ?? null,
    categories: parseCategories(one(sp.cat), profile?.interests),
    q: one(sp.q),
    page: Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1),
  };

  // 목록이 이 서명으로 읽은 판정임을 `PolicyList`도 알아야 한다 — 조건이 바뀌면 들고 있던
  // 판정을 버리는 기준이다 (§5.5).
  const signature = profile === null ? null : profileSignature(profile);

  const { rows, filteredCount, totalCount, error } = await fetchPolicies(supabase, filters);
  const [verdicts, syncedAt] = await Promise.all([
    fetchVerdicts(signature, rows.map((r) => r.id)),
    lastFullSync(supabase),
  ]);

  const lastPage = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  return (
    <>
      {/* 마스트헤드 — 브랜드는 왼쪽, 지금 할 일은 오른쪽 위 (DESIGN.md §5.1).
          한 화면에만 있으므로 컴포넌트로 빼지 않는다 (§3) */}
      <header className="bg-bg/85 border-divider sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-page items-center justify-between gap-3 px-4 py-2">
          <span className="flex items-center gap-2">
            <Image src="/logo.svg" alt="" width={28} height={28} priority />
            <span className="text-section">오늘공고</span>
          </span>
          {/* 프로필로 가는 문은 이 하나뿐이다. 목록 쪽에 같은 링크를 또 두면 기능이 겹친다.
              조건이 없을 때만 채움이다 — 그때는 판정 버튼이 없으므로 채움은 여전히 화면에 하나다 (§5.1) */}
          <Link href="/profile" className={profile ? "btn btn-secondary" : "btn btn-primary"}>
            {profile ? "내 조건 수정" : "내 조건 입력하기"}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-page px-4 pt-12 pb-8">
        {/* 히어로 — **이 한 블록만 가운데다** (§5.1). 아래 둘러보기부터는 왼쪽 정렬이다.
            REQ-05 + 이름 해석 고정 (F-32) — "오늘 올라온 공고"로 읽히면 안 된다.
            **이탤릭으로 강조하지 않는다** — 강조할 구절이 한글이고 Noto Serif KR에는 이탤릭
            페이스가 없어 합성 기울임이 된다 (§2.3). 제목의 600 위에 700을 얹는다. */}
        <div className="mx-auto max-w-read text-center">
          {/* 좁은 화면에서는 한 단 내린다 — 375px에서 44px은 세 줄로 넘친다.
              clamp를 쓰지 않는 이유는 두 값이 다 스케일 위에 있어야 하기 때문이다 (§2.3) */}
          <h1 className="text-display sm:text-hero text-balance">
            오늘, <strong className="font-extrabold">내가 신청할 수 있는</strong> 공고만.
          </h1>

          <p className="text-sub text-muted mt-4 font-normal text-balance">
            조건을 한 번 넣어두면 지원정책을 한 곳에서 걸러 보여줍니다.
          </p>
        </div>

        {/* ⚠️ `main`의 직계 `p`로 남아야 한다 — release-check의 `countText()`가 이 선택자로 읽는다.
            `통과 N건`이라는 말도 그 함수가 수를 집는 기준이므로 함께 두어야 한다 */}
        <p className="text-small text-muted mt-4 text-center">
          <span className="tag tag-accent tabular-nums">
            {/* "내 조건에 맞는"이라고 쓰면 AI 판정을 마친 것처럼 읽힌다 (§6.1) */}
            1차 조건 통과 <strong>{filteredCount.toLocaleString()}</strong>건 / 전체{" "}
            {totalCount.toLocaleString()}건
          </span>
          {!profile ? <span className="ml-2">조건을 넣으면 더 좁혀집니다</span> : null}
        </p>

        {/* 둘러보기 머리줄 — 제목 옆이 보기 전환 자리다 */}
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-title">공고 둘러보기</h2>
          <ViewToggle />
        </div>

        {/* 거르는 것을 한 상자에 모은다 — 분야·검색은 지금 고르는 조건이고, 내 조건은 이미
            걸려 있는 조건이라 [상세보기] 뒤에 접어 둔다 (§5.1) */}
        <section className="card mt-3 p-4 sm:p-5">
          {/* 검색어가 바뀌면 입력칸을 새로 만든다. 소프트 내비게이션에서는 이 트리가 살아남아
              `useState(q)`가 다시 초기화되지 않으므로, 검색 → 뒤로가기 뒤에 **목록은 검색이
              풀렸는데 입력칸에는 옛 검색어가 남아** 있었다 (React의 "key로 상태 리셋"). */}
          <ListControls
            key={filters.q ?? ""}
            categories={filters.categories}
            q={filters.q}
            scrapsOnly={scrapsOnly}
          />
          <ConditionDetails conditions={profile ? profileConditions(profile) : null} />
        </section>

        <section className="mt-5">
          {error ? (
            <EmptyState
              title="목록을 불러오지 못했습니다"
              body="잠시 후 새로고침해 주세요. 수집된 데이터는 그대로 남아 있습니다."
            />
          ) : rows.length > 0 ? (
            <PolicyList
              // 페이지·필터가 바뀌면 판정 상태를 새로 시작한다. 안 그러면 서버가 내려준
              // 저장된 판정(initialVerdicts)이 옛 상태에 가려 안 보인다.
              key={rows.map((r) => r.id).join(",")}
              rows={rows}
              initialVerdicts={verdicts}
              signature={signature}
              hasSession={user !== null}
              hasProfile={profile !== null}
            />
          ) : scrapsOnly ? (
            <EmptyState
              title="스크랩한 정책이 없습니다"
              body="정책 상세 화면에서 ☆ 스크랩을 누르면 여기에 모입니다."
            />
          ) : filters.q ? (
            // **검색어가 걸려 있으면 '수집된 정책이 없다'고 말하면 안 된다.** `totalCount`는
            // 검색어까지 반영한 값이라, 오타 하나로 "데이터가 없으니 갱신하라"는 거짓 안내가 뜬다 (§7).
            <EmptyState
              title="검색 결과가 없습니다"
              body="검색어를 지우거나 다른 말로 바꿔 보세요."
            />
          ) : totalCount === 0 ? (
            <EmptyState
              title="아직 수집된 정책이 없습니다"
              body="정책은 매시간 자동으로 받아옵니다. 잠시 후 새로고침해 주세요."
            />
          ) : (
            <EmptyState
              title="이 조건에 맞는 정책이 없습니다"
              body="분야를 더 켜면 걸러진 정책도 볼 수 있습니다."
            />
          )}
        </section>

        {lastPage > 1 && rows.length > 0 ? <Pager page={filters.page} lastPage={lastPage} /> : null}

        <SyncFooter at={latestOf(syncedAt)} />
      </main>
    </>
  );
}

/**
 * 갱신 시각은 한 줄로만 알린다 (F-05). **소스별 내역은 운영 화면에 있다** —
 * 사용자에게 필요한 것은 "이 목록이 언제 것인가"뿐이고, 어느 소스가 어디까지 받았는지는 운영 정보다.
 *
 * 구분선이 아니라 여백으로 나눈다 (원칙 1).
 */
function SyncFooter({ at }: { at: string | null }) {
  // 완주 기록이 없으면 줄 자체를 내지 않는다. 빈 목록 안내가 이미 상황을 말한다.
  if (at === null) return null;

  return <footer className="text-micro text-muted mt-8">마지막 공고 갱신시간 — {at}</footer>;
}

/**
 * 두 소스 중 **나중** 시각. 한 줄로만 적으므로 둘 중 하나를 골라야 한다.
 *
 * 온통청년이 3시간, 정부24가 11시간에 한 바퀴라 보통 온통청년 쪽이 뽑힌다.
 * 더 보수적으로 말하려면 `Math.min`이다 — 그러면 "두 소스 다 이 시각까지는 받았다"가 된다.
 */
function latestOf(at: { youth: string | null; gov24: string | null }): string | null {
  const times = [at.youth, at.gov24].filter((v): v is string => v !== null);
  if (times.length === 0) return null;

  const latest = new Date(Math.max(...times.map((t) => new Date(t).getTime())));
  // ⚠️ 서버 시간대는 UTC다. 빼먹으면 배포에서만 9시간 어긋난 시각이 나간다 (admin `time()`과 같은 이유).
  const zone = { timeZone: "Asia/Seoul" } as const;
  const hhmm = latest.toLocaleTimeString("ko-KR", {
    ...zone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // 오늘이면 시각만. 어제 것을 "04:20"이라고만 적으면 방금 받은 것처럼 읽힌다.
  const day = latest.toLocaleDateString("ko-KR", zone);
  return day === new Date().toLocaleDateString("ko-KR", zone) ? hhmm : `${day} ${hhmm}`;
}

/**
 * 분야 선택은 URL이 우선이고, 없으면 프로필의 관심분야, 그것도 없으면 기본 2개다 (PRD §6.1).
 * `none`은 "전부 껐다"를 뜻한다 — 빈 문자열로는 '미지정'과 구분되지 않는다.
 */
function parseCategories(raw: string | null, interests: string[] | undefined): Category[] {
  if (raw === "none") return [];
  const source = raw ? raw.split(",") : (interests ?? DEFAULT_CATEGORIES);
  const valid = source.filter((c): c is Category => (CATEGORIES as readonly string[]).includes(c));
  return valid.length > 0 ? valid : DEFAULT_CATEGORIES;
}

/**
 * 저장된 판정을 함께 읽는다 (F-16). 이 화면은 Gemini를 부르지 않는다 —
 * 한 번 판정한 페이지를 다시 열어도 호출이 0건이어야 한다 (§6.1).
 *
 * **서명으로 걸러야 한다.** 서명을 빼고 읽으면 조건을 고친 뒤에도 옛 판정이 그대로 붙어
 * **새 조건으로 판정한 것처럼 보인다** — 사용자는 알아챌 방법이 없다 (§5.5).
 *
 * 공유 캐시라 사용자로 걸러지 않는다 — 서명이 같으면 남이 부른 판정도 그대로 쓴다 (§2.3).
 * `verdicts`에는 RLS 정책이 없어 service_role로만 읽힌다.
 */
async function fetchVerdicts(
  signature: string | null,
  policyIds: string[],
): Promise<Record<string, DecidedVerdict>> {
  if (signature === null || policyIds.length === 0) return {};

  const { data } = await createAdminClient()
    .from("verdicts")
    .select("policy_id, verdict, decided_by, reason, quote, quote_verified, blockers, checks")
    .eq("profile_signature", signature)
    .in("policy_id", policyIds);

  const out: Record<string, DecidedVerdict> = {};
  for (const row of data ?? []) {
    const { policy_id, ...v } = row as unknown as { policy_id: string } & DecidedVerdict;
    out[policy_id] = v;
  }
  return out;
}

/**
 * 내 조건 상세 (§5.1)
 *
 * 전에는 히어로 아래 따로 선 카드였다. 그러면 **조건이 화면 두 곳에 나온다** — 위에는 걸러진
 * 근거(생년·지역)가, 아래에는 지금 고르는 조건(분야·검색)이 있어 같은 말이 두 번 나오는 것으로
 * 읽혔다. 한 상자에 모으되, 이미 걸려 있는 쪽은 접어 둔다 — 훑을 때는 방해가 없고 필요할 때만 편다.
 *
 * `<details>`라 자바스크립트가 없다. 열림 상태를 브라우저가 들고 있고, 스크린 리더에도 펼침
 * 여부가 그대로 전해진다.
 *
 * **판정 버튼은 여기 없다.** 버튼과 목록이 판정 상태를 공유해야 해서 `PolicyList` 안에 있어야
 * 하고(ARCHITECTURE §6.1), 조건을 넣는 문은 마스트헤드 하나다.
 */
function ConditionDetails({ conditions }: { conditions: Condition[] | null }) {
  return (
    // 펼친 내용을 버튼 **위**에 세운다(`order`) — 그래야 [상세보기]가 열든 닫든 상자의 우측하단이다.
    // ⚠️ `details`에 `display`를 주면 브라우저가 닫힌 내용을 감추지 않는다(실측: 닫아도 그대로 보였다).
    // 그래서 감추는 일을 `hidden group-open:block`이 대신 한다 — 접힌 내용은 화면에서도 낭독에서도 없다.
    <details className="group flex flex-col">
      <summary className="btn btn-ghost order-2 list-none self-end [&::-webkit-details-marker]:hidden">
        상세보기
        <span aria-hidden className="transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>

      <div className="order-1 hidden pb-2 group-open:block">
        <p className="card-kicker">내 조건</p>

        {conditions === null ? (
          <p className="text-compact text-muted mt-2">
            아직 없습니다. 오른쪽 위 <strong className="text-[var(--ink)]">내 조건 입력하기</strong>
            로 생년과 사는 곳만 넣어도 목록이 좁혀집니다.
          </p>
        ) : conditions.length === 0 ? (
          // 행은 있는데 값이 전부 비어 있는 상태 (ARCHITECTURE §7). 판정을 눌러도 AI를 안 부른다
          <p className="text-compact text-muted mt-2">
            비어 있습니다. 생년이나 사는 곳을 채우면 그때부터 조건으로 걸러집니다.
          </p>
        ) : (
          <dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-[auto_1fr]">
            {conditions.map((c) => (
              <Fragment key={c.label}>
                <dt className="text-small text-muted">{c.label}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {c.values.map((v) => (
                    <span key={v} className="tag tag-neutral">
                      {v}
                    </span>
                  ))}
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
      </div>
    </details>
  );
}

type Condition = { label: string; values: string[] };

/**
 * 펼쳤을 때 적을 조건. **판정에 실제로 쓰이는 값만** 적는다 — 여기 없는 값은 걸러내는 데도 쓰이지
 * 않는다(`SIGNATURE_COLUMNS`와 같은 목록이다).
 *
 * **관심분야는 넣지 않는다.** 같은 상자 위쪽의 분야 칩이 이미 그 값이고, 조건이 두 곳에 나오는
 * 것이 이 상자를 만든 이유다.
 *
 * 라벨을 모르는 코드는 통째로 뺀다 — 원본 코드(`JA0326`)를 노출하면 읽을 수 없는 줄이 된다.
 */
function profileConditions(profile: Profile): Condition[] {
  const labels = (codes: (string | null)[]) =>
    codes.map((c) => (c === null ? undefined : CODE_LABELS[c])).filter((v) => v !== undefined);

  const region = [SIDO_NAMES[profile.region_sido ?? ""], profile.region_sigungu]
    .filter((v): v is string => Boolean(v))
    .join(" ");

  return [
    { label: "생년", values: profile.birth_year ? [`${profile.birth_year}년생`] : [] },
    { label: "사는 곳", values: region ? [region] : [] },
    { label: "성별", values: labels([profile.gender]) },
    { label: "소득", values: labels([profile.income_bracket]) },
    { label: "개인상황", values: labels(profile.situations) },
    { label: "가구상황", values: labels(profile.household) },
    { label: "사업자", values: labels([profile.business_status]) },
  ].filter((c) => c.values.length > 0);
}

/** 박스를 두르지 않고 여백으로 세운다 (원칙 1). 가운데 정렬도 하지 않는다 — 페이지는 왼쪽 정렬이다 (§4.7) */
function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-8">
      <p className="text-sub">{title}</p>
      <p className="text-small text-muted mt-1">{body}</p>
    </div>
  );
}

