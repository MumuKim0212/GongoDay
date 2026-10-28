// 정부24 증분 수집의 조건 파라미터가 실제로 먹히는지 본다 (진단용 — 읽기 전용, DB에 쓰지 않는다)
//
//   npx tsx scripts/gov24-incremental-probe.mts
//
// `.env.local`의 GOV24_API_KEY만 쓴다. 보는 것 셋:
//  1. 원문 날짜 모양 — serviceList 1페이지의 등록일시·수정일시가 어떤 꼴로 오는가
//  2. 날짜 조건 — 형식 × 인코딩 조합마다 matchCount. 어제부터면 전량보다 적고, 2099년부터면 0이고,
//     돌아온 표본의 값이 전부 기준 이상이어야 "조건이 맞게 먹혔다"고 본다
//  3. 서비스ID 조건 — supportConditions가 요청한 서비스 한 건만 돌려주는가 (건별 조회를 쓰지 않게 된 지금은 참고용)
//
// ⚠️ 건수는 `matchCount`로 본다. `totalCount`는 조건과 무관하게 항상 전량이다 — 처음 이 스크립트가
//    그걸 봐서 "전부 무시됨"으로 잘못 읽었다. 그리고 날짜는 문자열 비교라 꼴이 틀리면 0건이 아니라
//    엉뚱한 건이 걸려 온다(`2026-10-27` → 2026년 전부). 그래서 표본 값까지 대조한다.
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

const KEY = env.GOV24_API_KEY;
if (!KEY) throw new Error(".env.local에 GOV24_API_KEY가 없습니다.");

const BASE = "https://api.odcloud.kr/api/gov24/v3";
type Raw = Record<string, unknown>;

/** 인코딩 두 가지 — 전부 인코딩(현재 코드의 URLSearchParams) / 괄호·콜론은 그대로 */
const ENCODINGS = {
  encoded: (k: string, v: string) => `${encodeURIComponent(`cond[${k}]`)}=${encodeURIComponent(v)}`,
  raw: (k: string, v: string) => `cond[${encodeURI(k)}]=${encodeURIComponent(v)}`,
};

async function call(endpoint: string, perPage: number, cond?: { k: string; v: string; enc: keyof typeof ENCODINGS }) {
  let url = `${BASE}/${endpoint}?page=1&perPage=${perPage}&returnType=JSON`;
  if (cond) url += `&${ENCODINGS[cond.enc](cond.k, cond.v)}`;
  const res = await fetch(url, { headers: { Authorization: KEY }, cache: "no-store" });
  const body = await res.text();
  if (!res.ok) return { status: res.status, matchCount: null as number | null, data: [] as Raw[], body: body.slice(0, 120) };
  const json = JSON.parse(body) as { matchCount?: number; totalCount?: number; data?: Raw[] };
  return { status: res.status, matchCount: json.matchCount ?? json.totalCount ?? null, data: json.data ?? [], body: "" };
}

/** 어제(KST)와 먼 미래를 여러 꼴로 */
function formats(d: { y: string; m: string; day: string }) {
  return {
    YYYYMMDD: `${d.y}${d.m}${d.day}`,
    "YYYY-MM-DD": `${d.y}-${d.m}-${d.day}`,
    "YYYY-MM-DD HH:mm:ss": `${d.y}-${d.m}-${d.day} 00:00:00`,
    YYYYMMDDHHmmss: `${d.y}${d.m}${d.day}000000`,
    "YYYY-MM-DDTHH:mm:ss": `${d.y}-${d.m}-${d.day}T00:00:00`,
  };
}
const k = new Date(Date.now() + 9 * 3600_000);
k.setUTCDate(k.getUTCDate() - 1);
const yesterday = formats({
  y: String(k.getUTCFullYear()),
  m: String(k.getUTCMonth() + 1).padStart(2, "0"),
  day: String(k.getUTCDate()).padStart(2, "0"),
});
const future = formats({ y: "2099", m: "01", day: "01" });

// 1. 원문 날짜 모양
const head = await call("serviceList", 3);
console.log(`\n[1] 원문 날짜 모양 (조건 없음, ${head.matchCount}건)`);
for (const s of head.data) {
  console.log(`  ${s["서비스ID"]}  등록일시=${JSON.stringify(s["등록일시"])}  수정일시=${JSON.stringify(s["수정일시"])}`);
}
const total = head.matchCount ?? 0;

// 2. 날짜 조건
console.log(`\n[2] 날짜 조건 — 어제(${yesterday.YYYYMMDD})부터 / 2099년부터의 matchCount (전량 ${total})`);
const works: string[] = [];
for (const field of ["등록일시", "수정일시"]) {
  for (const enc of Object.keys(ENCODINGS) as (keyof typeof ENCODINGS)[]) {
    for (const fmt of Object.keys(yesterday) as (keyof typeof yesterday)[]) {
      const a = await call("serviceList", 20, { k: `${field}::GTE`, v: yesterday[fmt], enc });
      const b = await call("serviceList", 1, { k: `${field}::GTE`, v: future[fmt], enc });
      const show = (r: typeof a) => (r.matchCount === null ? `HTTP ${r.status}` : String(r.matchCount));
      // 원문은 14자리 숫자 문자열이다. 표본이 기준(어제 0시)보다 이르면 조건이 엉뚱하게 먹힌 것이다
      const floor = `${yesterday.YYYYMMDD}000000`;
      const wrong = a.data.filter((d) => String(d[field] ?? "").replace(/\D/g, "") < floor).length;
      const ok = a.matchCount !== null && b.matchCount === 0 && a.matchCount < total && wrong === 0;
      if (ok) works.push(`${field} · ${enc} · ${fmt}`);
      console.log(
        `  ${ok ? "✓" : "✗"} ${field} ${enc.padEnd(7)} ${fmt.padEnd(20)} 어제~ ${show(a).padStart(6)}  2099~ ${show(b).padStart(6)}${wrong ? `  표본 ${wrong}/${a.data.length}건이 기준보다 이름` : ""}${a.body ? "  " + a.body : ""}`,
      );
    }
  }
}

// 3. 서비스ID 조건 — 1페이지 첫 건이 아닌 건으로 물어야 "무시돼서 첫 건이 온 것"과 구별된다
console.log("\n[3] supportConditions 서비스ID 조건");
const target = String(head.data[2]?.["서비스ID"] ?? head.data[0]?.["서비스ID"] ?? "");
for (const enc of Object.keys(ENCODINGS) as (keyof typeof ENCODINGS)[]) {
  const r = await call("supportConditions", 1, { k: "서비스ID::EQ", v: target, enc });
  const got = r.data[0]?.["서비스ID"];
  const ok = r.matchCount === 1 && got === target;
  console.log(`  ${ok ? "✓" : "✗"} ${enc.padEnd(7)} 요청 ${target} → 응답 ${String(got)} (matchCount ${r.matchCount ?? `HTTP ${r.status}`})`);
}

console.log(`\n먹힌 날짜 조합: ${works.length ? works.join(" / ") : "없음"}\n`);
