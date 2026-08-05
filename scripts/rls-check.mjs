// 작업 1 완료 판정: anon key로 policies INSERT 거부 / 다른 세션의 profiles 0행
//
//   node scripts/rls-check.mjs
//
// 스키마(supabase/schema.sql)를 고칠 때마다 다시 돌린다. RLS는 조용히 새는 종류라
// "돌아가는 것처럼 보이는 상태"와 "안전한 상태"가 화면상 구별되지 않는다.
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

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const pass = [];
const fail = [];
const check = (ok, label, detail) => (ok ? pass : fail).push(`${label}${detail ? ` — ${detail}` : ""}`);

async function anonSession(name) {
  const r = await fetch(`${URL_}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error(`${name} 세션 생성 실패: ${JSON.stringify(j).slice(0, 200)}`);
  return { token: j.access_token, uid: j.user.id };
}

function rest(path, { token, method = "GET", body } = {}) {
  return fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: ANON,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const A = await anonSession("A");
const B = await anonSession("B");
check(A.uid !== B.uid, "세션 A·B가 서로 다른 uid");

// 1. policies INSERT — 세션 있어도 거부되어야 한다 (write 정책이 없음)
const insPolicy = { source: "test", external_id: `t-${Date.now()}`, title: "침투 테스트", raw: {} };
const r1 = await rest("policies", { token: A.token, method: "POST", body: insPolicy });
check(!r1.ok, "anon key + 세션으로 policies INSERT 거부", `HTTP ${r1.status}`);

// 2. 세션 없이도 거부
const r2 = await rest("policies", { method: "POST", body: insPolicy });
check(!r2.ok, "anon key만으로 policies INSERT 거부", `HTTP ${r2.status}`);

// 3. policies SELECT는 익명도 허용 (목록이 시크릿 창에서도 보여야 한다)
const r3 = await rest("policies?select=id&limit=1");
check(r3.ok, "세션 없이 policies SELECT 허용", `HTTP ${r3.status}`);

// 4. sync_runs INSERT 거부
const r4 = await rest("sync_runs", { token: A.token, method: "POST", body: { source: "test" } });
check(!r4.ok, "anon key로 sync_runs INSERT 거부", `HTTP ${r4.status}`);

// 5. 본인 프로필 저장
const r5 = await rest("profiles", {
  token: A.token,
  method: "POST",
  body: { id: A.uid, birth_year: 1998, region_sido: "11" },
});
check(r5.ok, "세션 A가 본인 profiles 저장", `HTTP ${r5.status}`);

// 6. 본인은 보인다
const r6 = await rest("profiles?select=*", { token: A.token });
const rows6 = r6.ok ? await r6.json() : [];
check(rows6.length === 1, "세션 A가 본인 profiles 조회", `${rows6.length}행`);

// 7. ★ 다른 세션에서는 0행
const r7 = await rest("profiles?select=*", { token: B.token });
const rows7 = r7.ok ? await r7.json() : [];
check(rows7.length === 0, "세션 B가 A의 profiles 조회 → 0행", `${rows7.length}행`);

// 8. 남의 id로 쓰려는 시도 거부 (with check)
const r8 = await rest("profiles", {
  token: B.token,
  method: "POST",
  body: { id: A.uid, birth_year: 1970 },
});
check(!r8.ok, "세션 B가 A의 id로 profiles 쓰기 거부", `HTTP ${r8.status}`);

// 9. interests 기본값
const defRow = rows6[0];
check(
  JSON.stringify(defRow?.interests) === JSON.stringify(["job", "housing"]),
  "profiles.interests 기본값 {job,housing}",
  JSON.stringify(defRow?.interests),
);
check(
  Array.isArray(defRow?.situations) && defRow.situations.length === 0,
  "배열 컬럼이 null이 아니라 빈 배열",
  JSON.stringify(defRow?.situations),
);

// 정리 — 남긴 프로필 행 삭제
await rest(`profiles?id=eq.${A.uid}`, { token: A.token, method: "DELETE" });

console.log("PASS");
for (const p of pass) console.log("  ✓ " + p);
if (fail.length) {
  console.log("FAIL");
  for (const f of fail) console.log("  ✗ " + f);
}
console.log(`\n${pass.length}/${pass.length + fail.length} 통과`);
process.exit(fail.length ? 1 : 0);
