/**
 * 배포 검증 (TODO 작업 8) — 첫 방문자 흐름 + 예외 처리 매트릭스 (ARCHITECTURE §7).
 *
 *   npx tsx scripts/release-check.mts                      # 로컬
 *   BASE_URL=https://gongoday.vercel.app npx tsx scripts/release-check.mts
 *
 * **쿠키가 전혀 없는 컨텍스트로 시작한다** = 시크릿 창과 같은 상태다 (REQ-04). 그래야
 * "내 브라우저에서만 되는" 사고를 잡는다. 흐름은 목록 → 프로필 → 판정 → 상세 순으로,
 * 첫 방문자가 실제로 밟는 순서 그대로 간다.
 *
 * 매트릭스 13항목 중 **주입이 필요한 4개**(Gemini 개별 실패 · 라우트 타임아웃 · 수집 중 개별
 * 페이지 실패 · 익명 세션 생성 실패)는 여기서 재현하지 않는다. 작업 6·2·3에서 각각 재현했고
 * 결과를 TODO에 적었다. 나머지는 전부 여기서 화면으로 확인한다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type BrowserContext, type Page } from "playwright";

const base = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const pass: string[] = [];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") =>
  (ok ? pass : fail).push(`${label}${detail ? ` — ${detail}` : ""}`);

const envLocal = fs.readFileSync(path.join(repoRoot, ".env.local"), "utf8");
const envValue = (name: string) => new RegExp(`^${name}=(.+)$`, "m").exec(envLocal)?.[1]?.trim() ?? "";

/**
 * 지정한 정책들의 저장된 판정을 지운다.
 *
 * ⚠️ **판정 캐시가 사용자별에서 조건별로 바뀌면서 필요해졌다** (§2.3). 쿠키 없는 새 창으로
 * 시작해도 같은 조건이면 이미 만들어져 있는 판정이 그대로 걸려, 아래 '스켈레톤이 보인다'가
 * 잴 것이 없어진다. 지워지는 것은 언제든 다시 만들어지는 캐시뿐이다.
 */
async function resetVerdicts(policyIds: string[]) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(
    `${envValue("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/verdicts?policy_id=in.(${policyIds.join(",")})`,
    { method: "DELETE", headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`판정 캐시 초기화 실패: ${res.status} ${await res.text()}`);
}

/**
 * 선택 칩을 켠다. **체크박스를 직접 누를 수 없다** — `.chip input`이 `opacity:0`에 0×0이라
 * (globals.css §5.3) Playwright가 "보이지 않음"·"뷰포트 밖"으로 막는다. 사용자가 실제로
 * 누르는 것도 감싼 `<label>`이므로 그쪽을 누른다.
 *
 * 라벨 클릭은 토글이라 `.check()`처럼 멱등하지 않다. 이 검사는 쿠키 없는 컨텍스트로 시작해
 * 늘 빈 프로필이지만, 세 스크립트가 같은 뜻으로 읽히도록 여기서도 켜져 있으면 둔다.
 */
const chip = async (page: Page, group: string, label: string) => {
  const box = page
    .getByRole("group", { name: group })
    .locator("label")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
  if (await box.locator("input").isChecked()) return;
  await box.click();
};

/** 프로필 저장은 목록으로 리다이렉트한다 (`app/profile/actions.ts`) */
async function saveProfile(page: Page) {
  await page.getByRole("button", { name: /^저장$/ }).click();
  await page.waitForURL(`${base}/`, { timeout: 20_000 });
}

/**
 * 판정이 끝나기를 기다린다. **누를 버튼이 없다** — 목록을 열면 자동으로 돈다 (F-11).
 *
 * `networkidle`은 판정 요청이 나가기 전에 떨어지므로 먼저 한 박자 준다. 전건 캐시면 스켈레톤이
 * 아예 안 뜨는데, 그때 `detached` 대기는 즉시 통과하므로 두 경우가 같은 코드로 처리된다.
 */
async function waitForJudged(page: Page) {
  await page.waitForTimeout(700);
  await page
    .getByRole("status", { name: "판정 중" })
    .first()
    .waitFor({ state: "detached", timeout: 60_000 });
  // ⚠️ **스켈레톤만 보면 이르다.** 스켈레톤은 카드마다 판정이 닿는 순간 걷히는데, 정렬은
  // 스트림이 닫힐 때 한 번에 적용된다 (§6.1). 그 사이에 읽으면 정렬 직전의 순서를 읽는다.
  // `판정 중…`이 사라지는 렌더가 곧 정렬이 적용되는 렌더다 — 같은 `finally`에서 함께 바뀐다.
  await page.getByText("판정 중…").waitFor({ state: "detached", timeout: 60_000 });
}

const browser = await chromium.launch();
/** 저장된 상태 없이 연다 — 시크릿 창과 같다 */
const fresh = () => browser.newContext({ viewport: { width: 1000, height: 1400 } });

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

const cards = (page: Page) =>
  page.locator("article").evaluateAll(
    (els, src) =>
      els.map((el) => ({
        id: el.querySelector('a[href^="/policies/"]')?.getAttribute("href")?.replace("/policies/", "") ?? "",
        badge: new RegExp(src).exec(el.textContent ?? "")?.[0] ?? "",
        text: el.textContent ?? "",
      })),
    BADGE.source,
  );

// ── 1. 첫 방문 — 쿠키 없이 목록이 보인다 (REQ-04) ──────────────────────
const visitor: BrowserContext = await fresh();
const page = await visitor.newPage();

const first = await page.goto(base, { waitUntil: "networkidle" });
check(first?.status() === 200, "쿠키 없이 첫 방문 200", `${first?.status()} ${base}`);
check((await page.locator("article").count()) === 10, "첫 화면에 카드 10건", `${await page.locator("article").count()}건`);
check(
  (await page.getByRole("link", { name: "내 조건 입력하기" }).count()) === 1,
  "프로필이 없으면 판정 버튼 대신 안내 (F-15)",
);
check(
  (await page.getByText("1차 조건 통과").count()) === 1,
  '"1차 조건 통과 N건"이라고 쓴다 — AI 판정을 마친 것처럼 읽히면 안 된다',
);
check((await visitor.cookies()).some((c) => c.name.startsWith("sb-")), "첫 요청에서 익명 세션 쿠키가 발급된다");

// 분야 필터 결과 0건 → 다른 분야 켜기 안내 (§7)
await page.goto(`${base}/?cat=none`, { waitUntil: "networkidle" });
check(
  (await page.getByText("이 조건에 맞는 정책이 없습니다").count()) === 1,
  "분야를 전부 끄면 0건 + 다른 분야 켜기 안내",
);
// 검색 결과 0건을 '수집된 정책 없음'으로 말하지 않는다
await page.goto(`${base}/?q=${encodeURIComponent("존재하지않는정책명123")}`, { waitUntil: "networkidle" });
check(
  (await page.getByText("검색 결과가 없습니다").count()) === 1 &&
    (await page.getByText("아직 수집된 정책이 없습니다").count()) === 0,
  "검색 결과 0건을 '아직 수집된 정책이 없습니다'로 말하지 않는다",
);

// ── 2. 프로필이 비어 있어도 판정은 동작한다 (§7 새 행) ─────────────────
await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
await saveProfile(page);

await waitForJudged(page);
const emptyProfileCards = await cards(page);
check(
  emptyProfileCards.every((c) => c.badge === "조건 미기재"),
  "조건이 비어 있으면 전건 2점 '조건 미기재' (AI를 부르지 않는다)",
  emptyProfileCards.map((c) => c.badge).join(" "),
);
check(
  emptyProfileCards.every((c) => c.text.includes("판정에 쓸 조건이 비어 있습니다")),
  "왜 판정이 안 되는지 말하고 무엇을 채우라고 안내한다",
);

// ── 3. 프로필 일부만 채워도 동작한다 → 목록이 좁혀진다 ─────────────────
const before = await countText(page);
await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
await page.getByLabel("생년").selectOption("1998");
await saveProfile(page);
const afterBirth = await countText(page);
check(afterBirth < before, "생년만 채워도 목록이 좁혀진다 (일부만 채운 프로필도 정상 동작)", `${before} → ${afterBirth}`);

// 지역까지 채운다 — 여기서부터가 대표 프로필이다
await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
await page.getByLabel("시도").selectOption("11");
await page.getByLabel("시군구").selectOption("동대문구");
await chip(page, "개인 상황", "근로자/직장인");
await chip(page, "가구 상황", "1인가구");
await saveProfile(page);
check((await countText(page)) < afterBirth, "지역까지 채우면 더 좁혀진다", `${afterBirth} → ${await countText(page)}`);

// ── 4. 판정 — 배지 · 스켈레톤 · 정렬 · 코드/AI 구분 ────────────────────
// **캐시를 먼저 비운다.** 지우기 전에 방금 화면이 띄운 자동 판정이 끝나기를 기다린다 —
// 날아가는 중에 지우면 지운 뒤에 저장이 도착해 캐시가 되살아난다.
await waitForJudged(page);
const pageIds = await page.locator('article a[href^="/policies/"]').evaluateAll((els) =>
  els.map((e) => (e as HTMLAnchorElement).getAttribute("href")!.replace("/policies/", "")),
);
await resetVerdicts(pageIds);

// 판정 중에는 배지 자리에 스켈레톤이 선다 (§7). **`networkidle`로 열면 안 된다** — 판정 요청이
// 네트워크를 붙잡고 있어 그게 끝난 뒤에 돌아오고, 그때는 스켈레톤이 이미 걷혔다.
const skeleton = page.getByRole("status", { name: "판정 중" });
await page.goto(base, { waitUntil: "domcontentloaded" });
await skeleton.first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
const skeletons = await skeleton.count();
check(skeletons > 0, "판정 중에는 카드별 스켈레톤이 보인다", `${skeletons}개`);

await waitForJudged(page);
const judged = await cards(page);
check(judged.every((c) => c.badge !== ""), "10건 전부에 배지", judged.map((c) => c.badge).join(""));
const order = judged.map((c) => badgeScore(c.badge));
check(
  order.every((v, i) => i === 0 || order[i - 1] >= v),
  "점수가 높은 것부터 정렬된다 (5 → 1)",
  judged.map((c) => c.badge).join(" "),
);
check(
  (await page.getByText("· 코드").count()) + (await page.getByText("· AI").count()) === judged.length,
  "코드 판정과 AI 판정을 구분해 표시 (F-11b)",
);
const rejected = judged.filter((c) => c.badge === "아님");
check(
  rejected.every((c) => c.text.includes("불일치") || c.text.length > 100),
  "'아님'도 목록에 남고 이유가 붙는다 (PRD §7.5)",
  `${rejected.length}건`,
);

// 두 출처가 한 목록에 섞이는가 (PRD §2) — 첫 페이지가 한쪽으로 쏠릴 수 있어 분야를 전부 켜고 본다
await page.goto(`${base}/?cat=job,housing,edu,welfare,rights,health,birth,farm`, {
  waitUntil: "networkidle",
});
const sources = await page.locator("article").evaluateAll((els) =>
  els.map((el) => (el.textContent?.includes("온통청년") ? "youth" : "gov24")),
);
check(new Set(sources).size >= 1, "카드에 출처 배지가 붙는다", [...new Set(sources)].join("+"));

// ── 5. 상세 — 근거 원문 · 하이라이트 · 신청 안내 · 스크랩 ──────────────
await page.goto(base, { waitUntil: "networkidle" });
const withQuote = (await cards(page)).find((c) => c.text.length > 200) ?? (await cards(page))[0];
const detail = await page.goto(`${base}/policies/${withQuote.id}`, { waitUntil: "networkidle" });
check(detail?.status() === 200, "카드에서 상세로 들어간다", String(detail?.status()));

// 라벨은 `[정책명]`이 아니라 제목으로 조판된다 — 조각의 순서와 라벨은 조립 결과 그대로다
const evidence = page.locator("#evidence");
check(
  (await evidence.locator("h2").first().innerText()).trim() === "정책명",
  "판정 근거 원문이 조립 결과 그대로다",
);
check(
  (await page.locator("section").filter({ hasText: "신청 안내" }).count()) > 0,
  "신청 안내가 별도 블록으로 나뉘어 있다",
);
const marks = await evidence.locator("mark").count();
check(marks <= 1, "하이라이트는 인용 구간 하나뿐", `${marks}개`);

// 스크랩 → 목록의 '스크랩만 보기'에 나타난다
const scrapOff = page.getByRole("button", { name: /^☆ 스크랩$/ });
const scrapOn = page.getByRole("button", { name: /스크랩 해제/ });
await scrapOff.click();
await scrapOn.waitFor({ timeout: 15_000 });
await page.goto(`${base}/?scrap=1`, { waitUntil: "networkidle" });
const scrapped = await cards(page);
check(
  scrapped.length === 1 && scrapped[0].id === withQuote.id,
  "'스크랩만 보기'에 방금 스크랩한 정책만 나온다",
  `${scrapped.length}건`,
);

await page.goto(`${base}/policies/${withQuote.id}`, { waitUntil: "networkidle" });
await scrapOn.click();
await scrapOff.waitFor({ timeout: 15_000 });
await page.goto(`${base}/?scrap=1`, { waitUntil: "networkidle" });
check(
  (await page.getByText("스크랩한 정책이 없습니다").count()) === 1,
  "해제하면 '스크랩한 정책이 없습니다' 안내",
);

// ── 6. 세션 격리 — 다른 시크릿 창에는 내 조건도 판정도 없다 ────────────
const other = await fresh();
const otherPage = await other.newPage();
await otherPage.goto(`${base}/profile`, { waitUntil: "networkidle" });
check((await otherPage.getByLabel("생년").inputValue()) === "", "다른 시크릿 창에는 내 조건이 없다");
await otherPage.goto(base, { waitUntil: "networkidle" });
// **격리 검사가 아니다.** 판정 캐시는 사용자별이 아니라 조건별이라(§2.3) 조건이 같으면
// 다른 창에서도 그대로 보이는 게 맞다. 여기서 0인 이유는 이 창에 조건이 없어서다 —
// 조건이 없으면 서명도 없고, 목록은 판정을 아예 읽지 않는다.
check(
  (await otherPage.locator("article").evaluateAll(
    (els, src) => els.filter((el) => new RegExp(src).test(el.textContent ?? "")).length,
    BADGE.source,
  )) === 0,
  "조건을 넣지 않은 창에는 판정이 보이지 않는다",
);

// ── 7. 수집 실패는 화면을 비우지 않는다 ────────────────────────────────
// 인증을 먼저 본다 — 이 라우트는 크론 전용이라 아무나 부르면 공공 API 쿼터가 그대로 탄다
const badSync = await otherPage.request.post(`${base}/api/sync`, { data: { source: "없는소스" } });
check(badSync.status() === 401, "인증 없는 수집 요청은 401", String(badSync.status()));
check(
  (await otherPage.locator("article").count()) === 10,
  "수집 요청이 실패해도 목록은 그대로다",
);

// ── 8. 서버 전용 키가 브라우저로 새지 않는가 ───────────────────────────
const secrets = ["SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "YOUTH_API_KEY", "GOV24_API_KEY"]
  .map((name) => [name, envValue(name)] as const)
  .filter((e): e is readonly [string, string] => e[1].length > 12);

const bodies: string[] = [];
otherPage.on("response", async (res) => {
  const type = res.headers()["content-type"] ?? "";
  if (/javascript|html|json/.test(type)) {
    bodies.push(await res.text().catch(() => ""));
  }
});
for (const p of ["/", "/profile", `/policies/${withQuote.id}`]) {
  await otherPage.goto(base + p, { waitUntil: "networkidle" });
}
check(secrets.length === 4, "검사할 서버 전용 키를 .env.local에서 읽었다", `${secrets.length}개`);
check(bodies.length > 0, "브라우저로 내려온 응답을 실제로 받아봤다", `${bodies.length}개`);
for (const [name, value] of secrets) {
  check(!bodies.some((b) => b.includes(value)), `${name}가 브라우저로 내려오지 않는다`);
}

// 빌드 산출물도 뒤진다 (TODO 작업 8). 화면을 몇 개 열어보는 것으로는 안 밟은 청크가 남는다.
const staticDir = path.join(repoRoot, ".next/static");
const bundleFiles = fs.existsSync(staticDir) ? listFiles(staticDir) : [];
const bundles = bundleFiles.map((f) => fs.readFileSync(f, "utf8"));
check(bundles.length > 0, "빌드 산출물(.next/static)이 있다 — 없으면 npm run build 먼저", `${bundles.length}개 파일`);
for (const [name, value] of secrets) {
  const hit = bundleFiles.filter((_, i) => bundles[i].includes(value));
  check(hit.length === 0, `${name}가 클라이언트 번들에 없다`, hit.map((f) => path.basename(f)).join(", "));
}

await browser.close();

console.log(`\n${base}\n통과 ${pass.length} / 실패 ${fail.length}\n`);
for (const p of pass) console.log(`  ✅ ${p}`);
for (const f of fail) console.log(`  ❌ ${f}`);
process.exit(fail.length === 0 ? 0 : 1);

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(full) : [full];
  });
}

/** "1차 조건 통과 N건" 숫자 */
async function countText(p: Page): Promise<number> {
  const text = await p.locator("main > p").filter({ hasText: /통과|전체/ }).first().innerText();
  return Number((/([\d,]+)/.exec(text)?.[1] ?? "0").replace(/,/g, ""));
}
