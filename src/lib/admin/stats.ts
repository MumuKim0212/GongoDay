import type { SupabaseClient } from "@supabase/supabase-js";

import { CATEGORIES, CATEGORY_LABELS } from "@/lib/sources/category";
import { CAPITAL_AREA_SIDOS, SIDO_NAMES } from "@/lib/sources/region";

/**
 * 운영 현황 집계 — 관리자 화면 전용 (ARCHITECTURE §2 스키마 기준).
 *
 * **건수만 읽는다.** 개별 사용자의 프로필·판정 내용은 조회하지 않는다 — 배포에서 이 화면에
 * 걸리는 잠금이 URL 은닉뿐이기 때문이다 (`access.ts`).
 *
 * 스키마를 건드리지 않으려고 집계 함수(RPC)나 뷰 대신 `count: exact, head: true` 병렬 조회를 쓴다.
 * 13,662행이면 순차 스캔으로 충분하다 — 1차 필터에 인덱스를 걸지 않은 것과 같은 판단이다 (§5.0.1).
 */

/**
 * 실패한 조회는 0이 아니라 `null`이다.
 * **화면이 "0건"과 "못 읽었다"를 다르게 말해야 한다** (`policies/query.ts`의 `error`와 같은 원칙).
 */
export type Num = number | null;

/** `api/sync/route.ts`의 `SOURCES`와 같아야 한다. 실행 기록이 없는 소스도 줄은 보여주려고 고정 목록을 쓴다. */
const SOURCES = ["youth", "gov24"] as const;
export const SOURCE_LABELS: Record<string, string> = { youth: "온통청년", gov24: "정부24" };

const VERDICTS = [
  ["eligible", "해당"],
  ["unclear", "애매"],
  ["ineligible", "아님"],
] as const;

const DECIDERS = [
  ["code", "코드 게이트"],
  ["ai", "AI"],
] as const;

export type Slice = { label: string; count: Num };

/** 채움률. 분모가 소스마다 달라서 비율은 화면이 계산한다 (`base`가 어느 모집단인지 가리킨다). */
export type FillRow = { label: string; count: Num; base: "all" | "youth" };

export type SyncStatus = {
  source: string;
  /** 마지막 실행 (성공·실패 무관) */
  startedAt: string | null;
  finishedAt: string | null;
  /** 0이 아니면 중단된 것이다 — 다음 갱신이 이 페이지부터 이어받는다 (§4) */
  lastPage: number | null;
  fetched: number;
  upserted: number;
  error: string | null;
  /** 마지막 **성공** 시각. 실패한 실행이 "갱신됨"으로 읽히면 안 된다 */
  lastSuccessAt: string | null;
  runCount: number;
};

export type AdminStats = {
  /** 집계 전체에 걸린 시간. DB가 살아 있는지·느려졌는지를 이 숫자로 본다 */
  dbMs: number;
  policies: { total: Num; youth: Num; gov24: Num; latestRegisteredAt: string | null };
  categories: Slice[];
  regions: Slice[];
  fill: FillRow[];
  verdicts: {
    total: Num;
    byVerdict: Slice[];
    byDecider: Slice[];
    /** 인용을 붙인 판정 */
    quoted: Num;
    /** 그중 원문에서 위치를 찾은 것 (§7.4) */
    quoteVerified: Num;
    latestAt: string | null;
  };
  sync: SyncStatus[];
};

/** 값은 절대 내보내지 않는다 — 설정 여부만. `NEXT_PUBLIC_`은 빌드 시점에 인라인되므로 리터럴로 읽는다. */
export function envStatus(): Array<{ key: string; set: boolean; server: boolean }> {
  return [
    { key: "NEXT_PUBLIC_SUPABASE_URL", set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL), server: false },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), server: false },
    { key: "SUPABASE_SERVICE_ROLE_KEY", set: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), server: true },
    { key: "GEMINI_API_KEY", set: Boolean(process.env.GEMINI_API_KEY), server: true },
    { key: "YOUTH_API_KEY", set: Boolean(process.env.YOUTH_API_KEY), server: true },
    { key: "GOV24_API_KEY", set: Boolean(process.env.GOV24_API_KEY), server: true },
  ];
}

export async function fetchAdminStats(db: SupabaseClient): Promise<AdminStats> {
  const started = performance.now();

  const [policies, categories, regions, fill, verdicts, sync] = await Promise.all([
    policyCounts(db),
    categoryCounts(db),
    regionCounts(db),
    fillCounts(db),
    verdictCounts(db),
    syncStatus(db),
  ]);

  return { dbMs: Math.round(performance.now() - started), policies, categories, regions, fill, verdicts, sync };
}

// ─────────────────────────────────────────────────────────────
// 조회 헬퍼
// ─────────────────────────────────────────────────────────────

/**
 * PostgREST 빌더는 체이닝마다 타입이 바뀐다. 이 파일처럼 여러 개를 배열에 모아 두면
 * TS가 인스턴스화 깊이 한계(TS2589)에 걸린다. `policies/query.ts`가 `any`를 쓴 것과 같은 이유다.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CountQuery = any;

/** 건수만 받는다 (`head: true`라 행은 오지 않는다). 실패는 `null`로 흘려보낸다. */
async function n(q: CountQuery): Promise<Num> {
  const { count, error } = await q;
  return error ? null : (count ?? 0);
}

/** 건수 전용 빌더. 반환 타입을 열어두지 않으면 체이닝을 배열에 모으는 순간 TS2589가 난다. */
function head(db: SupabaseClient, table: string): CountQuery {
  return db.from(table).select("id", { count: "exact", head: true });
}

/** 최신 timestamptz 한 개. 없거나 실패하면 `null`. */
async function latest(db: SupabaseClient, table: string, column: string): Promise<string | null> {
  const { data } = await db
    .from(table)
    .select(column)
    .not(column, "is", null)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as Record<string, string> | null)?.[column] ?? null;
}

// ─────────────────────────────────────────────────────────────
// 블록별 집계
// ─────────────────────────────────────────────────────────────

async function policyCounts(db: SupabaseClient): Promise<AdminStats["policies"]> {
  const [total, youth, gov24, latestRegisteredAt] = await Promise.all([
    n(head(db, "policies")),
    n(head(db, "policies").eq("source", "youth")),
    n(head(db, "policies").eq("source", "gov24")),
    latest(db, "policies", "source_registered_at"),
  ]);

  return { total, youth, gov24, latestRegisteredAt };
}

/** 분야는 배열 컬럼이라 겹침(`overlaps`)으로 센다. 한 정책이 여러 분야에 들어가므로 합이 총계보다 크다. */
function categoryCounts(db: SupabaseClient): Promise<Slice[]> {
  return Promise.all(
    CATEGORIES.map(async (c) => ({
      label: CATEGORY_LABELS[c],
      count: await n(head(db, "policies").overlaps("categories", [c])),
    })),
  );
}

/**
 * 지역 분포.
 *
 * **'전국'은 두 종류가 섞여 있다** (§2.6.2). 중앙행정기관은 실제로 전국이고,
 * 기관명 판별에 실패한 건도 '모르면 통과'라 전국으로 떨어진다. `org_type`으로만 구분된다 —
 * 이 줄이 §2b에 적힌 판별 실패 잔여분이다.
 */
function regionCounts(db: SupabaseClient): Promise<Slice[]> {
  const queries: Array<[string, () => CountQuery]> = [
    ["전국 — 중앙행정기관", () => head(db, "policies").eq("is_nationwide", true).eq("org_type", "중앙행정기관")],
    [
      "전국 — 지역 판별 실패",
      () =>
        head(db, "policies")
          .eq("source", "gov24")
          .eq("is_nationwide", true)
          .or("org_type.is.null,org_type.neq.중앙행정기관"),
    ],
    ["전국 — 온통청년(시도 15개 이상)", () => head(db, "policies").eq("source", "youth").eq("is_nationwide", true)],
    ...CAPITAL_AREA_SIDOS.map(
      (code): [string, () => CountQuery] => [
        SIDO_NAMES[code],
        () => head(db, "policies").overlaps("region_sidos", [code]),
      ],
    ),
    ["시군구까지 판별", () => head(db, "policies").not("region_sigungu", "is", null)],
  ];

  return Promise.all(queries.map(async ([label, q]) => ({ label, count: await n(q()) })));
}

/**
 * AI 판정 입력 텍스트의 채움률 (§5.3).
 *
 * 온통청년 `eligibility_text`를 따로 세는 이유: 33.7%뿐이어서 `summary`·`support_text`를
 * 프롬프트에 반드시 넣는 근거가 이 숫자다. 값이 흔들리면 프롬프트 설계를 다시 봐야 한다.
 */
function fillCounts(db: SupabaseClient): Promise<FillRow[]> {
  const queries: Array<[string, FillRow["base"], () => CountQuery]> = [
    ["요약 summary", "all", () => head(db, "policies").not("summary", "is", null)],
    ["지원내용 support_text", "all", () => head(db, "policies").not("support_text", "is", null)],
    ["지원대상 eligibility_text", "all", () => head(db, "policies").not("eligibility_text", "is", null)],
    [
      "지원대상 — 온통청년만",
      "youth",
      () => head(db, "policies").eq("source", "youth").not("eligibility_text", "is", null),
    ],
    ["나이 조건 있음", "all", () => head(db, "policies").or("age_min.not.is.null,age_max.not.is.null")],
    ["사용자구분 있음", "all", () => head(db, "policies").not("audiences", "eq", "{}")],
  ];

  return Promise.all(queries.map(async ([label, base, q]) => ({ label, base, count: await n(q()) })));
}

async function verdictCounts(db: SupabaseClient): Promise<AdminStats["verdicts"]> {
  const [total, byVerdict, byDecider, quoted, quoteVerified, latestAt] = await Promise.all([
    n(head(db, "verdicts")),
    Promise.all(
      VERDICTS.map(async ([key, label]) => ({ label, count: await n(head(db, "verdicts").eq("verdict", key)) })),
    ),
    Promise.all(
      DECIDERS.map(async ([key, label]) => ({ label, count: await n(head(db, "verdicts").eq("decided_by", key)) })),
    ),
    n(head(db, "verdicts").not("quote", "is", null)),
    n(head(db, "verdicts").eq("quote_verified", true)),
    latest(db, "verdicts", "created_at"),
  ]);

  return { total, byVerdict, byDecider, quoted, quoteVerified, latestAt };
}

/**
 * 소스별 마지막 실행. 최근 실행 100건을 한 번에 받아서 나눈다 —
 * 소스 × (최신 / 최신 성공)으로 쿼리를 네 번 던질 이유가 없다.
 */
async function syncStatus(db: SupabaseClient): Promise<SyncStatus[]> {
  const { data } = await db
    .from("sync_runs")
    .select("source, started_at, finished_at, last_page, fetched_count, upserted_count, error")
    .order("started_at", { ascending: false })
    .limit(100);

  const runs = (data ?? []) as Array<{
    source: string;
    started_at: string | null;
    finished_at: string | null;
    last_page: number | null;
    fetched_count: number;
    upserted_count: number;
    error: string | null;
  }>;

  return SOURCES.map((source) => {
    const mine = runs.filter((r) => r.source === source);
    const last = mine[0];
    const success = mine.find((r) => !r.error && r.finished_at);

    return {
      source,
      startedAt: last?.started_at ?? null,
      finishedAt: last?.finished_at ?? null,
      lastPage: last?.last_page ?? null,
      fetched: last?.fetched_count ?? 0,
      upserted: last?.upserted_count ?? 0,
      error: last?.error ?? null,
      lastSuccessAt: success?.finished_at ?? null,
      runCount: mine.length,
    };
  });
}
