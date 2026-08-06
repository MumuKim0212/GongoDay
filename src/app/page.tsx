import Image from "next/image";
import Link from "next/link";

import { ListControls } from "@/components/ListControls";
import { PolicyList } from "@/components/PolicyList";
import { SyncButton } from "@/components/SyncButton";
import { CATEGORIES, DEFAULT_CATEGORIES, type Category } from "@/lib/sources/category";
import { PAGE_SIZE, defaultFilters, fetchPolicies, type ListFilters } from "@/lib/policies/query";
import { createClient } from "@/lib/supabase/server";
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
    source: one(sp.source) === "youth" ? "youth" : one(sp.source) === "gov24" ? "gov24" : null,
    showAll: one(sp.all) === "1",
    page: Math.max(1, Number.parseInt(one(sp.page) ?? "1", 10) || 1),
  };

  const { rows, filteredCount, totalCount, error } = await fetchPolicies(supabase, filters);
  const [verdicts, syncedAt] = await Promise.all([
    fetchVerdicts(
      supabase,
      user?.id ?? null,
      profile === null ? null : profileSignature(profile),
      rows.map((r) => r.id),
    ),
    fetchLastSync(supabase),
  ]);

  const lastPage = Math.max(1, Math.ceil(filteredCount / PAGE_SIZE));

  return (
    <main className="mx-auto w-full max-w-page px-4 py-8">
      {/* 브랜드 줄 — 목업의 nav다. 한 화면에만 있으므로 클래스로 빼지 않는다 (DESIGN.md §3) */}
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="flex items-center gap-2">
          <Image src="/logo.svg" alt="" width={28} height={28} priority />
          <h1 className="text-section">오늘공고</h1>
        </span>
        {/* REQ-05 + 이름 해석 고정 (F-32) — "오늘 올라온 공고"로 읽히면 안 된다 */}
        <p className="text-small text-muted">
          오늘, <strong>내가 신청할 수 있는</strong> 공고만.
        </p>
      </header>

      <p className="text-small text-muted mt-4">
        조건을 한 번 넣어두면 온통청년·정부24의 지원정책을 한 곳에서 걸러 보여줍니다.
      </p>

      {/* 채움 버튼은 아래 '판정하기' 하나뿐이라 여기는 외곽선이다 (§5.1) */}
      <section className="mt-4 flex flex-wrap items-center gap-2">
        <Link href="/profile" className="btn btn-secondary">
          {profile ? "내 조건 수정" : "내 조건 입력하기"}
        </Link>
        <SyncButton />
      </section>

      {/* 한 소스만 수집됐어도 있는 것만 보여준다 (§7) */}
      <p className="text-micro text-muted mt-2">
        마지막 갱신 · 온통청년 {syncedAt.youth ?? "없음"} · 정부24 {syncedAt.gov24 ?? "없음"}
      </p>

      <p className="text-small text-muted mt-3">
        {filters.showAll ? (
          <>전체 {totalCount.toLocaleString()}건</>
        ) : (
          <>
            {/* "내 조건에 맞는"이라고 쓰면 AI 판정을 마친 것처럼 읽힌다 (§6.1) */}
            코드 조건 통과{" "}
            <strong className="text-[var(--ink)]">{filteredCount.toLocaleString()}</strong>건 / 전체{" "}
            {totalCount.toLocaleString()}건
          </>
        )}
        {!profile ? <span> — 조건을 넣으면 더 좁혀집니다</span> : null}
      </p>

      <section className="mt-3">
        <ListControls
          categories={filters.categories}
          q={filters.q}
          source={filters.source}
          showAll={filters.showAll}
          scrapsOnly={scrapsOnly}
        />
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
            hasSession={user !== null}
            hasProfile={profile !== null}
          />
        ) : scrapsOnly ? (
          <EmptyState
            title="스크랩한 정책이 없습니다"
            body="정책 상세 화면에서 ☆ 스크랩을 누르면 여기에 모입니다."
          />
        ) : filters.q || filters.source ? (
          // **검색·출처가 걸려 있으면 '수집된 정책이 없다'고 말하면 안 된다.** `totalCount`는
          // 검색어까지 반영한 값이라, 오타 하나로 "데이터가 없으니 갱신하라"는 거짓 안내가 뜬다 (§7).
          <EmptyState
            title="검색 결과가 없습니다"
            body="검색어를 지우거나 출처 필터를 '전체'로 바꿔 보세요."
          />
        ) : totalCount === 0 ? (
          <EmptyState
            title="아직 수집된 정책이 없습니다"
            body="위의 갱신 버튼을 눌러 정책을 받아오세요."
          />
        ) : (
          <EmptyState
            title="이 조건에 맞는 정책이 없습니다"
            body="분야를 더 켜거나 '전체 보기'를 켜면 걸러진 정책도 볼 수 있습니다."
          />
        )}
      </section>

      {lastPage > 1 && rows.length > 0 ? (
        <Pager page={filters.page} lastPage={lastPage} sp={sp} />
      ) : null}
    </main>
  );
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
 * **새 조건으로 판정한 것처럼 보인다** — 판정 버튼을 누르기 전까지 사용자는 알 수 없다 (§5.5).
 */
async function fetchVerdicts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string | null,
  signature: string | null,
  policyIds: string[],
): Promise<Record<string, DecidedVerdict>> {
  if (!userId || signature === null || policyIds.length === 0) return {};

  const { data } = await supabase
    .from("verdicts")
    .select("policy_id, verdict, decided_by, reason, quote, quote_verified, blockers, checks")
    .eq("user_id", userId)
    .eq("profile_signature", signature)
    .in("policy_id", policyIds);

  const out: Record<string, DecidedVerdict> = {};
  for (const row of data ?? []) {
    const { policy_id, ...v } = row as unknown as { policy_id: string } & DecidedVerdict;
    out[policy_id] = v;
  }
  return out;
}

/** 소스별 마지막 성공 시각 (F-05). 실패한 실행은 "갱신됨"으로 읽히면 안 되므로 제외한다. */
async function fetchLastSync(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ youth: string | null; gov24: string | null }> {
  const { data } = await supabase
    .from("sync_runs")
    .select("source, finished_at")
    .is("error", null)
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(50);

  const out: { youth: string | null; gov24: string | null } = { youth: null, gov24: null };
  for (const r of data ?? []) {
    const key = r.source as "youth" | "gov24";
    if (key in out && out[key] === null) {
      out[key] = new Date(r.finished_at as string).toLocaleString("ko-KR", {
        dateStyle: "short",
        timeStyle: "short",
      });
    }
  }
  return out;
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

function Pager({ page, lastPage, sp }: { page: number; lastPage: number; sp: Search }) {
  const href = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = one(v);
      if (val !== null && k !== "page") next.set(k, val);
    }
    if (p > 1) next.set("page", String(p));
    return next.toString() ? `/?${next}` : "/";
  };

  return (
    <nav className="mt-6 flex items-center justify-between">
      {page > 1 ? (
        <Link href={href(page - 1)} className="btn btn-ghost">
          ← 이전
        </Link>
      ) : (
        <span />
      )}
      <span className="text-small text-muted tabular-nums">
        {page} / {lastPage}
      </span>
      {page < lastPage ? (
        <Link href={href(page + 1)} className="btn btn-ghost">
          다음 →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
