/**
 * 시군구 목록을 수집 데이터에서 도출해 src/lib/sources/regions.generated.ts 로 굽는다.
 *
 *   node scripts/derive-regions.mjs
 *
 * **외부 코드표나 기억으로 쓰면 안 된다** (PRD §8 R13). 행정구역이 재편된 데이터라
 * 인천에 영종구·제물포구·검단구·서해구가 있고, 표준 법정동코드와 맞지 않는다.
 * 수집이 끝난 뒤 다시 돌리면 목록이 갱신된다.
 *
 * 도출 기준을 `소관기관유형 in (시군구, 광역시도, 교육청)`으로 못박은 이유:
 * 이 셋은 기관명이 시도명으로 시작해 **접두사 매칭만으로 100% 판별된다.**
 * 부분문자열 매칭으로 채워진 행까지 포함하면 자기 출력을 다시 입력으로 먹는 순환이 된다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const ref = env.NEXT_PUBLIC_SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\./)[1];

const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    query: `
      select region_sidos[1] sido, region_sigungu name
      from policies
      where source = 'gov24'
        and region_sigungu is not null
        and org_type in ('시군구', '광역시도', '교육청')
      group by 1, 2 order by 1, 2`,
  }),
});
if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
const rows = await res.json();

if (rows.length === 0) {
  throw new Error("도출된 시군구가 0개다. 정부24 수집이 끝났는지 확인할 것.");
}

// 같은 이름이 여러 시도에 있으면(중구·동구·남구·북구·서구·강서구·고성군) 시도를 특정할 수 없다.
// 기관명 부분문자열 매칭에 쓰면 부산 중구를 서울로 오인하므로 제외한다.
const sidosByName = new Map();
for (const r of rows) {
  if (!sidosByName.has(r.name)) sidosByName.set(r.name, new Set());
  sidosByName.get(r.name).add(r.sido);
}

const unique = [...sidosByName.entries()]
  .filter(([, s]) => s.size === 1)
  .map(([name, s]) => [name, [...s][0]])
  .sort((a, b) => b[0].length - a[0].length || a[0].localeCompare(b[0])); // 긴 이름 먼저: "남양주시"가 "양주시"보다 앞

const ambiguous = [...sidosByName.entries()].filter(([, s]) => s.size > 1).map(([n]) => n).sort();

const bySido = {};
for (const r of rows) (bySido[r.sido] ??= []).push(r.name);
for (const k of Object.keys(bySido)) bySido[k] = [...new Set(bySido[k])].sort();

const out = `// 이 파일은 생성된 것이다. 직접 고치지 말 것.
// 생성: node scripts/derive-regions.mjs  (정부24 전량 수집 후)
// 근거: 소관기관유형이 시군구/광역시도/교육청인 행 — 접두사 매칭으로 100% 판별되는 집합
// 생성 시각: ${new Date().toISOString()}

/** 시도 코드 → 시군구 이름 목록. 프로필 폼 선택지의 원천. */
export const SIGUNGU_BY_SIDO: Record<string, string[]> = ${JSON.stringify(bySido, null, 2)};

/**
 * 시군구 이름 → 시도 코드. **긴 이름이 앞에 온다** — 부분문자열 매칭에서
 * "남양주시"가 "양주시"보다 먼저 걸려야 한다.
 *
 * 여러 시도에 겹치는 이름은 제외했다: ${ambiguous.join(", ")}
 * 이름만으로 시도를 특정할 수 없어서, 쓰면 부산 중구를 서울로 오인한다.
 */
export const SIGUNGU_TO_SIDO: Array<[name: string, sido: string]> = ${JSON.stringify(unique, null, 2)};
`;

const target = path.join(repoRoot, "src/lib/sources/regions.generated.ts");
fs.writeFileSync(target, out);

console.log(`시군구 이름 ${sidosByName.size}개 — 고유 ${unique.length} / 모호 ${ambiguous.length}`);
console.log(`모호(제외): ${ambiguous.join(" ")}`);
for (const k of ["11", "28", "41"]) {
  console.log(`  ${k}: ${bySido[k]?.length ?? 0}개`);
}
console.log(`→ ${path.relative(repoRoot, target)}`);
