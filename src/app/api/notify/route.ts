import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyGate, callAndValidate } from "@/lib/verdict/decide";
import type { PolicyConditions, Profile } from "@/lib/verdict/gate";
import { buildProfileText, type PolicySourceFields } from "@/lib/verdict/prompt";
import { scoreOf } from "@/lib/verdict/score";
import { SIGNATURE_COLUMNS, profileSignature } from "@/lib/verdict/signature";
import type { DecidedVerdict } from "@/lib/verdict/validate";
import { sendMessage } from "@/lib/telegram/client";

/**
 * 텔레그램 알림 배치 — **매시간 크론 전용** (`.github/workflows/sync.yml`, `/api/sync` 다음 스텝).
 *
 * ```
 * notify_checked_at이 null인 정책을 오래된 순으로 조회 (최대 MAX_POLICIES건)
 *   → 텔레그램 연동 사용자 전체 조회, 서명별로 묶는다
 *   → (정책, 서명) 조합을 verdicts 캐시로 우선 채운다 (§2.3과 같은 원리 — 서명이 같으면 공유)
 *   → 캐시 미스만 게이트 → AI 판정 (AI_CONCURRENCY건씩) → verdicts에 upsert
 *   → 점수가 사용자의 telegram_notify_min_score 이상이고 아직 안 보낸 조합만 발송
 *   → 처리한 정책에 notify_checked_at을 찍는다
 * ```
 *
 * `/api/verdicts`와 인증·격리 원칙은 같다: `CRON_SECRET` Bearer, 개별 실패는 로그로 삼키고
 * 나머지를 막지 않는다. 다른 점은 응답 대상이 사람이 아니라 크론이라 스트림이 아니라 요약 JSON이다.
 *
 * **어디까지 했는지는 배치가 아니라 정책 행이 들고 있다** (`policies.notify_checked_at`).
 * 시간 커서를 쓰지 않는 이유는 스키마 주석에 적혀 있다 — 수집이 100건을 한 문장으로 넣어
 * `created_at`이 동률이고, 판정에 실패해 다시 봐야 하는 건을 커서로는 표현할 수 없다.
 * 표시는 발송까지 끝난 뒤에 찍으므로 중간에 끊기면 그 정책들은 다음 배치가 그대로 다시 본다
 * (캐시와 발송 이력이 있어 비용도 중복 발송도 늘지 않는다).
 */

// 빼먹으면 로컬은 되고 배포에서만 끊긴다 (§4, §5.1.1과 같은 이유).
export const maxDuration = 60;

/** 한 배치가 처리하는 미처리 정책 상한. 실측 후 조정 — 수신자 수만큼 (정책, 서명) 조합이 곱해진다. */
const MAX_POLICIES = 50;

/**
 * 한 번에 띄우는 Gemini 호출 수. `/api/verdicts`의 한 페이지(10건)와 같은 값이다 —
 * "건당 15초 × 10건 병렬이면 라우트 상한 60초 안에 들어간다"는 계산이 그 수를 전제로 한다 (§5.1.1).
 *
 * 여기서 세는 단위는 정책이 아니라 (정책 × 서명) 조합이라 전부 한꺼번에 띄우면 수백 건이 된다.
 * 그러면 429로 무더기 실패하고, 실패분은 다음 배치로 밀려 매시간 같은 자리를 맴돈다.
 */
const AI_CONCURRENCY = 10;

/** notify가 읽는 정책 칸. buildSourceText + checkGate가 읽는 칸(§5.3, §5.0) + 알림 메시지용 source_url. */
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
  "source_url",
].join(",");

type PolicyRow = PolicySourceFields & PolicyConditions & { id: string; source_url: string | null };

type Recipient = Profile & { id: string; telegram_chat_id: string; telegram_notify_min_score: number };

type SignatureGroup = { profile: Profile; profileText: string; recipients: Recipient[] };

type Stats = {
  policiesFound: number;
  checked: number;
  recipients: number;
  aiCalled: number;
  aiFailed: number;
  sent: number;
  sendFailed: number;
  promptTokens: number;
  outputTokens: number;
};

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log.error("notify.rejected", { reason: "no_cron_secret" });
    return NextResponse.json({ error: "CRON_SECRET이 설정되지 않았습니다." }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    log.warn("notify.rejected", { reason: "bad_auth" });
    return NextResponse.json({ error: "인증 실패" }, { status: 401 });
  }

  const startedAt = Date.now();
  const db = createAdminClient();

  const { data: run, error: runError } = await db
    .from("notify_runs")
    .insert({ started_at: new Date().toISOString() })
    .select("id")
    .single();
  if (runError) log.error("notify.run_row_failed", { message: runError.message });
  const runId: string | undefined = run?.id;

  const stats: Stats = {
    policiesFound: 0,
    checked: 0,
    recipients: 0,
    aiCalled: 0,
    aiFailed: 0,
    sent: 0,
    sendFailed: 0,
    promptTokens: 0,
    outputTokens: 0,
  };

  // MAX_POLICIES + 1을 가져와 "더 남았는지"(done)를 추가 쿼리 없이 판별한다.
  const { data: policyRows, error: policyError } = await db
    .from("policies")
    .select(POLICY_COLUMNS)
    .is("notify_checked_at", null)
    .order("created_at", { ascending: true })
    .limit(MAX_POLICIES + 1);

  if (policyError) {
    log.error("notify.policies_failed", { message: policyError.message });
    await finishRun(db, runId, { ...toRunFields(stats), error: policyError.message });
    return NextResponse.json({ error: "정책을 읽지 못했습니다." }, { status: 500 });
  }

  const fetched = (policyRows ?? []) as unknown as PolicyRow[];
  const done = fetched.length <= MAX_POLICIES;
  const policies = done ? fetched : fetched.slice(0, MAX_POLICIES);
  stats.policiesFound = policies.length;

  if (policies.length === 0) {
    await finishRun(db, runId, toRunFields(stats));
    return NextResponse.json({ ...stats, done: true });
  }

  const { data: recipientRows, error: recipientError } = await db
    .from("profiles")
    .select(`${SIGNATURE_COLUMNS}, id, telegram_chat_id, telegram_notify_min_score`)
    .not("telegram_chat_id", "is", null)
    .not("telegram_notify_min_score", "is", null);
  if (recipientError) {
    log.error("notify.recipients_failed", { message: recipientError.message });
    await finishRun(db, runId, { ...toRunFields(stats), error: recipientError.message });
    return NextResponse.json({ error: "수신자를 읽지 못했습니다." }, { status: 500 });
  }
  const recipients = (recipientRows ?? []) as unknown as Recipient[];
  stats.recipients = recipients.length;

  if (recipients.length === 0) {
    // 받을 사람이 없어도 처리한 것으로 표시한다 — 안 그러면 다음 배치가 이 정책들을 계속
    // 신규로 보고, 그사이 새로 연동한 사람에게 며칠 지난 공고가 몰려간다.
    stats.checked = await markChecked(db, policies.map((p) => p.id));
    await finishRun(db, runId, toRunFields(stats));
    return NextResponse.json({ ...stats, done });
  }

  // 서명별로 프로필을 하나만 남긴다 — 같은 조건인 사용자는 캐시 조회·AI 호출을 공유한다 (§2.3과 동일).
  const bySignature = new Map<string, SignatureGroup>();
  for (const r of recipients) {
    const signature = profileSignature(r);
    let group = bySignature.get(signature);
    if (!group) {
      group = { profile: r, profileText: buildProfileText(r), recipients: [] };
      bySignature.set(signature, group);
    }
    group.recipients.push(r);
  }
  const signatures = [...bySignature.keys()];
  const policyIds = policies.map((p) => p.id);

  // 캐시 우선 조회 — /api/verdicts가 쓰는 것과 같은 verdicts 테이블을 그대로 재사용한다.
  const { data: cachedRows, error: cacheError } = await db
    .from("verdicts")
    .select("policy_id, profile_signature, verdict, decided_by, reason, quote, quote_verified, blockers, checks")
    .in("policy_id", policyIds)
    .in("profile_signature", signatures);
  if (cacheError) log.error("notify.cache_failed", { message: cacheError.message });

  const cache = new Map<string, DecidedVerdict>();
  for (const row of cachedRows ?? []) {
    const r = row as { policy_id: string; profile_signature: string } & DecidedVerdict;
    cache.set(`${r.policy_id}:${r.profile_signature}`, r);
  }

  // 이미 보낸 (정책, 사용자) 조합을 한 번에 가져온다 — 발송 루프에서 매번 쿼리하지 않는다.
  const recipientIds = recipients.map((r) => r.id);
  const { data: notifiedRows, error: notifiedError } = await db
    .from("telegram_notified")
    .select("policy_id, profile_id")
    .in("policy_id", policyIds)
    .in("profile_id", recipientIds);
  if (notifiedError) log.error("notify.notified_lookup_failed", { message: notifiedError.message });
  const alreadyNotified = new Set((notifiedRows ?? []).map((r) => `${r.policy_id}:${r.profile_id}`));

  const toSave: (DecidedVerdict & { policy_id: string; profile_signature: string })[] = [];
  const toNotify: { policy: PolicyRow; signature: string; verdict: DecidedVerdict }[] = [];
  const aiJobs: { policy: PolicyRow; signature: string; group: SignatureGroup }[] = [];

  // 캐시·게이트는 호출이 없어 여기서 다 끝난다. 남는 것만 AI로 넘긴다.
  for (const policy of policies) {
    for (const [signature, group] of bySignature) {
      const cached = cache.get(`${policy.id}:${signature}`);
      if (cached) {
        toNotify.push({ policy, signature, verdict: cached });
        continue;
      }

      const gated = applyGate(policy, group.profile);
      if (gated !== null) {
        toSave.push({ ...gated, policy_id: policy.id, profile_signature: signature });
        toNotify.push({ policy, signature, verdict: gated });
        continue;
      }

      if (group.profileText === "") continue; // 빈 프로필은 판정 자체를 시도하지 않는다 (§5)

      aiJobs.push({ policy, signature, group });
    }
  }

  // 판정하지 못한 정책. **표시하지 않고 남겨 다음 배치가 다시 본다** — 커서였다면 이미 지나가
  // 영영 못 보던 자리다. 성공한 조합은 verdicts에 저장돼 다음 배치에서 캐시로 잡히므로 다시 부르지 않는다.
  const aiFailedPolicies = new Set<string>();

  for (let i = 0; i < aiJobs.length; i += AI_CONCURRENCY) {
    await Promise.all(
      aiJobs.slice(i, i + AI_CONCURRENCY).map(async ({ policy, signature, group }) => {
        stats.aiCalled++;
        const { decided, usage, failed } = await callAndValidate(group.profileText, policy);
        stats.promptTokens += usage.promptTokens;
        stats.outputTokens += usage.outputTokens;
        if (failed) {
          stats.aiFailed++;
          aiFailedPolicies.add(policy.id);
          return;
        }

        toSave.push({ ...decided, policy_id: policy.id, profile_signature: signature });
        toNotify.push({ policy, signature, verdict: decided });
      }),
    );
  }

  if (toSave.length > 0) {
    const { error } = await db
      .from("verdicts")
      .upsert(toSave, { onConflict: "policy_id,profile_signature" });
    if (error) log.error("notify.save_failed", { count: toSave.length, message: error.message });
  }

  // 발송 — 정책 × 서명이 아니라 정책 × 사용자 단위다. 같은 서명이라도 사용자마다 원하는
  // 최소 점수·발송 이력이 다르다. 텔레그램 API 제한(초당 ~30건)을 고려해 순차로 보낸다.
  const sentPairs: { policy_id: string; profile_id: string }[] = [];
  for (const { policy, signature, verdict } of toNotify) {
    const score = scoreOf(verdict);
    const group = bySignature.get(signature);
    if (!group) continue;

    for (const recipient of group.recipients) {
      if (score < recipient.telegram_notify_min_score) continue;
      if (alreadyNotified.has(`${policy.id}:${recipient.id}`)) continue;

      const result = await sendMessage(recipient.telegram_chat_id, formatMessage(policy, verdict, score));
      if (result.ok) {
        stats.sent++;
        sentPairs.push({ policy_id: policy.id, profile_id: recipient.id });
      } else {
        // **발송 실패는 재시도하지 않는다** (정책은 아래에서 그대로 처리 완료로 표시된다).
        // 봇 차단(403)은 영구 상태라 재시도로 낫지 않는데, 남겨두면 그 한 사람 때문에 배치가
        // 매시간 같은 정책을 다시 붙들고 앞으로 나아가지 못한다. 판정 실패와 다루는 방향이 반대인 이유다.
        stats.sendFailed++;
        log.warn("notify.send_failed", { profileId: recipient.id, reason: result.reason });
      }
    }
  }

  if (sentPairs.length > 0) {
    // 이미 있는 조합은 무시한다 — 한 건의 중복이 insert 전체를 실패시키면 이번 배치의 발송 이력이
    // 통째로 사라져 다음 시간에 같은 알림이 다시 간다.
    const { error } = await db
      .from("telegram_notified")
      .upsert(sentPairs, { onConflict: "policy_id,profile_id", ignoreDuplicates: true });
    if (error) log.error("notify.mark_sent_failed", { count: sentPairs.length, message: error.message });
  }

  stats.checked = await markChecked(
    db,
    policyIds.filter((id) => !aiFailedPolicies.has(id)),
  );

  await finishRun(db, runId, toRunFields(stats));

  const durationMs = Date.now() - startedAt;
  log.info("notify.batch", { ...stats, done, durationMs });

  return NextResponse.json({ ...stats, done });
}

/**
 * 처리 완료 표시. 여기가 곧 "다음 배치가 이 정책을 다시 보지 않는다"는 뜻이다.
 *
 * 실패해도 응답을 세우지 않는다 — 다음 배치가 같은 정책을 다시 보면 되고, 캐시(`verdicts`)와
 * 발송 이력(`telegram_notified`)이 있어 AI 호출도 중복 발송도 늘지 않는다.
 */
async function markChecked(db: ReturnType<typeof createAdminClient>, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const { error } = await db
    .from("policies")
    .update({ notify_checked_at: new Date().toISOString() })
    .in("id", ids);
  if (error) {
    log.error("notify.mark_checked_failed", { count: ids.length, message: error.message });
    return 0;
  }
  return ids.length;
}

function toRunFields(stats: Stats) {
  return {
    policies_found: stats.policiesFound,
    checked: stats.checked,
    recipients: stats.recipients,
    ai_called: stats.aiCalled,
    ai_failed: stats.aiFailed,
    sent: stats.sent,
    send_failed: stats.sendFailed,
    prompt_tokens: stats.promptTokens,
    output_tokens: stats.outputTokens,
  };
}

async function finishRun(
  db: ReturnType<typeof createAdminClient>,
  runId: string | undefined,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!runId) return;
  const { error } = await db
    .from("notify_runs")
    .update({ finished_at: new Date().toISOString(), ...fields })
    .eq("id", runId);
  if (error) log.warn("notify.run_update_failed", { message: error.message });
}

/**
 * 텔레그램 메시지 본문. HTML parse_mode — Markdown은 정책명의 특수문자로 파싱 에러가 잦다.
 *
 * **제목만 굵게 한다.** 한 배치에 여러 건이 걸리면 메시지가 건별로 연달아 오는데, 제목과
 * 확인 항목·이유가 같은 굵기면 어디서 한 건이 끝나는지 눈으로 잡히지 않는다.
 * 태그는 여기서만 넣고 값은 그 전에 이스케이프한다 — 정책명에 든 `<`가 태그로 읽히면 안 된다.
 */
function formatMessage(policy: PolicyRow, verdict: DecidedVerdict, score: number): string {
  const lines = [`[${score}점] <b>${escapeHtml(policy.title)}</b>`];
  if (verdict.checks.length > 0) {
    lines.push(`확인 ${verdict.checks.length}개: ${escapeHtml(verdict.checks[0])}`);
  }
  if (verdict.reason) lines.push(escapeHtml(verdict.reason));
  if (policy.source_url) lines.push("", `원문: ${escapeHtml(policy.source_url)}`);
  return lines.join("\n");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
