import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { PAGE_SIZE } from "@/lib/policies/query";
import { createClient } from "@/lib/supabase/server";
import { checkGate, type PolicyConditions, type Profile } from "@/lib/verdict/gate";
import { callGemini } from "@/lib/verdict/gemini";
import { buildProfileText, buildSourceText, type PolicySourceFields } from "@/lib/verdict/prompt";
import { SIGNATURE_COLUMNS, profileSignature } from "@/lib/verdict/signature";
import { validateVerdict, type DecidedVerdict } from "@/lib/verdict/validate";

/**
 * 배치 판정 (ARCHITECTURE §5)
 *
 * ```
 * 캐시 → 코드 게이트 → Gemini(게이트 통과분만) → 3단 검증 → upsert
 * ```
 *
 * **요청은 `policyIds`만 받는다.** 프로필도 서명도 클라이언트에서 받지 않고 서버가 직접 조회해
 * 계산한다 — 클라이언트가 보낸 조건으로 판정하면 남의 프로필로 캐시를 오염시킬 수 있다 (§2.3).
 */

// 빼먹으면 로컬은 되고 배포에서만 끊긴다. 건당 15초 × 10건 병렬이라 이 상한 안에 들어간다 (§5.1.1).
export const maxDuration = 60;

/** 한 번에 현재 페이지 10건만. 호출 비용 통제의 핵심이다 (PRD §7.7) */
const MAX_BATCH = PAGE_SIZE;

/** buildSourceText(§5.3) + checkGate(§5.0)가 읽는 칸. `raw`는 무거워서 넣지 않는다. */
const POLICY_COLUMNS = [
  "id",
  "title",
  "summary",
  "org_name",
  "eligibility_text",
  "criteria_text",
  "support_text",
  "income_text",
  "etc_text",
  "apply_period",
  "biz_period_etc",
  "age_min",
  "age_max",
  "is_nationwide",
  "region_sidos",
  "region_sigungu",
  "audiences",
  "eligibility_codes",
].join(",");

type PolicyRow = PolicySourceFields & PolicyConditions & { id: string };

const GATE_REASON = "입력하신 조건과 맞지 않는 항목이 있습니다.";
const EMPTY_PROFILE_REASON = "판정에 쓸 조건이 비어 있습니다. 생년이나 사는 곳을 채워 주세요.";
const AI_FAILED_REASON = "판정하지 못했습니다. 다시 시도해 주세요.";

export async function POST(req: Request) {
  const startedAt = Date.now();
  const body: unknown = await req.json().catch(() => ({}));
  const requested = Array.isArray((body as { policyIds?: unknown }).policyIds)
    ? ((body as { policyIds: unknown[] }).policyIds.filter((v): v is string => typeof v === "string"))
    : [];

  if (requested.length === 0) {
    return NextResponse.json({ error: "policyIds가 필요합니다." }, { status: 400 });
  }
  const policyIds = [...new Set(requested)].slice(0, MAX_BATCH);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 익명 세션 생성 실패 (§7). 목록은 계속 보이지만 판정은 저장할 곳이 없다.
  if (!user) {
    // 이게 늘어나면 proxy.ts의 익명 로그인이 깨진 것이다 (§1.1) — 목록은 멀쩡해 보여서 늦게 드러난다.
    log.warn("verdicts.no_session");
    return NextResponse.json(
      { error: "세션이 없어 판정할 수 없습니다. 새로고침한 뒤 다시 시도해 주세요." },
      { status: 401 },
    );
  }

  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select(SIGNATURE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  // ⚠️ **조회 실패를 '조건 없음'으로 흘리면 안 된다.** 빈 프로필은 게이트를 전건 통과시키므로
  // 실패가 "아무 조건도 없는 사용자"로 둔갑해 엉뚱한 판정이 캐시에 저장된다 (작업 4의 빈 폼 사고와 같은 형태).
  if (profileError) {
    log.error("verdicts.profile_failed", { message: profileError.message });
    return NextResponse.json(
      { error: "내 조건을 읽지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
  if (!profileRow) {
    return NextResponse.json({ error: "먼저 내 조건을 입력해 주세요." }, { status: 400 });
  }

  const profile = profileRow as unknown as Profile;
  const signature = profileSignature(profile);
  const profileText = buildProfileText(profile);

  const { data: policyRows, error: policyError } = await supabase
    .from("policies")
    .select(POLICY_COLUMNS)
    .in("id", policyIds);

  if (policyError) {
    log.error("verdicts.policies_failed", { count: policyIds.length, message: policyError.message });
    return NextResponse.json(
      { error: "정책을 읽지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
  const policies = (policyRows ?? []) as unknown as PolicyRow[];

  // 캐시 — (정책, 사용자, 서명)이 같으면 다시 판정하지 않는다 (F-16). 서명이 다르면 안 잡히고 재판정된다.
  const { data: cached } = await supabase
    .from("verdicts")
    .select("policy_id, verdict, decided_by, reason, quote, quote_verified, blockers, checks")
    .eq("user_id", user.id)
    .eq("profile_signature", signature)
    .in("policy_id", policyIds);

  const verdicts: Record<string, DecidedVerdict> = {};
  for (const row of cached ?? []) {
    const { policy_id, ...v } = row as { policy_id: string } & DecidedVerdict;
    verdicts[policy_id] = v;
  }

  const stats = {
    requested: policyIds.length,
    cached: Object.keys(verdicts).length,
    gate_blocked: 0,
    /** Gemini에 실제로 보낸 건수. 완료 판정 1·4가 이 값이 0인지를 본다 */
    ai_called: 0,
    ai_failed: 0,
    save_error: null as string | null,
  };

  const toSave: (DecidedVerdict & { policy_id: string })[] = [];
  const forAi: PolicyRow[] = [];

  for (const policy of policies) {
    if (verdicts[policy.id]) continue;

    const gate = checkGate(policy, profile);
    if (!gate.pass) {
      // 코드로 답이 나온 건 AI를 부르지 않는다 (F-11a). blockers가 "왜 아닌지"를 말한다 (§7.5).
      stats.gate_blocked++;
      const decided: DecidedVerdict = {
        verdict: "ineligible",
        decided_by: "code",
        reason: GATE_REASON,
        quote: null,
        quote_verified: false,
        blockers: gate.blockers,
        checks: [],
      };
      verdicts[policy.id] = decided;
      toSave.push({ ...decided, policy_id: policy.id });
      continue;
    }

    // 모든 항목이 선택이라 조건이 통째로 빈 프로필이 저장될 수 있다 (작업 4).
    // 그 상태로 부르면 시스템 프롬프트 규칙 3에 따라 전건 unclear가 나온다 — 호출만 낭비다.
    // **저장하지 않는다**: 조건을 채우면 서명이 바뀌므로 캐시에 남길 이유도 없다.
    if (profileText === "") {
      verdicts[policy.id] = {
        verdict: "unclear",
        decided_by: "code",
        reason: EMPTY_PROFILE_REASON,
        quote: null,
        quote_verified: false,
        blockers: [],
        checks: [],
      };
      continue;
    }

    forAi.push(policy);
  }

  stats.ai_called = forAi.length;

  // 게이트 통과분만 병렬 호출. 건당 타임아웃은 gemini.ts 안에 있고, 이 함수는 throw하지 않는다.
  const answered = await Promise.all(
    forAi.map(async (policy) => {
      const sourceText = buildSourceText(policy);
      return { policy, sourceText, raw: await callGemini(profileText, sourceText) };
    }),
  );

  for (const { policy, sourceText, raw } of answered) {
    if (raw === null) {
      // 호출 자체가 실패했다 (키·네트워크·타임아웃). 해당 카드만 '애매'이고 다른 카드는 정상이다 (§7).
      // **저장하지 않는다** — 판정이 아니라 판정 못 함이라, 다시 누르면 재시도되어야 한다.
      stats.ai_failed++;
      verdicts[policy.id] = {
        verdict: "unclear",
        decided_by: "ai",
        reason: AI_FAILED_REASON,
        quote: null,
        quote_verified: false,
        blockers: [],
        checks: [],
      };
      continue;
    }

    // 검증 실패(인용이 원문에 없음)는 저장한다 — temperature 0이라 다시 물어도 같은 답이 온다 (§7.4).
    const v = validateVerdict(raw, sourceText);
    const decided: DecidedVerdict = {
      verdict: v.verdict,
      decided_by: "ai",
      reason: v.reason,
      quote: v.quote,
      quote_verified: v.quote_verified,
      blockers: v.blockers,
      checks: v.checks,
    };
    verdicts[policy.id] = decided;
    toSave.push({ ...decided, policy_id: policy.id });
  }

  if (toSave.length > 0) {
    // RLS가 한 번 더 막지만 user_id는 세션 값으로 고정한다 (§2.5).
    const { error } = await supabase.from("verdicts").upsert(
      toSave.map((row) => ({ ...row, user_id: user.id, profile_signature: signature })),
      { onConflict: "policy_id,user_id,profile_signature" },
    );
    // 저장 실패가 판정 결과를 못 쓰게 만들 이유는 없다. 화면엔 그대로 보여주고 다음 클릭에 다시 시도된다.
    if (error) {
      // 사용자는 판정을 정상으로 받는다. **다시 눌러도 캐시가 비어 또 부른다**는 게 진짜 비용이라
      // 화면에 안 보이는 이 실패를 로그로 세워둔다.
      stats.save_error = error.message;
      log.error("verdicts.save_failed", { count: toSave.length, message: error.message });
    }
  }

  // 호출 비용 장부 (PRD §7.7). `ai_called`가 0인지를 완료 판정 1·4가 보고,
  // `cached`와의 비율이 캐시가 실제로 듣고 있는지를 말해준다.
  log.info("verdicts.batch", { ...stats, durationMs: Date.now() - startedAt });

  return NextResponse.json({ verdicts, stats });
}
