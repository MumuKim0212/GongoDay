// 게이트를 실데이터에 붙여 본다 (진단용 — 완료 판정 아님)
//
//   npx tsx scripts/gate-probe.mts
//
// 보는 것 셋:
//  1. 대표 프로필로 게이트 통과/불일치 분포 — 게이트가 실제로 무는지
//  2. 코드 채움 실태 — no_limit·해당사항없음·age_max=120이 실제로 얼마나 오는지
//  3. ★ 목록 SQL 1차 필터와 게이트가 같은 답을 내는지 (ARCHITECTURE §5.0.1의 의도된 중복)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkGate, type PolicyConditions, type Profile } from "../src/lib/verdict/gate";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** 대표 프로필 — 28세 · 서울 · 근로자 · 1인가구 (TODO 2c). 성별·소득·사업자는 미입력 */
const REF_YEAR = 2026;
const ME: Profile = {
  birth_year: 1998,
  gender: null,
  region_sido: "11",
  region_sigungu: null,
  income_bracket: null,
  situations: ["JA0326"],
  household: ["JA0404"],
  business_status: null,
};

type Row = PolicyConditions & { id: string; source: string; title: string; categories: string[] };

const COLUMNS =
  "id,source,title,age_min,age_max,is_nationwide,region_sidos,region_sigungu,audiences,eligibility_codes,categories";

async function fetchAll(): Promise<Row[]> {
  const rows: Row[] = [];
  const size = 1000;
  for (let offset = 0; ; offset += size) {
    const res = await fetch(
      `${URL_}/rest/v1/policies?select=${COLUMNS}&order=id&limit=${size}&offset=${offset}`,
      { headers: { apikey: ANON } },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    const page = (await res.json()) as Row[];
    rows.push(...page);
    process.stdout.write(`\r  받는 중 ${rows.length}건`);
    if (page.length < size) break;
  }
  process.stdout.write("\n");
  return rows;
}

/** 목록 SQL 1차 필터의 나이·지역 부분을 그대로 옮긴 것 (§5.0.1). 분야는 게이트가 안 보므로 제외 */
function passesSqlFilter(p: Row, age: number, sido: string, sigungu: string | null): boolean {
  const sidoOk = p.is_nationwide || p.region_sidos.includes(sido);
  const sigunguOk = sigungu === null || p.region_sigungu === null || p.region_sigungu === sigungu;
  const minOk = p.age_min === null || p.age_min <= age + 1;
  const maxOk = p.age_max === null || p.age_max >= age - 1;
  return sidoOk && sigunguOk && minOk && maxOk;
}

/** 게이트에서 나이·지역만 떼어 본다 — SQL과 비교하려면 같은 조건만 봐야 한다 */
function gateRegionAgeOnly(p: Row, who: Profile): boolean {
  const stripped: PolicyConditions = { ...p, eligibility_codes: {} };
  return checkGate(stripped, who, REF_YEAR).pass;
}

const rows = await fetchAll();
const age = REF_YEAR - ME.birth_year!;

// ─── 1. 게이트 분포 ───────────────────────────────────────────
const bySource = new Map<string, { total: number; pass: number }>();
const blockerCount = new Map<string, number>();
let passed = 0;

for (const row of rows) {
  const result = checkGate(row, ME, REF_YEAR);
  const stat = bySource.get(row.source) ?? { total: 0, pass: 0 };
  stat.total++;
  if (result.pass) {
    stat.pass++;
    passed++;
  } else {
    for (const b of result.blockers) {
      // 나이 블로커는 숫자가 붙어 종류가 폭발하므로 앞부분만 센다
      const key = b.split(" (")[0];
      blockerCount.set(key, (blockerCount.get(key) ?? 0) + 1);
    }
  }
  bySource.set(row.source, stat);
}

console.log(`\n대표 프로필: ${age}세 · 서울 · 근로자(JA0326) · 1인가구(JA0404)`);
console.log(`전체 ${rows.length}건 → 게이트 통과 ${passed}건 (${pct(passed, rows.length)})\n`);

console.log("소스별");
for (const [source, s] of [...bySource].sort()) {
  console.log(`  ${source.padEnd(6)} ${String(s.pass).padStart(6)} / ${String(s.total).padStart(6)}  ${pct(s.pass, s.total)}`);
}

console.log("\n불일치 사유 (건별 중복 집계)");
for (const [reason, n] of [...blockerCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(6)}  ${reason}`);
}

// ─── 2. 코드 채움 실태 ───────────────────────────────────────
const has = (f: (r: Row) => boolean) => rows.filter(f).length;
const group = (r: Row, g: "gender" | "income" | "situation" | "household" | "business") =>
  r.eligibility_codes[g] ?? [];

console.log("\n코드 채움 실태");
const facts: [string, number][] = [
  ["age_min·age_max 둘 다 null", has((r) => r.age_min === null && r.age_max === null)],
  ["age_max >= 120 (상한 없음)", has((r) => r.age_max !== null && r.age_max >= 120)],
  ["is_nationwide", has((r) => r.is_nationwide)],
  ["region_sigungu 있음", has((r) => r.region_sigungu !== null)],
  ["no_limit 그룹 1개 이상", has((r) => (r.eligibility_codes.no_limit ?? []).length > 0)],
  ["gender 코드 있음", has((r) => group(r, "gender").length > 0)],
  ["income 코드 있음", has((r) => group(r, "income").length > 0)],
  ["situation 코드 있음", has((r) => group(r, "situation").length > 0)],
  ["situation에 JA0322(해당사항없음)", has((r) => group(r, "situation").includes("JA0322"))],
  ["household 코드 있음", has((r) => group(r, "household").length > 0)],
  ["household에 JA0410(해당사항없음)", has((r) => group(r, "household").includes("JA0410"))],
  ["business 코드 있음", has((r) => group(r, "business").length > 0)],
  ["unknown만 채워짐 (온통청년)", has((r) => Object.keys(r.eligibility_codes.unknown ?? {}).length > 0)],
];
for (const [label, n] of facts) {
  console.log(`  ${String(n).padStart(6)}  ${pct(n, rows.length).padStart(6)}  ${label}`);
}

// ─── 3. SQL 1차 필터 ↔ 게이트 일치 ★ ─────────────────────────
console.log("\nSQL 1차 필터 ↔ 게이트 (나이·지역만 비교, §5.0.1)");
for (const sigungu of [null, "동대문구"]) {
  const who: Profile = { ...ME, region_sigungu: sigungu };
  let sqlOnly = 0; // SQL 통과 · 게이트 불일치 → 정상 (목록에 보이고 '아님' 배지가 붙는다)
  let gateOnly = 0; // SQL 탈락 · 게이트 통과 → ★ 모순. 목록에 없는데 판정은 통과
  let both = 0;
  for (const row of rows) {
    const sql = passesSqlFilter(row, age, "11", sigungu);
    const gate = gateRegionAgeOnly(row, who);
    if (sql && gate) both++;
    else if (sql) sqlOnly++;
    else if (gate) gateOnly++;
  }
  const label = sigungu ?? "시군구 미선택";
  console.log(`  [${label}] 양쪽 통과 ${both} · SQL만 ${sqlOnly} · 게이트만 ${gateOnly} ${gateOnly === 0 ? "✓" : "← ★ 모순"}`);
}

// ─── 4. 화면에 실제로 뜨는 규모 + 민감도 ─────────────────────
const DEFAULT_INTERESTS = ["job", "housing"];
const firstPass = rows.filter((r) => passesSqlFilter(r, age, "11", null));
const withCategory = firstPass.filter((r) => r.categories.some((c) => DEFAULT_INTERESTS.includes(c)));
const gatePassed = withCategory.filter((r) => checkGate(r, ME, REF_YEAR).pass);

console.log("\n목록 화면 규모 (TODO 2c 기준)");
console.log(`  1차 필터 (나이·지역)                  ${firstPass.length}건`);
console.log(`  + 분야 기본값 {job,housing}           ${withCategory.length}건  ← 2c 판정 대상 (목표 200~400)`);
console.log(`  + 게이트까지 통과 ('해당' 후보)        ${gatePassed.length}건`);

console.log("\n민감도 — 프로필을 얼마나 채우느냐");
const variants: [string, Profile][] = [
  ["생년만", { ...ME, region_sido: null, situations: [], household: [] }],
  ["생년 + 서울", { ...ME, situations: [], household: [] }],
  ["+ 근로자", { ...ME, household: [] }],
  ["+ 1인가구 (대표 프로필)", ME],
  ["+ 동대문구", { ...ME, region_sigungu: "동대문구" }],
];
for (const [label, who] of variants) {
  const n = rows.filter((r) => checkGate(r, who, REF_YEAR).pass).length;
  console.log(`  ${label.padEnd(24)} ${String(n).padStart(6)}건  ${pct(n, rows.length).padStart(6)}`);
}

// ─── 5. 개인상황·가구 규칙의 '한계 효과' ─────────────────────
// 정부24 공식 코드표 (docs/api/정부24_공공서비스정보API.md §개인 상황·가구 상황)
const LABEL: Record<string, string> = {
  JA0301: "예비부모/난임", JA0302: "임산부", JA0303: "출산/입양",
  JA0313: "농업인", JA0314: "어업인", JA0315: "축산업인", JA0316: "임업인",
  JA0317: "초등학생", JA0318: "중학생", JA0319: "고등학생", JA0320: "대학생/대학원생",
  JA0322: "해당사항없음", JA0326: "근로자/직장인", JA0327: "구직자/실업자",
  JA0328: "장애인", JA0329: "국가보훈대상자", JA0330: "질병/질환자",
  JA0401: "다문화가족", JA0402: "북한이탈주민", JA0403: "한부모/조손가정",
  JA0404: "1인가구", JA0410: "해당사항없음", JA0411: "다자녀가구",
  JA0412: "무주택세대", JA0413: "신규전입", JA0414: "확대가족",
};
const label = (code: string) => LABEL[code] ?? code;

/** 이 그룹만 빼고 게이트를 돌렸을 때 통과하는가 = 이 그룹이 '단독으로' 떨어뜨렸는가 */
function blockedOnlyBy(row: Row, who: Profile, group: "situation" | "household"): boolean {
  if (checkGate(row, who, REF_YEAR).pass) return false;
  const codes = { ...row.eligibility_codes };
  delete codes[group];
  return checkGate({ ...row, eligibility_codes: codes }, who, REF_YEAR).pass;
}

for (const [scopeName, scope] of [
  ["전체", rows],
  ["1차 필터 + 분야 기본값", withCategory],
] as [string, Row[]][]) {
  const onlySituation = scope.filter((r) => blockedOnlyBy(r, ME, "situation"));
  const onlyHousehold = scope.filter((r) => blockedOnlyBy(r, ME, "household"));
  const passing = scope.filter((r) => checkGate(r, ME, REF_YEAR).pass).length;

  console.log(`\n[${scopeName}] ${scope.length}건 중`);
  console.log(`  게이트 통과                       ${passing}건`);
  console.log(`  개인상황 때문에만 '아님'           ${onlySituation.length}건  ← 규칙을 풀면 이만큼이 AI로 넘어간다`);
  console.log(`  가구상황 때문에만 '아님'           ${onlyHousehold.length}건`);

  if (scopeName !== "전체") {
    const freq = new Map<string, number>();
    for (const r of onlySituation) {
      for (const c of r.eligibility_codes.situation ?? []) {
        freq.set(c, (freq.get(c) ?? 0) + 1);
      }
    }
    console.log("  단독 탈락분의 정책 대상 코드 (상위 10)");
    for (const [code, n] of [...freq].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
      console.log(`    ${String(n).padStart(4)}  ${label(code)}`);
    }
    console.log("  예시 3건");
    for (const r of onlySituation.slice(0, 3)) {
      const codes = (r.eligibility_codes.situation ?? []).map(label).join("·");
      console.log(`    ${r.title.slice(0, 40)} — 대상: ${codes}`);
    }

    const hhFreq = new Map<string, number>();
    for (const r of onlyHousehold) {
      for (const c of r.eligibility_codes.household ?? []) {
        hhFreq.set(c, (hhFreq.get(c) ?? 0) + 1);
      }
    }
    console.log("  가구상황 단독 탈락분의 정책 대상 코드");
    for (const [code, n] of [...hhFreq].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(n).padStart(4)}  ${label(code)}`);
    }
    console.log("  예시 3건");
    for (const r of onlyHousehold.slice(0, 3)) {
      const codes = (r.eligibility_codes.household ?? []).map(label).join("·");
      console.log(`    ${r.title.slice(0, 40)} — 대상: ${codes}`);
    }
  }
}

function pct(n: number, total: number): string {
  return total === 0 ? "-" : `${((n / total) * 100).toFixed(1)}%`;
}
