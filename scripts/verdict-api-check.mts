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

/** 키 순서에 흔들리지 않는 직렬화. 스트림 응답을 서로 비교할 때 쓴다. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val !== null && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  );

/** 배지 문구는 5단계 점수에서 나온다 (§5.6) — `scoreLabel()`과 한 벌이다 */
const BADGE = /신청 가능|확인 \d+개|조건 미기재|아님/;

/** 배지 문구를 점수로 되돌린다. 정렬 검사가 이 값을 본다 */
const badgeScore = (badge: string) =>
  badge === "신청 가능" ? 5
  : badge === "확인 1개" ? 4
  : /^확인 \d+개$/.test(badge) ? 3
  : badge === "조건 미기재" ? 2
  : badge === "아님" ? 1
  : 0;

/**
 * 응답은 **NDJSON 스트림이다** — 한 줄에 JSON 하나 (§5). 아래 검사들이 전건을 한 덩어리로 보는
 * 편이 읽기 쉬우므로 여기서 예전 모양(`{ verdicts, stats }`)으로 되접는다.
 */
async function judge(policyIds: string[]): Promise<ApiBody> {
  const res = await context.request.post(`${base}/api/verdicts`, { data: { policyIds } });
  const verdicts: ApiBody["verdicts"] = {};
  let stats: ApiBody["stats"] | null = null;

  for (const line of (await res.text()).split("\n")) {
    if (line === "") continue;
    const msg = JSON.parse(line) as
      | { t: "v"; id: string; v: Decided }
      | { t: "done"; stats: ApiBody["stats"] };
    if (msg.t === "v") verdicts[msg.id] = msg.v;
    else stats = msg.stats;
  }

  // `done`이 없으면 스트림이 중간에 끊긴 것이다 — 조용히 0으로 넘기면 캐시 검사가 통과해버린다.
  if (stats === null) throw new Error(`판정 스트림이 done 없이 끝났다: ${res.status()}`);
  return { verdicts, stats };
}

/**
 * 선택 칩을 켠다. **체크박스를 직접 누를 수 없다** — `.chip input`이 `opacity:0`에 0×0이라
 * (globals.css §5.3) Playwright가 "보이지 않음"·"뷰포트 밖"으로 막는다. 사용자가 실제로
 * 누르는 것도 감싼 `<label>`이므로 그쪽을 누른다.
 *
 * ⚠️ **라벨 클릭은 토글이라 `.check()`처럼 멱등하지 않다.** 이 검사는 세션을 파일에 저장해
 * 재사용하므로, 켜져 있는데 또 누르면 **프로필이 실행마다 달라지고 서명이 흔들려** 캐시 검사의
 * 전제가 무너진다.
 */
const chip = async (group: string, label: string) => {
  const box = page
    .getByRole("group", { name: group })
    .locator("label")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
  if (await box.locator("input").isChecked()) return;
  await box.click();
};

/** 프로필 저장은 목록으로 리다이렉트한다 (`app/profile/actions.ts`) */
async function saveProfile(): Promise<void> {
  await page.getByRole("button", { name: /^저장$/ }).click();
  await page.waitForURL(`${base}/`, { timeout: 20000 });
}

/**
 * 목록이 띄운 자동 판정이 끝나기를 기다린다 (F-11).
 *
 * ⚠️ **`resetVerdicts` 앞에 반드시 있어야 한다.** 목록을 열면 판정이 자동으로 시작되는데,
 * 그 요청이 아직 날아가는 중에 캐시를 지우면 **지운 뒤에 저장이 도착해** 캐시가 되살아난다.
 * 그러면 "첫 판정은 Gemini를 부른다"가 `cached=10`으로 뒤집힌다.
 */
async function waitForJudged(): Promise<void> {
  await page.waitForTimeout(700);
  await page
    .getByRole("status", { name: "판정 중" })
    .first()
    .waitFor({ state: "detached", timeout: 60000 });
  // ⚠️ **스켈레톤만 보면 이르다.** 스켈레톤은 카드마다 판정이 닿는 순간 걷히는데, 정렬은
  // 스트림이 닫힐 때 한 번에 적용된다 (§6.1). `판정 중…`이 사라지는 렌더가 그 렌더다.
  await page.getByText("판정 중…").waitFor({ state: "detached", timeout: 60000 });
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
await page.getByLabel("생년").selectOption("1998");
await page.getByLabel("시도").selectOption("11");
await page.getByLabel("시군구").selectOption("동대문구");
await chip("개인 상황", "근로자/직장인");
await chip("가구 상황", "1인가구");
await saveProfile();

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

await waitForJudged();
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
// **키 순서로 비교하면 안 된다.** 응답이 스트림이라 도착 순서가 매번 다르다 — 캐시분은 첫 줄부터
// 한꺼번에, AI분은 끝나는 대로 온다(§5). 순서는 계약이 아니므로 정렬해서 비교한다.
check(stable(second.verdicts) === stable(first.verdicts), "캐시된 판정이 처음 판정과 같다");

// ── 3. 프로필을 고치면 서명이 바뀌어 다시 판정된다 (§5.5)
await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
await page.getByLabel("생년").selectOption("1975");
await saveProfile();
const changed = await judge(ids.slice(0, 3));
check(changed.stats.cached === 0, "프로필을 고치면 캐시가 안 잡힌다", `cached=${changed.stats.cached}`);

// 원래 프로필로 되돌린다 — 다음 실행이 같은 서명에서 시작해야 한다
await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
await page.getByLabel("생년").selectOption("1998");
await saveProfile();

// ── 4. 화면 — 배지·정렬·'아님' 노출
await page.goto(base, { waitUntil: "networkidle" });
const badgesBefore = await page
  .locator("article")
  .evaluateAll(
    (els, src) => els.filter((el) => new RegExp(src).test(el.textContent ?? "")).length,
    BADGE.source,
  );
check(
  badgesBefore === ids.length,
  "저장된 판정이 목록 조회만으로 배지에 함께 나온다 (F-16)",
  `${badgesBefore}/${ids.length}건`,
);

// **누를 버튼이 없다.** 목록을 열면 자동으로 돈다 (F-11).
// 위 단계에서 전건이 캐시에 들어갔으므로 여기서는 기다릴 것 없이 즉시 통과하는 것이 정상이다.
await waitForJudged();

const cards = await page.locator("article").evaluateAll(
  (els, src) =>
    els.map((el) => {
      const text = el.textContent ?? "";
      const href = el.querySelector('a[href^="/policies/"]')?.getAttribute("href") ?? "";
      return { id: href.replace("/policies/", ""), badge: new RegExp(src).exec(text)?.[0] ?? "", text };
    }),
  BADGE.source,
);
check(
  cards.length === 10 && cards.every((c) => c.badge !== ""),
  "10건 전부에 배지가 붙는다",
  cards.map((c) => c.badge).join(" "),
);

const order = cards.map((c) => badgeScore(c.badge));
check(
  order.every((v, i) => i === 0 || order[i - 1] >= v),
  "점수가 높은 것부터 정렬된다 (5 → 1)",
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

// ⚠️ **여기서만 목록 뷰로 바꾼다.** 기본은 타일이고 타일은 판정 이유까지만 보여준다 —
// 인용문·확인 항목·블로커는 목록 뷰의 몫이다 (ARCHITECTURE §6.1). 뷰를 안 맞추면
// "블로커가 안 보인다"가 아니라 "타일을 보고 있다"를 실패로 잡는다.
await page.goto(`${base}/?view=list`, { waitUntil: "networkidle" });
const listCards = await page.locator("article").evaluateAll((els) =>
  els.map((el) => ({
    id: el.querySelector('a[href^="/policies/"]')?.getAttribute("href")?.replace("/policies/", "") ?? "",
    text: el.textContent ?? "",
  })),
);

// 카드에 그려진 인용문은 개행이 살아 있고 blockers는 공백이 접혀 있다 (§5.4). 같은 공간에서 비교한다.
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const why = (id: string) => {
  const v = onScreen.verdicts[id];
  return [v.reason ?? "", ...v.blockers].filter((s) => s.length > 0);
};
const rejectedInList = listCards.filter((c) => rejected.some((r) => r.id === c.id));
check(
  rejectedInList.length === rejected.length &&
    rejectedInList.every(
      (c) => why(c.id).length > 0 && why(c.id).every((s) => collapse(c.text).includes(collapse(s))),
    ),
  "'아님' 카드에 왜 아닌지가 적혀 있다 (목록 뷰 · blockers·이유 전부 노출)",
  rejectedInList.map((c) => why(c.id).join(" / ")).join(" ‖ ").slice(0, 200),
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
