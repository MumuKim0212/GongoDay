/**
 * 판정 API + 배지 완료 판정 (TODO 작업 6).
 *
 *   npm run dev
 *   npx tsx scripts/verdict-api-check.mts
 *
 * **라우트를 실제로 호출하고 실제 화면에서 확인한다.** 세션 쿠키·RLS·게이트·Gemini·캐시가 한 줄에
 * 걸려 있어 함수 단위로는 "판정된다"를 말할 수 없다. 브라우저 컨텍스트의 쿠키 항아리를 그대로 쓰는
 * `context.request`로 API를 부르므로, 화면에서 누른 것과 같은 세션이다.
 *
 * 세션 재사용은 `profile-check.mts`와 같은 이유다 — 실행마다 익명 유저를 만들면 `429`로 막힌다.
 *
 * **완료 판정 2·3(AI 실패·라우트 타임아웃)은 여기 없다.** 주입이 필요해서 별도로 재현했고
 * 결과는 TODO 작업 6에 적었다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type BrowserContext, type Page } from "playwright";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const stateDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../node_modules/.cache/gongoday",
);

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env.local"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const pass: string[] = [];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") =>
  (ok ? pass : fail).push(`${label}${detail ? ` — ${detail}` : ""}`);

type Decided = {
  verdict: "eligible" | "unclear" | "ineligible";
  decided_by: "code" | "ai";
  reason: string | null;
  quote: string | null;
  quote_verified: boolean;
  blockers: string[];
};
type ApiBody = {
  verdicts: Record<string, Decided>;
  stats: { requested: number; cached: number; gate_blocked: number; ai_called: number; ai_failed: number; save_error: string | null };
};

const browser = await chromium.launch();
fs.mkdirSync(stateDir, { recursive: true });

const file = path.join(stateDir, "verdict.json");
const context: BrowserContext = await browser.newContext({
  viewport: { width: 1000, height: 1400 },
  storageState: fs.existsSync(file) ? file : undefined,
});
const page: Page = await context.newPage();

async function judge(policyIds: string[]): Promise<ApiBody> {
  const res = await context.request.post(`${base}/api/verdicts`, { data: { policyIds } });
  return (await res.json()) as ApiBody;
}

/**
 * 검사에 쓸 정책의 저장된 판정을 지운다. **이게 없으면 두 번째 실행부터 전건 캐시라**
 * "Gemini가 실제로 판정한다"와 "두 번째는 0건"을 같은 실행에서 구별할 수 없다.
 *
 * 세션 토큰이 쿠키 안에 조각나 있어 RLS 경로로는 지우기 번거롭다. 검사 대상 정책 id로만 범위를
 * 좁혀 service_role로 지운다 — 지워지는 것은 언제든 다시 만들어지는 판정 캐시뿐이다.
 */
async function resetVerdicts(policyIds: string[]): Promise<void> {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(
    `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/verdicts?policy_id=in.(${policyIds.join(",")})`,
    { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`판정 캐시 초기화 실패: ${res.status} ${await res.text()}`);
}

// ── 프로필을 매번 같은 값으로 맞춘다. 서명이 달라지면 캐시 검사의 전제가 무너진다.
await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
await page.getByLabel("생년").fill("1998");
await page.getByLabel("시도").selectOption("11");
await page.getByLabel("시군구").selectOption("동대문구");
await page.getByRole("group", { name: "개인 상황" }).getByRole("checkbox", { name: "근로자/직장인" }).check();
await page.getByRole("group", { name: "가구 상황" }).getByRole("checkbox", { name: "1인가구" }).check();
await page.getByRole("button", { name: /저장/ }).click();
await page.getByText("저장했습니다", { exact: false }).waitFor({ timeout: 20000 });

// ── 1. 나이가 크게 어긋나는 정책은 Gemini 호출 없이 '아님' (완료 판정 4)
const kids = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/policies?select=id,title,age_min,age_max&age_max=lt.15&age_max=gt.0&limit=3`,
  { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } },
).then((r) => r.json() as Promise<{ id: string; title: string; age_max: number }[]>);

// 목록 첫 페이지 10건 — 여기서 미리 모아 캐시를 한 번에 비운다
await page.goto(base, { waitUntil: "networkidle" });
const ids = await page.locator('article a[href^="/policies/"]').evaluateAll((els) =>
  els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!.replace("/policies/", "")),
);
check(ids.length === 10, "목록 첫 페이지가 10건", `${ids.length}건`);

await resetVerdicts([...kids.map((k) => k.id), ...ids]);

const gated = await judge(kids.map((k) => k.id));
check(
  Object.values(gated.verdicts).every((v) => v.verdict === "ineligible" && v.decided_by === "code"),
  `나이가 어긋나는 ${kids.length}건은 코드로 '아님' 확정`,
  Object.values(gated.verdicts).map((v) => `${v.verdict}/${v.decided_by}`).join(" "),
);
check(gated.stats.ai_called === 0, "게이트에서 걸린 건은 Gemini를 부르지 않는다", `ai_called=${gated.stats.ai_called}`);

// 5. '아님' 카드에 "왜 아닌지"가 적혀 있다
check(
  Object.values(gated.verdicts).every((v) => v.blockers.length > 0 && v.blockers.some((b) => b.includes("세"))),
  "'아님'에 나이 범위와 입력 나이가 적힌 blockers가 붙는다",
  Object.values(gated.verdicts)[0]?.blockers.join(" / "),
);

// ── 2. 목록 첫 페이지 10건 판정 → 다시 판정하면 Gemini 호출 0건 (완료 판정 1)
const first = await judge(ids);
check(
  Object.keys(first.verdicts).length === ids.length,
  "요청한 전건에 판정이 돌아온다",
  `${Object.keys(first.verdicts).length}/${ids.length}`,
);
check(first.stats.save_error === null, "판정이 verdicts에 저장된다", first.stats.save_error ?? "");
check(
  first.stats.ai_called > 0,
  "게이트를 통과한 건은 실제로 Gemini가 판정한다",
  `ai_called=${first.stats.ai_called} · ai_failed=${first.stats.ai_failed} · gate=${first.stats.gate_blocked} · cached=${first.stats.cached}`,
);
check(first.stats.ai_failed === 0, "Gemini 호출 실패 0건", `ai_failed=${first.stats.ai_failed}`);

const aiOnes = Object.values(first.verdicts).filter((v) => v.decided_by === "ai");
check(
  aiOnes.every((v) => (v.reason ?? "").length > 0),
  "AI 판정에는 이유 한 문장이 붙는다",
);
check(
  aiOnes.filter((v) => v.quote_verified).length > 0,
  "인용 검증을 통과한 근거 문장이 있다",
  `${aiOnes.filter((v) => v.quote_verified).length}/${aiOnes.length}`,
);

const second = await judge(ids);
check(second.stats.ai_called === 0, "같은 프로필로 두 번째 판정 → Gemini 호출 0건", `ai_called=${second.stats.ai_called}`);
check(second.stats.cached === ids.length, "전건이 캐시에서 나온다", `cached=${second.stats.cached}/${ids.length}`);
check(
  JSON.stringify(second.verdicts) === JSON.stringify(first.verdicts),
  "캐시된 판정이 처음 판정과 같다",
);

// ── 3. 프로필을 고치면 서명이 바뀌어 다시 판정된다 (§5.5)
await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
await page.getByLabel("생년").fill("1975");
await page.getByRole("button", { name: /저장/ }).click();
await page.getByText("저장했습니다", { exact: false }).waitFor({ timeout: 20000 });
const changed = await judge(ids.slice(0, 3));
check(changed.stats.cached === 0, "프로필을 고치면 캐시가 안 잡힌다", `cached=${changed.stats.cached}`);

// 원래 프로필로 되돌린다 — 다음 실행이 같은 서명에서 시작해야 한다
await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
await page.getByLabel("생년").fill("1998");
await page.getByRole("button", { name: /저장/ }).click();
await page.getByText("저장했습니다", { exact: false }).waitFor({ timeout: 20000 });

// ── 4. 화면 — 배지·정렬·'아님' 노출
await page.goto(base, { waitUntil: "networkidle" });
const badgesBefore = await page
  .locator("article")
  .evaluateAll((els) => els.filter((el) => /해당|애매|아님/.test(el.textContent ?? "")).length);
check(
  badgesBefore === ids.length,
  "저장된 판정이 목록 조회만으로 배지에 함께 나온다 (F-16)",
  `${badgesBefore}/${ids.length}건`,
);

await page.getByRole("button", { name: /판정하기/ }).click();
await page.getByText(/해당 \d|애매 \d|아님 \d/).waitFor({ timeout: 60000 });

const cards = await page.locator("article").evaluateAll((els) =>
  els.map((el) => {
    const text = el.textContent ?? "";
    const href = el.querySelector('a[href^="/policies/"]')?.getAttribute("href") ?? "";
    return { id: href.replace("/policies/", ""), badge: /해당|애매|아님/.exec(text)?.[0] ?? "", text };
  }),
);
check(cards.length === 10 && cards.every((c) => c.badge !== ""), "10건 전부에 배지가 붙는다", cards.map((c) => c.badge).join(""));

const order = cards.map((c) => ["해당", "애매", "아님"].indexOf(c.badge));
check(
  order.every((v, i) => i === 0 || order[i - 1] <= v),
  "해당 → 애매 → 아님 순으로 정렬된다",
  cards.map((c) => c.badge).join(" "),
);

// 화면에 그려진 '아님'과 판정 결과의 '아님' 개수가 같아야 한다 — 하나라도 사라지면 §7.5 위반이다.
const onScreen = await judge(ids); // 전건 캐시. 카드에 뭐가 적혀야 하는지의 기준값이다
const rejected = cards.filter((c) => c.badge === "아님");
const rejectedIds = Object.entries(onScreen.verdicts).filter(([, v]) => v.verdict === "ineligible");
check(
  rejected.length === rejectedIds.length,
  "'아님'으로 판정된 정책이 목록에서 사라지지 않는다 (PRD §7.5)",
  `화면 ${rejected.length}건 / 판정 ${rejectedIds.length}건`,
);

// 카드에 그려진 인용문은 개행이 살아 있고 blockers는 공백이 접혀 있다 (§5.4). 같은 공간에서 비교한다.
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const why = (id: string) => {
  const v = onScreen.verdicts[id];
  return [v.reason ?? "", ...v.blockers].filter((s) => s.length > 0);
};
check(
  rejected.every(
    (c) => why(c.id).length > 0 && why(c.id).every((s) => collapse(c.text).includes(collapse(s))),
  ),
  "'아님' 카드에 왜 아닌지가 적혀 있다 (blockers·이유 전부 노출)",
  rejected.map((c) => why(c.id).join(" / ")).join(" ‖ ").slice(0, 200),
);
check(
  (await page.getByText("· 코드").count()) + (await page.getByText("· AI").count()) === 10,
  "배지에 코드/AI 구분이 표시된다 (F-11b)",
);

await context.storageState({ path: file });
await browser.close();

console.log(`\n통과 ${pass.length} / 실패 ${fail.length}\n`);
for (const p of pass) console.log(`  ✅ ${p}`);
for (const f of fail) console.log(`  ❌ ${f}`);
process.exit(fail.length === 0 ? 0 : 1);
