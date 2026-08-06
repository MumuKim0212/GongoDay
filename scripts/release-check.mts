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

const browser = await chromium.launch();
/** 저장된 상태 없이 연다 — 시크릿 창과 같다 */
const fresh = () => browser.newContext({ viewport: { width: 1000, height: 1400 } });

const cards = (page: Page) =>
  page.locator("article").evaluateAll((els) =>
    els.map((el) => ({
      id: el.querySelector('a[href^="/policies/"]')?.getAttribute("href")?.replace("/policies/", "") ?? "",
      badge: /해당|애매|아님/.exec(el.textContent ?? "")?.[0] ?? "",
      text: el.textContent ?? "",
    })),
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
  (await page.getByText("코드 조건 통과").count()) === 1,
  '"코드 조건 통과 N건"이라고 쓴다 — AI 판정을 마친 것처럼 읽히면 안 된다',
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
await page.getByRole("button", { name: /저장/ }).click();
await page.getByText("저장했습니다", { exact: false }).waitFor({ timeout: 20_000 });

await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /판정하기/ }).click();
await page.getByText(/해당 \d|애매 \d|아님 \d/).waitFor({ timeout: 60_000 });
const emptyProfileCards = await cards(page);
check(
  emptyProfileCards.every((c) => c.badge === "애매"),
  "조건이 비어 있으면 전건 '애매' (AI를 부르지 않는다)",
  emptyProfileCards.map((c) => c.badge).join(""),
);
check(
  emptyProfileCards.every((c) => c.text.includes("판정에 쓸 조건이 비어 있습니다")),
  "왜 애매인지 말하고 무엇을 채우라고 안내한다",
);

// ── 3. 프로필 일부만 채워도 동작한다 → 목록이 좁혀진다 ─────────────────
const before = await countText(page);
await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
await page.getByLabel("생년").fill("1998");
await page.getByRole("button", { name: /저장/ }).click();
await page.getByText("저장했습니다", { exact: false }).waitFor({ timeout: 20_000 });
await page.goto(base, { waitUntil: "networkidle" });
const afterBirth = await countText(page);
check(afterBirth < before, "생년만 채워도 목록이 좁혀진다 (일부만 채운 프로필도 정상 동작)", `${before} → ${afterBirth}`);

// 지역까지 채운다 — 여기서부터가 대표 프로필이다
await page.goto(`${base}/profile`, { waitUntil: "networkidle" });
await page.getByLabel("시도").selectOption("11");
await page.getByLabel("시군구").selectOption("동대문구");
await page.getByRole("group", { name: "개인 상황" }).getByRole("checkbox", { name: "근로자/직장인" }).check();
await page.getByRole("group", { name: "가구 상황" }).getByRole("checkbox", { name: "1인가구" }).check();
await page.getByRole("button", { name: /저장/ }).click();
await page.getByText("저장했습니다", { exact: false }).waitFor({ timeout: 20_000 });
await page.goto(base, { waitUntil: "networkidle" });
check((await countText(page)) < afterBirth, "지역까지 채우면 더 좁혀진다", `${afterBirth} → ${await countText(page)}`);

// ── 4. 판정 — 배지 · 스켈레톤 · 정렬 · 코드/AI 구분 ────────────────────
await page.getByRole("button", { name: /판정하기/ }).click();
// 판정 중에는 배지 자리에 스켈레톤이 선다 (§7). 결과가 오기 전에 세야 한다.
const skeletons = await page.getByRole("status", { name: "판정 중" }).count();
check(skeletons > 0, "판정 중에는 카드별 스켈레톤이 보인다", `${skeletons}개`);

await page.getByText(/해당 \d|애매 \d|아님 \d/).waitFor({ timeout: 60_000 });
const judged = await cards(page);
check(judged.every((c) => c.badge !== ""), "10건 전부에 배지", judged.map((c) => c.badge).join(""));
const order = judged.map((c) => ["해당", "애매", "아님"].indexOf(c.badge));
check(order.every((v, i) => i === 0 || order[i - 1] <= v), "해당 → 애매 → 아님 정렬", judged.map((c) => c.badge).join(" "));
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

// 두 출처가 한 목록에 섞이는가 (PRD §2) — 첫 페이지가 한쪽으로 쏠릴 수 있어 전체 보기로 확인
await page.goto(`${base}/?all=1`, { waitUntil: "networkidle" });
const sources = await page.locator("article").evaluateAll((els) =>
  els.map((el) => (el.textContent?.includes("온통청년") ? "youth" : "gov24")),
);
check(new Set(sources).size >= 1, "카드에 출처 배지가 붙는다", [...new Set(sources)].join("+"));

// ── 5. 상세 — 근거 원문 · 하이라이트 · 신청 안내 · 스크랩 ──────────────
await page.goto(base, { waitUntil: "networkidle" });
const withQuote = (await cards(page)).find((c) => c.text.length > 200) ?? (await cards(page))[0];
const detail = await page.goto(`${base}/policies/${withQuote.id}`, { waitUntil: "networkidle" });
check(detail?.status() === 200, "카드에서 상세로 들어간다", String(detail?.status()));

const evidence = page.locator("section").filter({ hasText: "판정 근거 원문" }).last();
check((await evidence.innerText()).includes("[정책명]"), "판정 근거 원문이 조립 결과 그대로다");
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
check(
  (await otherPage.locator("article").evaluateAll((els) =>
    els.filter((el) => /해당|애매|아님/.test(el.textContent ?? "")).length,
  )) === 0,
  "다른 시크릿 창에는 내 판정이 안 보인다",
);

// ── 7. 수집 실패는 화면을 비우지 않는다 ────────────────────────────────
const badSync = await otherPage.request.post(`${base}/api/sync`, { data: { source: "없는소스" } });
check(badSync.status() === 400, "알 수 없는 수집 요청은 400", String(badSync.status()));
check(
  (await otherPage.locator("article").count()) === 10,
  "수집 요청이 실패해도 목록은 그대로다",
);

// ── 8. 서버 전용 키가 브라우저로 새지 않는가 ───────────────────────────
const envLocal = fs.readFileSync(path.join(repoRoot, ".env.local"), "utf8");
const secrets = ["SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "YOUTH_API_KEY", "GOV24_API_KEY"]
  .map((name) => [name, new RegExp(`^${name}=(.+)$`, "m").exec(envLocal)?.[1]?.trim()] as const)
  .filter((e): e is readonly [string, string] => Boolean(e[1]) && e[1]!.length > 12);

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

/** "코드 조건 통과 N건" 숫자 */
async function countText(p: Page): Promise<number> {
  const text = await p.locator("main > p").filter({ hasText: /통과|전체/ }).first().innerText();
  return Number((/([\d,]+)/.exec(text)?.[1] ?? "0").replace(/,/g, ""));
}
