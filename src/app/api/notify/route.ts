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
 * policies.created_at 커서로 신규 정책 조회 (최대 MAX_POLICIES건)
 *   → 텔레그램 연동 사용자 전체 조회, 서명별로 묶는다
 *   → (정책, 서명) 조합을 verdicts 캐시로 우선 채운다 (§2.3과 같은 원리 — 서명이 같으면 공유)
 *   → 캐시 미스만 게이트 → AI 판정 → verdicts에 upsert
 *   → 점수가 사용자의 telegram_notify_min_score 이상이고 아직 안 보낸 조합만 발송
 * ```
 *
 * `/api/verdicts`와 인증·격리 원칙은 같다: `CRON_SECRET` Bearer, 개별 실패는 로그로 삼키고
 * 나머지를 막지 않는다. 다른 점은 응답 대상이 사람이 아니라 크론이라 스트림이 아니라 요약 JSON이다.
 *
 * **커서는 정책 단위다** (`notify_runs.cursor_after`, `runSync`의 `last_page`와 같은 이어받기).
 * 이번 배치가 정책을 MAX_POLICIES건 다 못 훑으면(수신자 × 정책이 많을 때) 커서를 끝까지
 * 전진시키지 않고 다음 크론이 이어받는다 — sync.ts의 `lastCompleted`와 같은 사고방식.
 */

// 빼먹으면 로컬은 되고 배포에서만 끊긴다 (§4, §5.1.1과 같은 이유).
export const maxDuration = 60;

/** 한 배치가 조회하는 신규 정책 상한. 실측 후 조정 — 수신자 수만큼 (정책, 서명) 조합이 곱해진다. */
const MAX_POLICIES = 50;

/** notify.ts가 읽는 정책 칸. buildSourceText + checkGate가 읽는 칸(§5.3, §5.0) + 알림 메시지용 source_url. */
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
  "created_at",
].join(",");

type PolicyRow = PolicySourceFields &
  PolicyConditions & { id: string; source_url: string | null; created_at: string };

type Recipient = Profile & { id: string; telegram_chat_id: string; telegram_notify_min_score: number };

type SignatureGroup = { profile: Profile; profileText: string; recipients: Recipient[] };

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

  const { data: prev } = await db
    .from("notify_runs")
    .select("cursor_after")
    .is("error", null)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const cursorBefore: string | null = prev?.cursor_after ?? null;

  const { data: run, error: runError } = await db
    .from("notify_runs")
    .insert({ cursor_before: cursorBefore })
    .select("id")
    .single();
  if (runError) log.error("notify.run_row_failed", { message: runError.message });
  const runId: string | undefined = run?.id;

  // MAX_POLICIES + 1을 가져와 "더 남았는지"(done)를 추가 쿼리 없이 판별한다.
  let policiesQuery = db
    .from("policies")
    .select(POLICY_COLUMNS)
    .order("created_at", { ascending: true })
    .limit(MAX_POLICIES + 1);
  if (cursorBefore !== null) policiesQuery = policiesQuery.gt("created_at", cursorBefore);

  const { data: policyRows, error: policyError } = await policiesQuery;
  if (policyError) {
    log.error("notify.policies_failed", { message: policyError.message });
    await finishRun(db, runId, { error: policyError.message, cursor_before: cursorBefore, cursor_after: cursorBefore });
    return NextResponse.json({ error: "정책을 읽지 못했습니다." }, { status: 500 });
  }

  const fetched = (policyRows ?? []) as unknown as PolicyRow[];
  const done = fetched.length <= MAX_POLICIES;
  const policies = done ? fetched : fetched.slice(0, MAX_POLICIES);
  // 이번 배치가 완전히 처리하는 마지막 정책의 created_at까지만 커서를 전진시킨다.
  const cursorAfter = policies.length > 0 ? policies[policies.length - 1].created_at : cursorBefore;

  if (policies.length === 0) {
    await finishRun(db, runId, { cursor_before: cursorBefore, cursor_after: cursorAfter });
    return NextResponse.json({ policiesFound: 0, recipients: 0, sent: 0, done: true });
  }

  const { data: recipientRows, error: recipientError } = await db
    .from("profiles")
    .select(`${SIGNATURE_COLUMNS}, id, telegram_chat_id, telegram_notify_min_score`)
    .not("telegram_chat_id", "is", null)
    .not("telegram_notify_min_score", "is", null);
  if (recipientError) {
    log.error("notify.recipients_failed", { message: recipientError.message });
    await finishRun(db, runId, {
      error: recipientError.message,
      cursor_before: cursorBefore,
      cursor_after: cursorAfter,
    });
    return NextResponse.json({ error: "수신자를 읽지 못했습니다." }, { status: 500 });
  }
  const recipients = (recipientRows ?? []) as unknown as Recipient[];

  const stats = {
    policiesFound: policies.length,
    recipients: recipients.length,
    aiCalled: 0,
    aiFailed: 0,
    sent: 0,
    sendFailed: 0,
    promptTokens: 0,
    outputTokens: 0,
  };

  if (recipients.length === 0) {
    // 받을 사람이 없어도 커서는 전진시킨다 — 안 그러면 다음 배치가 이 정책들을 다시 "신규"로
    // 보고, 그사이 새로 연동한 사람에게 며칠 지난 공고가 몰려간다.
    await finishRun(db, runId, {
      ...toRunFields(stats),
      cursor_before: cursorBefore,
      cursor_after: cursorAfter,
    });
    return NextResponse.json({ ...stats, done: true });
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

  await Promise.all(
    policies.flatMap((policy) =>
      signatures.map(async (signature) => {
        const key = `${policy.id}:${signature}`;
        const cached = cache.get(key);
        if (cached) {
          toNotify.push({ policy, signature, verdict: cached });
          return;
        }

        const group = bySignature.get(signature);
        if (!group) return;

        const gated = applyGate(policy, group.profile);
        if (gated !== null) {
          toSave.push({ ...gated, policy_id: policy.id, profile_signature: signature });
          toNotify.push({ policy, signature, verdict: gated });
          return;
        }

        if (group.profileText === "") return; // 빈 프로필은 판정 자체를 시도하지 않는다 (§5)

        stats.aiCalled++;
        const { decided, usage, failed } = await callAndValidate(group.profileText, policy);
        stats.promptTokens += usage.promptTokens;
        stats.outputTokens += usage.outputTokens;
        if (failed) {
          stats.aiFailed++;
          return; // 판정 못 함 — 저장도 알림도 하지 않는다. 다음 배치가 다시 시도한다.
        }

        toSave.push({ ...decided, policy_id: policy.id, profile_signature: signature });
        toNotify.push({ policy, signature, verdict: decided });
      }),
    ),
  );

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
        // 실패는 이력에 남기지 않는다 — 다음 배치가 재시도한다. 일시 장애와 영구 차단(403)을
        // 구분해 후자만 연동 해제하는 것은 지금은 하지 않는다.
        stats.sendFailed++;
        log.warn("notify.send_failed", { profileId: recipient.id, reason: result.reason });
      }
    }
  }

  if (sentPairs.length > 0) {
    const { error } = await db.from("telegram_notified").insert(sentPairs);
    if (error) log.error("notify.mark_sent_failed", { count: sentPairs.length, message: error.message });
  }

  await finishRun(db, runId, {
    ...toRunFields(stats),
    cursor_before: cursorBefore,
    cursor_after: cursorAfter,
  });

  const durationMs = Date.now() - startedAt;
  log.info("notify.batch", { ...stats, done, durationMs });

  return NextResponse.json({ ...stats, done });
}

function toRunFields(stats: {
  policiesFound: number;
  recipients: number;
  aiCalled: number;
  aiFailed: number;
  sent: number;
  sendFailed: number;
  promptTokens: number;
  outputTokens: number;
}) {
  return {
    policies_found: stats.policiesFound,
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

/** 텔레그램 메시지 본문. HTML parse_mode — Markdown은 정책명의 특수문자로 파싱 에러가 잦다. */
function formatMessage(policy: PolicyRow, verdict: DecidedVerdict, score: number): string {
  const lines = [`[${score}점] ${escapeHtml(policy.title)}`];
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
