/**
 * 프로필 화면 완료 판정 (TODO 작업 4).
 *
 *   npm run dev
 *   npx tsx scripts/profile-check.mts
 *
 * **실제 폼을 실제 브라우저로 채워서 저장한다.** Server Action·RLS·세션 쿠키가 한 줄에 걸려 있어서
 * 함수 단위로는 "저장된다"를 말할 수 없다. 세션 격리는 쿠키 항아리가 다른 컨텍스트 두 개로 확인한다.
 *
 * 앞의 세 항목만 순수 함수 검사다. `JA0322`·`JA0410`이 빠졌는지는 화면에서 관찰할 수 없다 —
 * 저장돼도 폼이 그리지 못하는 코드라 UI에 흔적이 남지 않고, 드러나는 곳은 작업 6의 게이트다.
 * **상수가 곧 Server Action의 허용 목록이므로**(`actions.ts`의 `codes(SITUATIONS)`) 상수를 직접 본다.
 */
import { chromium, type Page } from "playwright";

import { HOUSEHOLDS, SIGUNGU_OPTIONS, SITUATIONS } from "../src/lib/profile/schema";

const base = process.env.BASE_URL ?? "http://localhost:3000";

const pass: string[] = [];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") =>
  (ok ? pass : fail).push(`${label}${detail ? ` — ${detail}` : ""}`);

// ── 선택지 상수 — 폼이 그리는 목록이자 Server Action의 허용 목록이다
check(
  !SITUATIONS.some((o) => o.code === "JA0322"),
  "개인상황 선택지에 JA0322(해당사항없음)가 없다",
);
check(
  !HOUSEHOLDS.some((o) => o.code === "JA0410"),
  "가구상황 선택지에 JA0410(해당사항없음)이 없다",
);
check(
  SIGUNGU_OPTIONS["11"].length === 25 &&
    SIGUNGU_OPTIONS["28"].length === 11 &&
    SIGUNGU_OPTIONS["41"].length === 31,
  "시군구 선택지가 작업 2d 도출값과 같다 (서울 25 · 인천 11 · 경기 31)",
  [11, 28, 41].map((s) => SIGUNGU_OPTIONS[String(s)].length).join("/"),
);

const browser = await chromium.launch();

/** 컨텍스트마다 쿠키 항아리가 따로다 = 다른 익명 세션이다 */
async function session(): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1000, height: 1400 } });
  return context.newPage();
}

async function save(page: Page) {
  await page.getByRole("button", { name: /저장/ }).click();
  await page.getByText("저장했습니다", { exact: false }).waitFor({ timeout: 20000 });
}

const group = (page: Page, name: string) => page.getByRole("group", { name });

// ── 세션 A — 전 항목을 채운다
const a = await session();
await a.goto(`${base}/profile`, { waitUntil: "networkidle" });

await a.getByLabel("생년").fill("1998");
await a.getByLabel("시도").selectOption("11");
await a.getByLabel("시군구").selectOption("동대문구");
await group(a, "성별").getByRole("radio", { name: "남성" }).check();
await a.getByLabel("소득 구간").selectOption("JA0203");
await group(a, "개인 상황").getByRole("checkbox", { name: "근로자/직장인" }).check();
await group(a, "가구 상황").getByRole("checkbox", { name: "1인가구" }).check();
await group(a, "사업자 상황").getByRole("radio", { name: "예비창업자" }).check();
await save(a);

// 1. 저장 후 새로고침해도 값이 남는다
await a.reload({ waitUntil: "networkidle" });
check((await a.getByLabel("생년").inputValue()) === "1998", "새로고침 후 생년 유지");
check((await a.getByLabel("시도").inputValue()) === "11", "새로고침 후 시도 유지");
check((await a.getByLabel("시군구").inputValue()) === "동대문구", "새로고침 후 시군구 유지");
check(await group(a, "성별").getByRole("radio", { name: "남성" }).isChecked(), "새로고침 후 성별 유지");
check((await a.getByLabel("소득 구간").inputValue()) === "JA0203", "새로고침 후 소득 유지");
check(
  await group(a, "개인 상황").getByRole("checkbox", { name: "근로자/직장인" }).isChecked(),
  "새로고침 후 개인상황 유지",
);
check(
  await group(a, "가구 상황").getByRole("checkbox", { name: "1인가구" }).isChecked(),
  "새로고침 후 가구상황 유지",
);
check(
  await group(a, "사업자 상황").getByRole("radio", { name: "예비창업자" }).isChecked(),
  "새로고침 후 사업자상황 유지",
);

// 저장한 조건이 실제로 목록을 좁히는가 — scripts/query-check.mts가 SQL로 잰 값과 같아야 한다
await a.goto(base, { waitUntil: "networkidle" });
const listed = await a.locator("main > p").filter({ hasText: "코드 조건 통과" }).first().innerText();
check(listed.includes("573"), "목록이 저장된 조건으로 좁혀진다 (28세·서울·동대문구 → 573건)", listed.trim());
check(await a.getByRole("link", { name: "내 조건 수정" }).isVisible(), "프로필이 있으면 수정 링크");

// ── 세션 B — 다른 쿠키 항아리
const b = await session();
await b.goto(`${base}/profile`, { waitUntil: "networkidle" });

// 2. 다른 세션에서는 안 보인다
check((await b.getByLabel("생년").inputValue()) === "", "다른 세션에는 생년이 안 보인다");
check((await b.getByLabel("시도").inputValue()) === "", "다른 세션에는 시도가 안 보인다");
check(
  !(await group(b, "개인 상황").getByRole("checkbox", { name: "근로자/직장인" }).isChecked()),
  "다른 세션에는 개인상황이 안 보인다",
);
check(await b.getByRole("link", { name: "내 조건 입력하기" }).isHidden(), "프로필 폼은 세션 B에도 열린다");

// 3. 생년만 채워도 저장된다
await b.getByLabel("생년").fill("1998");
await save(b);
await b.reload({ waitUntil: "networkidle" });
check((await b.getByLabel("생년").inputValue()) === "1998", "생년만 채워도 저장된다");
check((await b.getByLabel("시도").inputValue()) === "", "안 채운 항목은 빈 채로 남는다");

// 시도 없이 시군구만 온 요청은 시군구를 버린다 (게이트가 다른 시도 정책까지 막지 않도록).
// 폼은 disabled로 막지만 **폼을 우회한 요청도 같은 자리로 온다** — 그 경로를 재현한다.
await b.evaluate(() => {
  const select = document.querySelector('select[name="region_sigungu"]') as HTMLSelectElement;
  select.disabled = false;
  select.insertAdjacentHTML("beforeend", '<option value="중구">중구</option>');
  select.value = "중구";
});
await save(b);
await b.reload({ waitUntil: "networkidle" });
check(
  (await b.getByLabel("시군구").inputValue()) === "",
  "시도 없이 온 시군구는 버린다",
  await b.getByLabel("시군구").inputValue(),
);

await browser.close();

console.log(`\n통과 ${pass.length} / 실패 ${fail.length}\n`);
for (const p of pass) console.log(`  ✅ ${p}`);
for (const f of fail) console.log(`  ❌ ${f}`);
process.exit(fail.length === 0 ? 0 : 1);
