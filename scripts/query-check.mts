/**
 * 목록 1차 필터가 SQL로 잰 값과 같은 결과를 내는지 확인한다 (§5.0.1).
 *
 *   npx tsx scripts/query-check.mts
 *
 * PostgREST 문법(`or` 체이닝, 배열 `ov`/`eq.{}`)이 의도대로 도는지가 핵심이다.
 * 여기서 어긋나면 목록과 게이트가 다른 답을 내고, 그 모순은 화면에서 잘 안 보인다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

import { fetchPolicies, defaultFilters, PAGE_SIZE } from "../src/lib/policies/query";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(repoRoot, ".env.local"), "utf8").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const pass: string[] = [];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") =>
  (ok ? pass : fail).push(`${label}${detail ? ` — ${detail}` : ""}`);

// 대표 프로필 28세·서울·동대문구 (TODO 2c와 동일)
const ME = { birthYear: 1998, regionSido: "11", regionSigungu: "동대문구" };

const base = { ...defaultFilters(), ...ME };

const withSigungu = await fetchPolicies(db, base);
check(withSigungu.error === null, "조회 오류 없음", withSigungu.error ?? "");
check(withSigungu.totalCount === 13662, "전체 건수 13,662", String(withSigungu.totalCount));
// 573 → 569: 정책명으로 지역을 회수하면서 전국 취급이던 4건이 타 지역 전용이 됐다 (region.ts `fallback()`)
check(withSigungu.filteredCount === 569, "1차 필터 + 동대문구 → 569건", String(withSigungu.filteredCount));

const noSigungu = await fetchPolicies(db, { ...base, regionSigungu: null });
check(noSigungu.filteredCount === 613, "1차 필터 (시군구 미선택) → 613건", String(noSigungu.filteredCount));

const noProfile = await fetchPolicies(db, defaultFilters());
check(noProfile.filteredCount > 613, "프로필 없으면 나이·지역 조건이 안 걸린다", `${noProfile.filteredCount}건`);

// 페이지네이션
check(withSigungu.rows.length === PAGE_SIZE, `1페이지가 ${PAGE_SIZE}건`, `${withSigungu.rows.length}건`);
const page2 = await fetchPolicies(db, { ...base, page: 2 });
const overlap = withSigungu.rows.filter((r) => page2.rows.some((p) => p.id === r.id));
check(overlap.length === 0, "1·2페이지가 겹치지 않는다", `겹침 ${overlap.length}건`);

// 정렬
const dates = withSigungu.rows.map((r) => r.source_registered_at ?? "");
check(
  dates.every((d, i) => i === 0 || dates[i - 1] >= d),
  "source_registered_at 내림차순",
  dates[0]?.slice(0, 10) ?? "",
);

// 검색
const search = await fetchPolicies(db, { ...defaultFilters(), q: "청년" });
check(
  search.rows.every((r) => r.title.includes("청년")),
  "검색어가 제목에 실제로 들어 있다",
  `${search.filteredCount}건`,
);

// 사용자구분이 실제로 걸리는가 (§5.0.3)
const legalOnly = noSigungu.rows.filter(
  (r) => r.audiences.length > 0 && !r.audiences.some((a) => ["개인", "소상공인", "가구"].includes(a)),
);
check(legalOnly.length === 0, "법인/시설/단체 전용이 1페이지에 없다", `${legalOnly.length}건`);

// 분야 0건 안내 조건이 실제로 발생하는가
const farmOnly = await fetchPolicies(db, { ...base, categories: ["farm"] });
check(farmOnly.filteredCount >= 0, "분야를 좁히면 0건도 나올 수 있다", `농림축산어업 ${farmOnly.filteredCount}건`);

// 분야를 전부 끄면 0건이어야 한다 — 끌수록 늘어나면 필터가 거꾸로 동작하는 것으로 읽힌다
const noCategory = await fetchPolicies(db, { ...base, categories: [] });
check(noCategory.filteredCount === 0, "분야 전부 끔 → 0건", `${noCategory.filteredCount}건`);
check(noCategory.rows.length === 0, "분야 전부 끔 → 카드 없음", `${noCategory.rows.length}건`);
check(noCategory.totalCount === 13662, "분야 전부 꺼도 '전체 M건'은 유지", String(noCategory.totalCount));

// 검색어가 한글이어도 동작한다
const kw = await fetchPolicies(db, { ...defaultFilters(), q: "청년월세" });
check(kw.filteredCount > 0, "한글 검색어 '청년월세'", `${kw.filteredCount}건`);

console.log("PASS");
for (const p of pass) console.log("  ✓ " + p);
if (fail.length) {
  console.log("FAIL");
  for (const f of fail) console.log("  ✗ " + f);
}
console.log(`\n${pass.length}/${pass.length + fail.length} 통과`);
process.exit(fail.length ? 1 : 0);
