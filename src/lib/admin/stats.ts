import type { SupabaseClient } from "@supabase/supabase-js";

import { CATEGORIES, CATEGORY_LABELS } from "@/lib/sources/category";
import { lastFullSync } from "@/lib/sync/last-full";
import { scoreLabel, scoreOf, type Score } from "@/lib/verdict/score";
import { CAPITAL_AREA_SIDOS, SIDO_NAMES } from "@/lib/sources/region";

/**
 * 운영 현황 집계 — 관리자 화면 전용 (ARCHITECTURE §2 스키마 기준).
 *
 * **건수만 읽는다.** 개별 사용자의 프로필·판정 내용은 조회하지 않는다 — 배포에서 이 화면에
 * 걸리는 잠금이 URL 은닉뿐이기 때문이다 (`access.ts`).
 *
 * 스키마를 건드리지 않으려고 집계 함수(RPC)나 뷰 대신 `count: exact, head: true` 병렬 조회를 쓴다.
 * 13,662행이면 순차 스캔으로 충분하다 — 1차 필터에 인덱스를 걸지 않은 것과 같은 판단이다 (§5.0.1).
 *
 * **사용자·사용량 블록만 예외로 RPC를 쓴다** (schema.sql §2.8). 취향이 아니라 PostgREST로
 * 불가능해서다: `auth.users`는 노출되는 스키마가 아니고, `sum()`·`group by`가 쿼리 문법에 없다.
 * 행을 다 받아와 세는 우회로는 `verdict_runs`가 페이지뷰마다 쌓이는 순간 무너진다.
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
  /**
   * `null`이면 그 실행은 **끝나지 않았다.** 행은 시작할 때 만들어지고 끝날 때 갱신되므로
   * (`sync/run.ts`), 함수가 중간에 죽으면 `finished_at`도 `error`도 없는 행이 남는다.
   * 화면이 이걸 안 보면 죽은 실행이 '완료'로 표시된다 — 정확히 그 버그가 있었다.
   */
  finishedAt: string | null;
  /** 0이 아니면 중단된 것이다 — 다음 갱신이 이 페이지부터 이어받는다 (§4) */
  lastPage: number | null;
  fetched: number;
  upserted: number;
  error: string | null;
  /** 마지막 **성공** 시각. 실패한 실행이 "갱신됨"으로 읽히면 안 된다 */
  lastSuccessAt: string | null;
  /**
   * 마지막 **전량** 갱신 시각 — 끝까지 받고 `last_page`가 0으로 돌아간 실행만.
   * 사용자 화면 푸터가 두 소스 중 하나를 골라 쓰는 값이 이것이다.
   */
  lastFullAt: string | null;
  runCount: number;
};

/**
 * 방문 → 조건 등록 → 로그인의 세 단계.
 *
 * ⚠️ **`total`은 사람 수가 아니다.** `proxy.ts`가 쿠키 없는 화면 요청마다 익명 세션을 만들므로
 * 크롤러 방문이 그대로 섞인다 (§1.1). 아래 칸들과 나란히 놓아야 의미가 생긴다 —
 * `total`만 튀고 `anonProfiled`가 안 움직이면 사람이 아니라 봇이 훑고 있는 것이다.
 */
export type UserCounts = {
  total: Num;
  anon: Num;
  identified: Num;
  /** 익명인 채로 조건까지 저장한 세션 */
  anonProfiled: Num;
  /** 로그인하고 조건까지 저장한 계정 */
  identifiedProfiled: Num;
};

/** 한 기간의 사용량 합계. `verdict_runs` 장부에서 나온다 (§2.7) */
export type UsageSpan = {
  runs: Num;
  requested: Num;
  cached: Num;
  gateBlocked: Num;
  /** **비용의 분자.** 실제로 Gemini에 보낸 건수 */
  aiCalled: Num;
  aiFailed: Num;
  promptTokens: Num;
  outputTokens: Num;
  cacheErrors: Num;
  saveErrors: Num;
  p50Ms: Num;
  p95Ms: Num;
};

/** 사용량 상위 로그인 사용자. 이메일은 DB 함수가 가려서 준다 (schema.sql §2.8) */
export type TopCaller = {
  emailMasked: string;
  runs: number;
  aiCalled: number;
  cached: number;
  totalTokens: number;
  lastAt: string | null;
};

export type Usage = {
  all: UsageSpan;
  week: UsageSpan;
  today: UsageSpan;
  topCallers: TopCaller[];
};

export type Scraps = {
  total: Num;
  /** 스크랩한 사용자 수 · 스크랩된 정책 수. 표본에서 센다 (`sampled`가 잘렸는지 말해준다) */
  users: Num;
  policies: Num;
  sampled: Num;
};

export type AdminStats = {
  /** 집계 전체에 걸린 시간. DB가 살아 있는지·느려졌는지를 이 숫자로 본다 */
  dbMs: number;
  users: UserCounts;
  usage: Usage;
  scraps: Scraps;
  policies: { total: Num; youth: Num; gov24: Num; latestRegisteredAt: string | null };
  categories: Slice[];
  regions: Slice[];
  fill: FillRow[];
  verdicts: {
    total: Num;
    byVerdict: Slice[];
    byDecider: Slice[];
    /**
     * 인용 검증의 분모. **`quote`가 있는 건수를 분모로 쓰면 안 된다** —
     * `validate.ts`가 검증에 실패한 인용을 `null`로 지우고 저장하므로
     * `quote is not null`과 `quote_verified`는 항상 같은 집합이고, 비율이 무조건 100%가 된다.
     */
    ai: Num;
    /** 원문에서 위치를 찾은 인용 (§7.4). 코드 게이트 판정에는 인용이 없다 */
    quoteVerified: Num;
    /** 위 불변식이 깨지지 않았는지 보는 값. 화면에는 안 쓴다 (`scripts/admin-check.mts`) */
    quoted: Num;
    /** '아님'인데 blockers가 빈 건수 — 카드에 남는 설명이 reason 한 줄뿐이다 (PRD §7.5) */
    ineligibleNoBlockers: Num;
    /** 5단계 점수 분포 (§5.6). checks 길이가 필요해 집계 쿼리로는 안 되고 표본을 받아서 센다 */
    scores: Slice[];
    /** 점수 분포가 몇 건을 보고 센 것인지. total보다 작으면 잘린 것이다 */
    scoreSample: Num;
    /**
     * 서로 다른 조건 조합의 수 (표본 기준, 분모는 `scoreSample`).
     * **캐시 효율을 사용자 수보다 잘 설명한다** — 서명이 흩어질수록 같은 정책을 여러 번 판정한다.
     */
    signatures: Num;
    latestAt: string | null;
  };
  sync: SyncStatus[];
};

/**
 * Gemini 단가 (USD / 100만 토큰). **0이면 화면이 비용을 계산하지 않고 토큰만 보여준다.**
 *
 * ⚠️ 여기 숫자를 지어내지 않는다. 토큰 수는 API 응답에서 온 사실이지만 단가는 아니고,
 * 틀린 단가로 계산한 금액은 사실인 척하는 거짓말이다. **Google AI Studio 콘솔에서
 * `MODEL`(`gemini.ts`)의 실제 단가를 확인해 채운 뒤 확인 날짜를 같이 적는다.**
 * 모델을 바꾸면 여기도 같이 바꿔야 한다 — 그래서 §5.1.2 실측과 같은 자리에 둔다.
 */
export const PRICE_PER_1M = { input: 0, output: 0, checkedOn: "" };

/** 값은 절대 내보내지 않는다 — 설정 여부만. `NEXT_PUBLIC_`은 빌드 시점에 인라인되므로 리터럴로 읽는다. */
export function envStatus(): Array<{ key: string; set: boolean; server: boolean }> {
  return [
    { key: "NEXT_PUBLIC_SUPABASE_URL", set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL), server: false },
    { key: "NEXT_PUBLIC_SUPABASE_ANON_KEY", set: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), server: false },
    { key: "SUPABASE_SERVICE_ROLE_KEY", set: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY), server: true },
    { key: "GEMINI_API_KEY", set: Boolean(process.env.GEMINI_API_KEY), server: true },
    { key: "YOUTH_API_KEY", set: Boolean(process.env.YOUTH_API_KEY), server: true },
    { key: "GOV24_API_KEY", set: Boolean(process.env.GOV24_API_KEY), server: true },
    // 없으면 매시간 크론이 401로 튕긴다 — 수집이 소리 없이 멈추는 경로라 여기 띄운다
    { key: "CRON_SECRET", set: Boolean(process.env.CRON_SECRET), server: true },
  ];
}

export async function fetchAdminStats(db: SupabaseClient): Promise<AdminStats> {
  const started = performance.now();

  // ⚠️ **두 묶음으로 나눠 기다린다. 한 번에 다 던지면 안 된다.**
  // 이 블록들은 각자 안에서 또 병렬로 조회하므로 한 덩어리로 묶으면 40개 넘는 요청이 동시에 나간다.
  // 사용자·사용량 블록을 여기에 그냥 더했더니 **엉뚱한 조회(`fillCounts`의 나이 조건)가 간헐적으로
  // 실패했다** — 새 쿼리가 아니라 남의 쿼리가 터지고, 매번도 아니라서 제일 늦게 드러나는 종류다.
  // 화면은 실패를 `—`로 정직하게 표시하지만, 있는 값을 못 읽는 것 자체가 문제다.
  const [policies, categories, regions, fill, verdicts, sync] = await Promise.all([
    policyCounts(db),
    categoryCounts(db),
    regionCounts(db),
    fillCounts(db),
    verdictCounts(db),
    syncStatus(db),
  ]);

  const [users, usage, scraps] = await Promise.all([userCounts(db), usageStats(db), scrapCounts(db)]);

  return {
    dbMs: Math.round(performance.now() - started),
    users,
    usage,
    scraps,
    policies,
    categories,
    regions,
    fill,
    verdicts,
    sync,
  };
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

/**
 * 사용자 3단계. `auth.users`는 PostgREST에 없어서 `admin_user_counts()` RPC로 읽는다 (§2.8).
 *
 * 함수가 없으면(스키마를 아직 안 올렸으면) 전부 `null`이다 — 0이 아니다.
 * "사용자 0명"과 "못 읽었다"는 화면에서 달라야 한다.
 */
async function userCounts(db: SupabaseClient): Promise<UserCounts> {
  const { data, error } = await db.rpc("admin_user_counts").maybeSingle();

  if (error || !data) {
    return { total: null, anon: null, identified: null, anonProfiled: null, identifiedProfiled: null };
  }

  const r = data as Record<string, number>;
  return {
    total: r.total ?? null,
    anon: r.anon ?? null,
    identified: r.identified ?? null,
    anonProfiled: r.anon_profiled ?? null,
    identifiedProfiled: r.identified_profiled ?? null,
  };
}

const EMPTY_SPAN: UsageSpan = {
  runs: null,
  requested: null,
  cached: null,
  gateBlocked: null,
  aiCalled: null,
  aiFailed: null,
  promptTokens: null,
  outputTokens: null,
  cacheErrors: null,
  saveErrors: null,
  p50Ms: null,
  p95Ms: null,
};

/**
 * 호출·토큰 장부 (§2.7). 전체 / 최근 7일 / 오늘을 한 번에 받아 나눈다.
 *
 * **`verdicts` 행 수로 갈음할 수 없다** — 실패분은 저장되지 않고, upsert가 재판정을 덮어쓰며,
 * 캐시 적중은 행을 만들지 않는다. 그 셋이 전부 비용 판단에 필요한 값이다.
 */
async function usageStats(db: SupabaseClient): Promise<Usage> {
  const [spans, callers] = await Promise.all([
    db.rpc("admin_usage_stats"),
    db.rpc("admin_top_callers", { limit_n: 10 }),
  ]);

  const bySpan = new Map<string, UsageSpan>();
  if (!spans.error) {
    for (const row of (spans.data ?? []) as Record<string, number | string>[]) {
      bySpan.set(String(row.span), {
        runs: Number(row.runs),
        requested: Number(row.requested),
        cached: Number(row.cached),
        gateBlocked: Number(row.gate_blocked),
        aiCalled: Number(row.ai_called),
        aiFailed: Number(row.ai_failed),
        promptTokens: Number(row.prompt_tokens),
        outputTokens: Number(row.output_tokens),
        cacheErrors: Number(row.cache_errors),
        saveErrors: Number(row.save_errors),
        p50Ms: Number(row.p50_ms),
        p95Ms: Number(row.p95_ms),
      });
    }
  }

  const topCallers = callers.error
    ? []
    : ((callers.data ?? []) as Record<string, string | number | null>[]).map((row) => ({
        emailMasked: String(row.email_masked ?? "—"),
        runs: Number(row.runs ?? 0),
        aiCalled: Number(row.ai_called ?? 0),
        cached: Number(row.cached ?? 0),
        totalTokens: Number(row.total_tokens ?? 0),
        lastAt: (row.last_at as string | null) ?? null,
      }));

  return {
    all: bySpan.get("all") ?? EMPTY_SPAN,
    week: bySpan.get("week") ?? EMPTY_SPAN,
    today: bySpan.get("today") ?? EMPTY_SPAN,
    topCallers,
  };
}

/** 스크랩 표본 상한. 사용자·정책 종류 수는 `distinct`가 필요해 집계 쿼리로는 못 센다. */
const SCRAP_SAMPLE_MAX = 5000;

/**
 * 스크랩 지표. **사용자가 적극적으로 한 유일한 행동**이라 참여도를 이것으로 본다.
 *
 * 총 건수만 정확한 집계고, 사용자·정책 종류 수는 표본에서 센다 (`scoreCounts`와 같은 방식).
 * 개별 사용자가 무엇을 담았는지는 읽지 않는다 — id 두 개만 받는다.
 */
async function scrapCounts(db: SupabaseClient): Promise<Scraps> {
  const [total, sample] = await Promise.all([
    n(db.from("scraps").select("user_id", { count: "exact", head: true })),
    db.from("scraps").select("user_id, policy_id").limit(SCRAP_SAMPLE_MAX),
  ]);

  if (sample.error) return { total, users: null, policies: null, sampled: null };

  const rows = (sample.data ?? []) as Array<{ user_id: string; policy_id: string }>;
  return {
    total,
    users: new Set(rows.map((r) => r.user_id)).size,
    policies: new Set(rows.map((r) => r.policy_id)).size,
    sampled: rows.length,
  };
}

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

/** 점수 분포 표본 상한. 잘렸으면 화면이 그렇게 말한다 — 조용히 자르면 전수로 읽힌다. */
const SCORE_SAMPLE_MAX = 5000;

/**
 * 점수는 저장하지 않고 `checks` 길이에서 유도한다 (§5.6). PostgREST로는 배열 길이를 못 세므로
 * 판정 행을 상한까지 받아 여기서 센다. 판정 내용은 읽지 않는다 — verdict와 checks 길이뿐이다.
 *
 * **서명 다양성도 같은 표본에서 센다.** 조회를 하나 더 던질 이유가 없고, 어차피 분모가 같다.
 * 서명은 해시 문자열이라 개인을 가리키지 않는다 — 세는 것은 종류 수뿐이다.
 */
async function scoreCounts(db: SupabaseClient): Promise<{ scores: Slice[]; sample: Num; signatures: Num }> {
  const { data, error } = await db
    .from("verdicts")
    .select("verdict, checks, profile_signature")
    .limit(SCORE_SAMPLE_MAX);
  if (error) return { scores: [], sample: null, signatures: null };

  const rows = (data ?? []) as Array<{ verdict: string; checks: string[]; profile_signature: string }>;
  const counted = new Map<Score, number>();
  const signatures = new Set<string>();
  for (const r of rows) {
    const s = scoreOf({ verdict: r.verdict as "eligible" | "unclear" | "ineligible", checks: r.checks ?? [] });
    counted.set(s, (counted.get(s) ?? 0) + 1);
    signatures.add(r.profile_signature);
  }

  return {
    scores: ([5, 4, 3, 2, 1] as Score[]).map((s) => ({
      label: `${s}점 ${scoreLabel(s, 2)}`,
      count: counted.get(s) ?? 0,
    })),
    sample: rows.length,
    signatures: signatures.size,
  };
}

async function verdictCounts(db: SupabaseClient): Promise<AdminStats["verdicts"]> {
  const [total, byVerdict, byDecider, ai, quoteVerified, quoted, ineligibleNoBlockers, latestAt, scored] =
    await Promise.all([
      n(head(db, "verdicts")),
      Promise.all(
        VERDICTS.map(async ([key, label]) => ({ label, count: await n(head(db, "verdicts").eq("verdict", key)) })),
      ),
      Promise.all(
        DECIDERS.map(async ([key, label]) => ({ label, count: await n(head(db, "verdicts").eq("decided_by", key)) })),
      ),
      n(head(db, "verdicts").eq("decided_by", "ai")),
      n(head(db, "verdicts").eq("quote_verified", true)),
      n(head(db, "verdicts").not("quote", "is", null)),
      n(head(db, "verdicts").eq("verdict", "ineligible").eq("blockers", "{}")),
      latest(db, "verdicts", "created_at"),
      scoreCounts(db),
    ]);

  return {
    total,
    byVerdict,
    byDecider,
    ai,
    quoteVerified,
    quoted,
    ineligibleNoBlockers,
    latestAt,
    scores: scored.scores,
    scoreSample: scored.sample,
    signatures: scored.signatures,
  };
}

/**
 * 소스별 마지막 실행. 최근 실행 100건을 한 번에 받아서 나눈다 —
 * 소스 × (최신 / 최신 성공)으로 쿼리를 네 번 던질 이유가 없다.
 */
async function syncStatus(db: SupabaseClient): Promise<SyncStatus[]> {
  // 완주 시각은 따로 묻는다. 최근 100건 창 안에 정부24 완주가 없을 수 있어서다 —
  // 매시간 트리거면 이 창이 이틀치밖에 안 되고, 정부24는 11시간에 한 번만 완주한다.
  const [{ data }, full] = await Promise.all([
    db
      .from("sync_runs")
      .select("source, started_at, finished_at, last_page, fetched_count, upserted_count, error")
      .order("started_at", { ascending: false })
      .limit(100),
    lastFullSync(db),
  ]);

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
      lastFullAt: full[source],
      runCount: mine.length,
    };
  });
}
