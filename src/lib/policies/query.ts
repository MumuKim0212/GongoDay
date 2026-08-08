import type { SupabaseClient } from "@supabase/supabase-js";

import { log } from "@/lib/log";
import { AGE_SLACK, INDIVIDUAL_AUDIENCES, ageFromBirthYear } from "@/lib/verdict/gate";
import { DEFAULT_CATEGORIES, type Category } from "@/lib/sources/category";

/**
 * 목록 SQL 1차 필터 (ARCHITECTURE §5.0.1)
 *
 * ⚠️ **같은 규칙이 `gate.ts`에도 있다.** 여기는 걸러내고, 게이트는 라벨을 붙인다.
 * 하나로 합치려면 DB 함수나 뷰가 필요하다. **규칙을 바꿀 때는 두 곳을 같이 바꾼다.**
 *
 * 다만 **값은 `gate.ts`에서 가져온다** — 규칙의 형태는 어차피 둘로 갈라지지만(SQL ↔ 함수),
 * 상수까지 복사해 두면 한쪽만 고쳐도 타입이 통과해 목록과 판정이 조용히 갈린다.
 */

export const PAGE_SIZE = 10;

/** 목록이 읽는 칸. `raw`는 무겁고 화면이 쓰지 않으므로 뺀다. */
export const LIST_COLUMNS =
  "id,source,external_id,title,summary,eligibility_text,org_name,org_type," +
  "is_nationwide,region_sidos,region_sigungu,categories,audiences," +
  "age_min,age_max,eligibility_codes,apply_period,source_url,source_registered_at";

export type PolicyListRow = {
  id: string;
  source: "youth" | "gov24";
  external_id: string;
  title: string;
  summary: string | null;
  eligibility_text: string | null;
  org_name: string | null;
  org_type: string | null;
  is_nationwide: boolean;
  region_sidos: string[];
  region_sigungu: string | null;
  categories: string[];
  audiences: string[];
  age_min: number | null;
  age_max: number | null;
  apply_period: string | null;
  source_url: string | null;
  source_registered_at: string | null;
};

/** 화면이 넘겨주는 조건. 전부 선택이고, 비면 그 검사를 걸지 않는다. */
export type ListFilters = {
  /** 프로필이 없으면 null — 나이·지역 조건을 걸지 않는다 */
  birthYear: number | null;
  regionSido: string | null;
  regionSigungu: string | null;
  categories: Category[];
  /** 정책명 검색어 */
  q: string | null;
  /**
   * 스크랩한 정책 id. `null`이면 스크랩 필터를 걸지 않는다 (F-20).
   *
   * 사용자가 직접 건 필터라 **`"total"` 집계에도 들어간다** — 검색어와 같은 층위다.
   * RLS가 본인 행만 주므로 여기 담긴 id는 이미 본인 것뿐이다.
   */
  scrapPolicyIds: string[] | null;
  page: number;
};

export function defaultFilters(): ListFilters {
  return {
    birthYear: null,
    regionSido: null,
    regionSigungu: null,
    categories: DEFAULT_CATEGORIES,
    q: null,
    scrapPolicyIds: null,
    page: 1,
  };
}

/**
 * 1차 필터를 건 쿼리를 만든다.
 *
 * **`scope`는 사용자 설정이 아니라 두 집계의 구분이다.** `"total"`은 화면의 "전체 M건"을 세는
 * 쿼리라 **분야·나이·지역·사용자구분을 걸지 않는다**. 검색어·스크랩은 사용자가 직접 건
 * 것이라 양쪽에 똑같이 들어간다 — 그래야 "검색 결과 중 몇 건이 조건을 통과했는가"로 읽힌다.
 */
function applyFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- PostgREST 빌더는 체이닝마다 타입이 바뀐다
  query: any,
  f: ListFilters,
  scope: "filtered" | "total",
) {
  if (f.q) {
    // %와 _는 PostgREST ilike의 와일드카드다. 사용자가 친 문자 그대로 찾도록 이스케이프한다.
    query = query.ilike("title", `%${f.q.replace(/[%_\\]/g, "\\$&")}%`);
  }
  // 스크랩도 사용자가 직접 건 필터다 — 전체 집계에서도 풀지 않는다
  if (f.scrapPolicyIds !== null) query = query.in("id", f.scrapPolicyIds);

  if (scope === "total") return query;

  if (f.categories.length > 0) query = query.overlaps("categories", f.categories);

  // 사용자구분 — 프로필과 무관한 서비스 범위 조건이다 (§5.0.3)
  query = query.or(
    `audiences.eq.{},audiences.ov.{${INDIVIDUAL_AUDIENCES.join(",")}}`,
  );

  if (f.birthYear !== null) {
    const age = ageFromBirthYear(f.birthYear);
    // ±1년을 gate.ts와 똑같이 — 빠뜨리면 목록에 없는 정책이 판정은 통과하는 모순이 생긴다
    query = query.or(`age_min.is.null,age_min.lte.${age + AGE_SLACK}`);
    query = query.or(`age_max.is.null,age_max.gte.${age - AGE_SLACK}`);
  }

  if (f.regionSido !== null) {
    query = query.or(`is_nationwide.is.true,region_sidos.ov.{${f.regionSido}}`);
  }
  if (f.regionSigungu !== null) {
    query = query.or(
      `region_sigungu.is.null,region_sigungu.eq.${JSON.stringify(f.regionSigungu)}`,
    );
  }

  return query;
}

export type ListResult = {
  rows: PolicyListRow[];
  /** 1차 필터를 통과한 전체 건수 ("1차 조건 통과 N건") */
  filteredCount: number;
  /** 검색어·스크랩만 적용한 건수 ("전체 M건") */
  totalCount: number;
  /**
   * 조회 실패 메시지. **`null`이 아니면 건수 0을 "결과 없음"으로 읽으면 안 된다** —
   * 조회가 실패한 것과 조건에 맞는 정책이 없는 것은 화면에서 다르게 말해야 한다.
   */
  error: string | null;
};

export async function fetchPolicies(
  supabase: SupabaseClient,
  f: ListFilters,
): Promise<ListResult> {
  const from = (f.page - 1) * PAGE_SIZE;

  // 스크랩이 하나도 없으면 조회할 것이 없다. `in.()`는 빈 목록으로 부르면 오류다.
  if (f.scrapPolicyIds !== null && f.scrapPolicyIds.length === 0) {
    return { rows: [], filteredCount: 0, totalCount: 0, error: null };
  }

  // 분야를 전부 끄면 0건이다. 필터를 껐으니 전체를 보여준다고 하면
  // **끌수록 결과가 늘어나** 분야 필터가 목록을 좁히는 장치라는 것과 어긋난다.
  // 되돌리는 길은 분야를 다시 켜는 것 하나다 — 빈 상태 안내가 그렇게 말한다.
  if (f.categories.length === 0) {
    const total = await applyFilters(
      supabase.from("policies").select("id", { count: "exact", head: true }),
      f,
      "total",
    );
    const message: string | null = total.error?.message ?? null;
    if (message) log.error("policies.query_failed", { where: "total", message });
    return { rows: [], filteredCount: 0, totalCount: total.count ?? 0, error: message };
  }

  const [filtered, total] = await Promise.all([
    applyFilters(supabase.from("policies").select(LIST_COLUMNS, { count: "exact" }), f, "filtered")
      .order("source_registered_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true }) // 정렬 동률에서 페이지 간 중복·누락을 막는다
      .range(from, from + PAGE_SIZE - 1),
    applyFilters(
      supabase.from("policies").select("id", { count: "exact", head: true }),
      f,
      "total",
    ),
  ]);

  // 화면은 이 실패를 "잠시 후 새로고침해 주세요"로만 말한다 (§7 — 어떤 실패도 화면을 비우지 않는다).
  // 무엇이 실패했는지는 서버에만 남길 수 있다.
  const message: string | null = filtered.error?.message ?? total.error?.message ?? null;
  if (message) log.error("policies.query_failed", { where: "list", page: f.page, message });

  return {
    rows: (filtered.data ?? []) as unknown as PolicyListRow[],
    filteredCount: filtered.count ?? 0,
    totalCount: total.count ?? 0,
    error: message,
  };
}
