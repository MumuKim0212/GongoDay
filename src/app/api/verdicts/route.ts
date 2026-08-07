import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { PAGE_SIZE } from "@/lib/policies/query";
import { createAdminClient } from "@/lib/supabase/admin";
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
 *
 * **응답은 NDJSON 스트림이다.** 한 줄에 JSON 하나:
 *
 * ```
 * {"t":"v","id":"<policy_id>","v":{…}}                 판정 한 건
 * {"t":"v","id":"…","v":{…},"failed":true}             AI 호출 실패 — 저장 안 함, 다시 부를 수 있다
 * {"t":"done","stats":{…}}                             마지막 줄
 * ```
 *
 * 판정을 시작하기 전에 끝난 실패(세션·프로필·조회)는 스트림이 아니라 상태코드 붙은 JSON이다 —
 * 스트림은 200으로 시작해버려서 그 뒤로는 실패를 알릴 방법이 없다.
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
    // **proxy는 API 경로에서 세션을 만들지 않는다** (§1.1) — 여기 오는 것은 쿠키를 잃었거나
    // 화면을 거치지 않고 부른 요청이다. 안내대로 새로고침하면 그때는 화면 요청이라 세션이 생긴다.
    // 다만 이게 꾸준히 늘면 proxy의 익명 로그인이 깨진 것일 수도 있다 — 목록은 멀쩡해 보여서
    // 늦게 드러나는 종류라 세어 둔다.
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

  // 캐시 — (정책, 서명)이 같으면 다시 판정하지 않는다 (F-16). 서명이 다르면 안 잡히고 재판정된다.
  // **사용자로 걸러지 않는다.** 판정은 서명과 원문에만 의존하므로 남이 부른 것도 그대로 쓴다 (§2.3).
  const db = createAdminClient();
  const { data: cached } = await db
    .from("verdicts")
    .select("policy_id, verdict, decided_by, reason, quote, quote_verified, blockers, checks")
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

  // 여기서부터 스트림이다. **묶어서 부르는 게 싼 게 아니었다** — 아래 호출은 예전부터 병렬이었고,
  // 응답이 JSON 한 덩어리라 제일 느린 1건이 나머지를 붙잡고 있었을 뿐이다. 끝나는 대로 한 줄씩 흘린다.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const line = (obj: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          // 클라이언트가 끊었다. **판정은 계속 받아 저장한다** — 이미 값을 치른 호출이라
          // 여기서 버리면 다음 방문에 똑같이 다시 부른다.
          open = false;
        }
      };

      // 캐시·게이트·빈 프로필분은 이미 답이 나와 있다. 첫 줄부터 배지가 붙는다.
      for (const [id, v] of Object.entries(verdicts)) line({ t: "v", id, v });

      // 게이트 통과분. 건당 타임아웃은 gemini.ts 안에 있고, 이 함수는 throw하지 않는다.
      await Promise.all(
        forAi.map(async (policy) => {
          const sourceText = buildSourceText(policy);
          const raw = await callGemini(profileText, sourceText);

          if (raw === null) {
            // 호출 자체가 실패했다 (키·네트워크·타임아웃). 이 카드만 '애매'이고 나머지는 정상이다 (§7).
            // **저장하지 않는다** — 판정이 아니라 판정 못 함이라 다시 부르면 재시도되어야 한다.
            // `failed`로 표시해 보내 화면이 '다시 판정' 손잡이를 띄울 수 있게 한다.
            stats.ai_failed++;
            line({
              t: "v",
              id: policy.id,
              failed: true,
              v: {
                verdict: "unclear",
                decided_by: "ai",
                reason: AI_FAILED_REASON,
                quote: null,
                quote_verified: false,
                blockers: [],
                checks: [],
              } satisfies DecidedVerdict,
            });
            return;
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
          toSave.push({ ...decided, policy_id: policy.id });
          line({ t: "v", id: policy.id, v: decided });
        }),
      );

      if (toSave.length > 0) {
        // 공유 캐시라 RLS 정책이 없다 — 이 라우트만 쓴다. 서명은 위에서 서버가 계산한 값이므로
        // 클라이언트가 남의 캐시 자리에 쓸 방법이 없다 (§2.5). `requested_by`는 기록일 뿐 키가 아니다.
        const { error } = await db.from("verdicts").upsert(
          toSave.map((row) => ({ ...row, requested_by: user.id, profile_signature: signature })),
          { onConflict: "policy_id,profile_signature" },
        );
        // 저장 실패가 판정 결과를 못 쓰게 만들 이유는 없다. 화면엔 그대로 보여주고 다음에 다시 시도된다.
        if (error) {
          // 사용자는 판정을 정상으로 받는다. **다시 열어도 캐시가 비어 또 부른다**는 게 진짜 비용이라
          // 화면에 안 보이는 이 실패를 로그로 세워둔다.
          stats.save_error = error.message;
          log.error("verdicts.save_failed", { count: toSave.length, message: error.message });
        }
      }

      // 호출 비용 장부 (PRD §7.7). `ai_called`가 0인지를 완료 판정 1·4가 보고,
      // `cached`와의 비율이 캐시가 실제로 듣고 있는지를 말해준다.
      log.info("verdicts.batch", { ...stats, durationMs: Date.now() - startedAt });

      line({ t: "done", stats });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // 중간 프록시가 버퍼링하면 스트리밍이 통째로 무의미해진다
      "X-Accel-Buffering": "no",
    },
  });
}
