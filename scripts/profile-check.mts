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
 *
 * > ⚠️ **세션을 파일에 저장해 재사용한다.** 매번 새 컨텍스트를 열면 실행마다 익명 유저가 2명씩
 * > 생기고, 반복 검증하다 보면 **Supabase 익명 로그인이 `429 over_request_rate_limit`으로 막힌다.**
 * > 실제로 한 번 막혀서 검증을 못 끝냈다. 저장 위치는 `node_modules/.cache`라 git이 볼 일이 없고,
 * > 세션이 만료돼 못 쓰게 되면 `proxy.ts`가 새로 만들므로 그냥 다시 돌아간다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type BrowserContext, type Page } from "playwright";

import { HOUSEHOLDS, SIGUNGU_OPTIONS, SITUATIONS } from "../src/lib/profile/schema";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const stateDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../node_modules/.cache/gongoday",
);

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
fs.mkdirSync(stateDir, { recursive: true });

/** 이름표마다 쿠키 항아리가 따로다 = 서로 다른 익명 세션이고, 실행 간에는 같은 세션이다. */
async function session(name: string): Promise<[Page, () => Promise<void>]> {
  const file = path.join(stateDir, `${name}.json`);
  const context: BrowserContext = await browser.newContext({
    viewport: { width: 1000, height: 1400 },
    storageState: fs.existsSync(file) ? file : undefined,
  });
  const page = await context.newPage();
  return [page, async () => void (await context.storageState({ path: file }))];
}

/**
 * 저장하면 **목록으로 리다이렉트한다** (`app/profile/actions.ts`). 예전에는 폼에 남아
 * `저장했습니다`를 띄웠다.
 *
 * 목록에 닿으면 판정이 자동으로 시작되지만(F-11) 이 검사는 폼만 본다 — 곧 폼으로 돌아가면
 * 클라이언트는 요청을 끊고, 서버는 받은 판정을 그대로 저장한다.
 */
async function save(page: Page) {
  await page.getByRole("button", { name: /^저장$/ }).click();
  await page.waitForURL(`${base}/`, { timeout: 20000 });
}

/** 저장 뒤 폼을 다시 연다. `reload()`는 목록을 새로고침할 뿐이라 값을 볼 수 없다. */
const reopen = (page: Page) => page.goto(`${base}/profile`, { waitUntil: "networkidle" });

const group = (page: Page, name: string) => page.getByRole("group", { name });

/**
 * 선택 칩을 켠다. **입력을 직접 누를 수 없다** — `.chip input`이 `opacity:0`에 0×0이라
 * (globals.css §5.3) Playwright가 "보이지 않음"·"뷰포트 밖"으로 막는다. 라디오도 같은 칩이다.
 * 사용자가 실제로 누르는 것도 감싼 `<label>`이므로 그쪽을 누른다.
 *
 * ⚠️ **라벨 클릭은 토글이라 `.check()`처럼 멱등하지 않다.** 세션과 프로필이 실행 간에 남으므로
 * (파일에 저장한 쿠키 항아리) 두 번째 실행부터는 이미 켜진 체크박스를 그대로 꺼버린다.
 * 켜져 있으면 두는 것까지가 `.check()`의 뜻이다.
 */
const chip = async (page: Page, groupName: string, label: string) => {
  const box = group(page, groupName)
    .locator("label")
    .filter({ hasText: new RegExp(`^${label}$`) })
    .first();
  if (await box.locator("input").isChecked()) return;
  await box.click();
};

/**
 * 히어로 아래 "1차 조건 통과 N건"의 N.
 *
 * ⚠️ **`통과` 뒤의 수를 집는다.** 첫 숫자를 집으면 `1차`의 `1`을 세어 늘 1이 된다. `건`까지
 * 붙여 잡을 수도 없다 — `.tag`가 `inline-flex`라 안의 `<strong>`이 플렉스 항목이 되고
 * `innerText`에 개행이 낀다(`1차 조건 통과\n2,440\n건 / 전체 …`). `release-check`도 같은 함수다.
 */
async function passedCount(page: Page): Promise<number> {
  const text = await page
    .locator("main > p")
    .filter({ hasText: "1차 조건 통과" })
    .first()
    .innerText();
  return Number((/통과\s*([\d,]+)/.exec(text)?.[1] ?? "0").replace(/,/g, ""));
}

// ── 세션 A — 전 항목을 채운다
const [a, keepA] = await session("a");
await a.goto(`${base}/profile`, { waitUntil: "networkidle" });

await a.getByLabel("생년").selectOption("1998");
await a.getByLabel("시도").selectOption("11");
await a.getByLabel("시군구").selectOption("동대문구");
await chip(a, "성별", "남성");
await a.getByLabel("소득 구간").selectOption("JA0203");
await chip(a, "개인 상황", "근로자/직장인");
await chip(a, "가구 상황", "1인가구");
await chip(a, "사업자 상황", "예비창업자");
await save(a);

// 1. 저장 후 다시 열어도 값이 남는다
await reopen(a);
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

/**
 * 저장한 조건이 실제로 목록을 좁히는가 — **조건이 없는 세션과 같은 시점에 재서 비교한다.**
 *
 * ⚠️ 전에는 `569`라는 절대 건수를 박아 두었다. 수집이 매시간 도는 데이터라 **맞춰 둔 수가
 * 며칠이면 어긋난다** — 573 → 569로 한 번 고쳤고 그다음엔 571이 됐다. 화면이 SQL과 같은
 * 수인지는 `query-check.mts`가 맡고, 여기서는 "좁혀졌는가"만 본다.
 *
 * 두 세션의 **분야 기본값이 같다**는 것이 이 비교의 전제다 — 프로필의 `interests`가 DB 기본값
 * (`job,housing`)이고 조건 없는 쪽은 `DEFAULT_CATEGORIES`라 같은 두 분야다. 그래서 줄어든
 * 몫은 나이·지역뿐이다.
 */
const [anon, keepAnon] = await session("anon"); // 이 세션은 프로필을 만들지 않는다
await anon.goto(base, { waitUntil: "networkidle" });
const before = await passedCount(anon);
await keepAnon();

await a.goto(base, { waitUntil: "networkidle" });
const after = await passedCount(a);
check(
  before > 0 && after < before,
  "저장한 조건이 목록을 좁힌다 (28세·서울·동대문구)",
  `조건 없음 ${before}건 → 조건 있음 ${after}건`,
);
check(await a.getByRole("link", { name: "내 조건 수정" }).isVisible(), "프로필이 있으면 수정 링크");
await keepA();

// ── 세션 B — 다른 쿠키 항아리
const [b, keepB] = await session("b");
await b.goto(`${base}/profile`, { waitUntil: "networkidle" });

// 2. 다른 세션에서는 안 보인다.
//    **A만 쓰는 값으로 본다** — B가 제 생년을 쓰기 때문에 생년으로는 격리를 잴 수 없다.
check((await b.getByLabel("시도").inputValue()) === "", "다른 세션에는 A의 시도가 안 보인다");
check((await b.getByLabel("시군구").inputValue()) === "", "다른 세션에는 A의 시군구가 안 보인다");
check(
  !(await group(b, "개인 상황").getByRole("checkbox", { name: "근로자/직장인" }).isChecked()),
  "다른 세션에는 A의 개인상황이 안 보인다",
);
check(await b.getByRole("link", { name: "내 조건 입력하기" }).isHidden(), "프로필 폼은 세션 B에도 열린다");

// 채운 값을 되돌릴 수 있어야 한다 — 조건을 잘못 넣었을 때 지울 방법이 없으면 안 된다
await b.getByLabel("생년").selectOption("");
await save(b);
await reopen(b);
check((await b.getByLabel("생년").inputValue()) === "", "채운 값을 다시 비울 수 있다");

// 3. 생년만 채워도 저장된다
await b.getByLabel("생년").selectOption("1990");
await save(b);
await reopen(b);
check((await b.getByLabel("생년").inputValue()) === "1990", "생년만 채워도 저장된다");
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
await reopen(b);
check(
  (await b.getByLabel("시군구").inputValue()) === "",
  "시도 없이 온 시군구는 버린다",
  await b.getByLabel("시군구").inputValue(),
);
await keepB();

await browser.close();

console.log(`\n통과 ${pass.length} / 실패 ${fail.length}\n`);
for (const p of pass) console.log(`  ✅ ${p}`);
for (const f of fail) console.log(`  ❌ ${f}`);
process.exit(fail.length === 0 ? 0 : 1);
