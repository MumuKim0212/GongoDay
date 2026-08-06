/**
 * 운영 현황 집계가 실데이터에서 도는지 확인한다 (`src/lib/admin/stats.ts`).
 *
 *   npx tsx scripts/admin-check.mts
 *
 * 화면이 아니라 **PostgREST 문법**이 핵심이다. 배열 컬럼 비교(`ov`/`not.eq.{}`)와
 * `or(...not.is.null)`은 틀려도 예외가 아니라 **조용히 0건**으로 돌아온다.
 * 0으로 보이는 칸이 "없다"인지 "쿼리가 틀렸다"인지 여기서 가른다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchAdminStats } from "../src/lib/admin/stats";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(repoRoot, ".env.local"), "utf8").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

// 화면과 같은 키를 쓴다 — verdicts는 RLS가 본인 행만 열어주므로 anon으로는 집계가 0이 된다.
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const s = await fetchAdminStats(db);

const pass: string[] = [];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") =>
  (ok ? pass : fail).push(`${label}${detail ? ` — ${detail}` : ""}`);

const num = (v: number | null) => (v === null ? "실패" : v.toLocaleString("ko-KR"));

console.log(`\n집계 ${s.dbMs}ms`);

console.log("\n[공고]");
console.log(`  전체 ${num(s.policies.total)} · 온통청년 ${num(s.policies.youth)} · 정부24 ${num(s.policies.gov24)}`);
console.log(`  최신 등록 ${s.policies.latestRegisteredAt ?? "없음"}`);

console.log("\n[분야]");
for (const c of s.categories) console.log(`  ${c.label.padEnd(12)} ${num(c.count)}`);

console.log("\n[지역]");
for (const r of s.regions) console.log(`  ${r.label.padEnd(24)} ${num(r.count)}`);

console.log("\n[채움률]");
for (const f of s.fill) {
  const base = f.base === "youth" ? s.policies.youth : s.policies.total;
  const pct = f.count !== null && base ? ` (${((f.count / base) * 100).toFixed(1)}%)` : "";
  console.log(`  ${f.label.padEnd(26)} ${num(f.count)}${pct}`);
}

console.log("\n[판정]");
console.log(`  전체 ${num(s.verdicts.total)} · AI ${num(s.verdicts.ai)} · 검증통과 ${num(s.verdicts.quoteVerified)}`);
console.log(`  아님인데 blockers 빔 ${num(s.verdicts.ineligibleNoBlockers)}`);
for (const v of s.verdicts.byVerdict) console.log(`  ${v.label.padEnd(12)} ${num(v.count)}`);
for (const d of s.verdicts.byDecider) console.log(`  ${d.label.padEnd(12)} ${num(d.count)}`);

console.log("\n[수집]");
for (const r of s.sync) {
  console.log(`  ${r.source.padEnd(6)} 성공 ${r.lastSuccessAt ?? "없음"} · 실행 ${r.runCount}건 · last_page ${r.lastPage} · ${r.error ?? "오류 없음"}`);
}

// ── 판정 ─────────────────────────────────────────────
// 조회 실패(null)가 하나도 없어야 한다. 0건과 실패는 다르다.
const nulls = [
  s.policies.total, s.policies.youth, s.policies.gov24,
  ...s.categories.map((c) => c.count),
  ...s.regions.map((r) => r.count),
  ...s.fill.map((f) => f.count),
  s.verdicts.total, s.verdicts.quoted, s.verdicts.quoteVerified,
].filter((v) => v === null).length;
check(nulls === 0, "조회 실패 0건", `${nulls}건 실패`);

check(s.policies.total === 13662, "전체 13,662건", num(s.policies.total));
check(
  (s.policies.youth ?? 0) + (s.policies.gov24 ?? 0) === s.policies.total,
  "소스별 합 = 전체",
);

// 분야는 중복 소속이 있어 합이 전체보다 크다. 반대로 0이면 배열 겹침 비교가 깨진 것이다.
const catSum = s.categories.reduce((a, c) => a + (c.count ?? 0), 0);
check(catSum >= (s.policies.total ?? 0), "분야 합 ≥ 전체 (중복 소속)", num(catSum));
check(s.categories.every((c) => (c.count ?? 0) > 0 || c.label === "기타"), "빈 분야 없음");

// TODO 2c·§2b 실측과 대조 — 여기서 어긋나면 데이터나 매핑이 바뀐 것이다
const sido = (name: string) => s.regions.find((r) => r.label === name)?.count ?? null;
check((sido("서울특별시") ?? 0) > 0 && (sido("경기도") ?? 0) > 0, "수도권 시도별 건수 > 0");
check((s.regions.find((r) => r.label.includes("판별 실패"))?.count ?? 0) > 0, "판별 실패 집계가 잡힌다");

const audiences = s.fill.find((f) => f.label === "사용자구분 있음")?.count ?? 0;
check(audiences > 0 && audiences <= (s.policies.gov24 ?? 0), "사용자구분은 정부24에만 있다", num(audiences));

const youthElig = s.fill.find((f) => f.base === "youth")?.count ?? 0;
const youthPct = ((youthElig / (s.policies.youth ?? 1)) * 100).toFixed(1);
check(youthPct === "33.7", "온통청년 지원대상 채움률 33.7%", `${youthPct}%`);

// ── 판정 (작업 6 이후에야 의미가 생긴다) ──────────────
const v = s.verdicts;
if ((v.total ?? 0) === 0) {
  console.log("\n판정이 0건이라 판정 검사는 건너뛴다.");
} else {
  const sum = (rows: typeof v.byVerdict) => rows.reduce((a, r) => a + (r.count ?? 0), 0);
  check(sum(v.byVerdict) === v.total, "결과 분포 합 = 전체", `${sum(v.byVerdict)} vs ${num(v.total)}`);
  check(sum(v.byDecider) === v.total, "판정 주체 합 = 전체", `${sum(v.byDecider)} vs ${num(v.total)}`);

  // 검증에 실패한 인용은 validate.ts가 null로 지우고 저장한다. 그래서 이 둘은 항상 같은 집합이고,
  // **인용 검증률의 분모로 quote 건수를 쓰면 무조건 100%가 나온다.** 화면은 AI 판정 수로 나눈다.
  check(v.quoted === v.quoteVerified, "quote 있음 = quote_verified (분모로 쓰면 안 되는 이유)", `${num(v.quoted)} / ${num(v.quoteVerified)}`);

  check(
    (v.quoteVerified ?? 0) <= (v.ai ?? 0),
    "인용 검증 통과 ≤ AI 판정 (코드 게이트는 인용을 남기지 않는다)",
    `${num(v.quoteVerified)} / ${num(v.ai)}`,
  );

  // 0이 아니어도 실패는 아니다 — AI가 blockers를 비워 보낼 수 있다. 수치를 눈에 띄게 남긴다.
  const noBlockers = v.ineligibleNoBlockers ?? 0;
  const ineligible = v.byVerdict.find((r) => r.label === "아님")?.count ?? 0;
  check(noBlockers <= ineligible, "blockers 빈 '아님' ≤ 전체 '아님'", `${noBlockers} / ${ineligible}`);
  if (noBlockers > 0) {
    console.log(`\n⚠ '아님' ${ineligible}건 중 ${noBlockers}건에 blockers가 없다 — 카드 설명이 reason 한 줄뿐이다 (PRD §7.5).`);
  }
}

console.log(`\n통과 ${pass.length} / 실패 ${fail.length}`);
for (const f of fail) console.log(`  ✗ ${f}`);
process.exit(fail.length > 0 ? 1 : 0);
