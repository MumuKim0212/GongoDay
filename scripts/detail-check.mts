/**
 * 상세 화면 완료 판정 (TODO 작업 7).
 *
 *   npm run dev
 *   npx tsx scripts/detail-check.mts
 *
 * **완료 판정은 "검증을 통과한 판정은 예외 없이 하이라이트가 맞는다"이다.** 표본 하나로는 말할 수
 * 없으므로 **저장된 검증 통과분 전량**에 대해 `buildSourceText` → `locateQuote`를 다시 돌려
 * 구간이 실제로 인용문을 가리키는지 확인한다. 그 뒤 화면에서 `<mark>`가 같은 문장인지 본다.
 *
 * 화면 확인은 **개행이 낀 인용문을 골라서** 한다 — 원문 그대로 `indexOf`가 실패하는 건이
 * 정규화 공간과 원본 공간이 갈라지는 바로 그 경우다 (§5.4).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, type Page } from "playwright";

import { locateQuote, normalize } from "../src/lib/verdict/normalize";
import { buildSourceText, sourceSections, type PolicySourceFields } from "../src/lib/verdict/prompt";

const base = process.env.BASE_URL ?? "http://localhost:3000";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const pass: string[] = [];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") =>
  (ok ? pass : fail).push(`${label}${detail ? ` — ${detail}` : ""}`);

const SOURCE_COLUMNS =
  "id,title,summary,org_name,eligibility_text,criteria_text,support_text,income_text,etc_text," +
  "apply_period,biz_period_etc,apply_method_text";

type Row = PolicySourceFields & { id: string; apply_method_text: string | null };

const anon = { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` };
const admin = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };

const get = async <T,>(pathAndQuery: string, headers: Record<string, string>): Promise<T> => {
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};

const collapse = (s: string) => normalize(s).text;

// ── 1. 저장된 검증 통과분 전량에서 하이라이트가 성립하는가 ─────────────
// verdicts는 RLS로 본인 행만 보이므로 집계는 service_role로 읽는다 (admin 화면과 같은 이유).
const verified = await get<{ policy_id: string; quote: string }[]>(
  "verdicts?select=policy_id,quote&quote_verified=is.true",
  admin,
);

const policyIds = [...new Set(verified.map((v) => v.policy_id))];
const policies = new Map<string, Row>();
for (let i = 0; i < policyIds.length; i += 100) {
  const chunk = policyIds.slice(i, i + 100);
  const rows = await get<Row[]>(`policies?select=${SOURCE_COLUMNS}&id=in.(${chunk.join(",")})`, anon);
  for (const r of rows) policies.set(r.id, r);
}

type Case = { policyId: string; quote: string; sourceText: string; start: number; end: number };
const located: Case[] = [];
const broken: string[] = [];

for (const v of verified) {
  const policy = policies.get(v.policy_id);
  if (!policy) {
    broken.push(`${v.policy_id.slice(0, 8)} 정책 행이 없다`);
    continue;
  }
  const sourceText = buildSourceText(policy);
  const range = locateQuote(sourceText, v.quote);
  if (range === null) {
    broken.push(`${v.policy_id.slice(0, 8)} 구간 없음`);
    continue;
  }
  // 구간이 진짜 그 문장인가 — null이 아니라는 것만으로는 엉뚱한 자리를 가리켜도 통과한다
  if (collapse(sourceText.slice(range.start, range.end)) !== collapse(v.quote)) {
    broken.push(`${v.policy_id.slice(0, 8)} 구간이 인용문과 다르다`);
    continue;
  }
  located.push({ policyId: v.policy_id, quote: v.quote, sourceText, ...range });
}

check(
  verified.length > 0,
  "검증을 통과한 판정이 저장돼 있다 (없으면 이 검사는 의미가 없다)",
  `${verified.length}건`,
);
check(
  broken.length === 0,
  "검증 통과분 전량에서 하이라이트 구간이 인용문과 정확히 일치한다",
  broken.length === 0 ? `${located.length}건 전부` : broken.join(" / "),
);

// 개행이 낀 인용문 — 원문 그대로는 indexOf가 실패하고 정규화 공간에서만 찾아지는 건.
// **구간은 인용문과 문자열로는 다르고(개행) 정규화하면 같아야 한다** — 이게 인덱스 맵이 하는 일이다.
const withNewline = located.filter((c) => c.sourceText.indexOf(c.quote) < 0);
check(
  withNewline.every(
    (c) =>
      c.sourceText.slice(c.start, c.end) !== c.quote &&
      collapse(c.sourceText.slice(c.start, c.end)) === collapse(c.quote),
  ),
  "원문 그대로는 못 찾는 인용문도 원본 구간이 정확하다 (§5.4 인덱스 맵)",
  `${withNewline.length}/${located.length}건`,
);

// ── 2. 화면 ────────────────────────────────────────────────────────────
const browser = await chromium.launch();
const stateFile = path.join(repoRoot, "node_modules/.cache/gongoday/verdict.json");
const context = await browser.newContext({
  viewport: { width: 1000, height: 1400 },
  storageState: fs.existsSync(stateFile) ? stateFile : undefined,
});
const page: Page = await context.newPage();

// 이 세션이 실제로 보는 판정에서 고른다 — 남의 서명으로 저장된 판정은 화면에 뜨지 않는다.
await page.goto(base, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /판정하기/ }).click();
await page.getByText(/해당 \d|애매 \d|아님 \d/).waitFor({ timeout: 60_000 });

const quoted = await page.locator("article").evaluateAll((els) =>
  els
    .map((el) => ({
      id: el.querySelector('a[href^="/policies/"]')?.getAttribute("href")?.replace("/policies/", "") ?? "",
      quote: el.querySelector("blockquote")?.textContent ?? "",
    }))
    .filter((c) => c.id !== "" && c.quote !== ""),
);
check(quoted.length > 0, "목록 카드가 검증 통과 인용문을 보여준다", `${quoted.length}건`);

// 개행이 낀 것을 우선으로 고른다 (§5.4가 막으려는 바로 그 경우)
const mine = quoted
  .map((c) => ({ ...c, hit: located.find((l) => l.policyId === c.id) }))
  .filter((c) => c.hit !== undefined);
const target = mine.find((c) => c.hit!.sourceText.indexOf(c.hit!.quote) < 0) ?? mine[0];
check(target !== undefined, "화면에서 확인할 판정을 고를 수 있다");

if (target !== undefined) {
  const spansNewline = target.hit!.sourceText.indexOf(target.hit!.quote) < 0;
  await page.goto(`${base}/policies/${target.id}`, { waitUntil: "networkidle" });

  // 블록에 제목이 없으므로 글자가 아니라 id로 잡는다 — 원문 문구는 정책마다 다르다
  const evidence = page.locator("#evidence");
  const guide = page.locator("#guide");
  const marks = evidence.locator("mark");

  check((await marks.count()) === 1, "판정 근거 블록에 하이라이트가 하나 있다", `${await marks.count()}개`);
  check(
    collapse(await marks.first().innerText()) === collapse(target.quote),
    `하이라이트가 인용문과 정확히 같다${spansNewline ? " (개행이 낀 문장)" : ""}`,
    (await marks.first().innerText()).slice(0, 60).replace(/\n/g, "⏎"),
  );
  check((await guide.locator("mark").count()) === 0, "신청 안내 블록은 하이라이트 대상이 아니다");

  // 판정에 안 쓴 텍스트가 근거 블록에 섞이면 "이 문장을 보고 판정했나"를 알 수 없다 (§5.3)
  const applyText = policies.get(target.id)?.apply_method_text;
  const evidenceText = collapse(await evidence.innerText());
  check(
    applyText === null || applyText === undefined || !evidenceText.includes(collapse(applyText)),
    "신청방법 텍스트는 판정 근거 원문에 들어가지 않는다",
    applyText ? collapse(applyText).slice(0, 40) : "(신청방법 없음)",
  );
  // 라벨은 `[정책명]`이 아니라 제목으로 조판되지만 **본문은 조립한 문자열 그대로**여야 한다
  const policyRow = policies.get(target.id);
  const sections = policyRow ? sourceSections(policyRow) : [];
  check(
    sections.length > 0 && sections.every((s) => evidenceText.includes(collapse(s.body))),
    "근거 블록이 buildSourceText가 조립한 본문을 조각째 그대로 담는다",
    `${sections.length}개 필드`,
  );

  // ── 개행이 낀 인용문을 화면에서 확인한다 (완료 판정이 명시한 경우).
  //
  // 모델이 마침 그런 문장을 인용해줄 때까지 기다릴 수는 없다. **저장된 판정의 quote만 잠시 바꿔
  // 넣는다** — 원문 안에서 개행을 건너뛰는 실제 구간을 골라, 모델이 인용하듯 공백을 접은 형태로.
  // 이러면 `indexOf`로는 못 찾고 정규화 공간에서만 찾아지는, §5.4가 막으려는 바로 그 상태가 된다.
  const newlineCase = mine.find((c) => innerNewline(c.hit!.sourceText) >= 0);
  if (newlineCase === undefined) {
    check(false, "개행이 낀 인용문을 만들 원문이 있다");
  } else {
    const st = newlineCase.hit!.sourceText;
    const at = innerNewline(st);
    const fixture = collapse(st.slice(Math.max(0, at - 20), Math.min(st.length, at + 20)));

    const rows = await get<{ id: string; quote: string }[]>(
      `verdicts?select=id,quote&policy_id=eq.${newlineCase.id}&quote_verified=is.true`,
      admin,
    );
    const row = rows.find((r) => r.quote === newlineCase.quote) ?? rows[0];
    const patch = async (quote: string) => {
      const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/verdicts?id=eq.${row.id}`, {
        method: "PATCH",
        headers: { ...admin, "Content-Type": "application/json" },
        body: JSON.stringify({ quote }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    };

    check(st.indexOf(fixture) < 0, "만든 인용문은 원문 그대로는 찾을 수 없다 (개행이 끼어 있다)");
    await patch(fixture);
    await page.goto(`${base}/policies/${newlineCase.id}`, { waitUntil: "networkidle" });

    const mark = page.locator("#evidence mark");
    const marked = (await mark.count()) === 1 ? await mark.first().textContent() : null;
    check(
      marked !== null && collapse(marked) === fixture,
      "개행이 낀 인용문도 화면에서 정확히 하이라이트된다",
      (marked ?? "(없음)").replace(/\n/g, "⏎").slice(0, 60),
    );
    check(
      marked !== null && /\n/.test(marked),
      "하이라이트 구간이 개행을 품는다 — 정규화 공간이 아니라 원본 구간을 칠했다",
    );
    await patch(row.quote); // 원래 판정으로 되돌린다
  }

  // ── 스크랩. **버튼 글자가 바뀌기를 기다린다** — Server Action은 응답을 스트리밍으로 다시
  // 그리므로 `networkidle`로는 이르다. 처음 이 검사가 실패한 것도 저장이 아니라 이 경합이었다.
  const scrapOn = page.getByRole("button", { name: /스크랩 해제/ });
  const scrapOff = page.getByRole("button", { name: /^☆ 스크랩$/ });
  const settle = 15_000;

  if ((await scrapOn.count()) > 0) {
    await scrapOn.click(); // 지난 실행이 남긴 상태가 있으면 먼저 끈다
    await scrapOff.waitFor({ timeout: settle });
  }

  await scrapOff.click();
  await scrapOn.waitFor({ timeout: settle }).then(
    () => check(true, "스크랩 버튼이 상태를 바꾼다", "☆ 스크랩 → ★ 스크랩 해제"),
    () => check(false, "스크랩 버튼이 상태를 바꾼다"),
  );

  await page.reload({ waitUntil: "networkidle" });
  check((await scrapOn.count()) === 1, "새로고침해도 스크랩 상태가 남는다");

  // 원래대로 되돌린다 — 검사가 데이터를 남기지 않는다
  await scrapOn.click();
  await scrapOff.waitFor({ timeout: settle }).then(
    () => check(true, "스크랩을 해제할 수 있다"),
    () => check(false, "스크랩을 해제할 수 있다"),
  );
  await page.reload({ waitUntil: "networkidle" });
  check((await scrapOff.count()) === 1, "해제도 저장된다 (새로고침 후에도 꺼져 있다)");
}

// ── 3. 없는 정책 · 세션 없는 방문 ──────────────────────────────────────
const missing = await page.goto(`${base}/policies/00000000-0000-4000-8000-000000000000`);
check(missing?.status() === 404, "없는 정책은 404", String(missing?.status()));

const malformed = await page.goto(`${base}/policies/not-a-uuid`);
check(malformed?.status() === 404, "uuid가 아닌 주소도 404 (조회 오류로 새지 않는다)", String(malformed?.status()));

const fresh = await browser.newContext({ viewport: { width: 1000, height: 1000 } });
const freshPage = await fresh.newPage();
const anonRes = await freshPage.goto(`${base}/policies/${policyIds[0]}`, { waitUntil: "networkidle" });
check(anonRes?.status() === 200, "판정 이력이 없는 방문자도 상세를 볼 수 있다", String(anonRes?.status()));
check(
  (await freshPage.getByText("아직 판정하지 않은 정책입니다").count()) === 1,
  "판정이 없으면 그렇다고 말하고 원문은 그대로 보여준다",
);
check(
  (await freshPage.locator("#evidence").innerText()).length > 50,
  "판정이 없어도 원문 블록은 채워져 있다",
);

await browser.close();

/** 필드 본문 안쪽 개행 하나. 필드 사이 빈 줄과 `[라벨]` 다음 줄은 문장 중간이 아니라 뺀다. */
function innerNewline(text: string): number {
  for (let i = 1; i < text.length - 1; i++) {
    if (text[i] === "\n" && text[i - 1] !== "\n" && text[i + 1] !== "\n" && text[i + 1] !== "[") {
      return i;
    }
  }
  return -1;
}

console.log(`\n통과 ${pass.length} / 실패 ${fail.length}\n`);
for (const p of pass) console.log(`  ✅ ${p}`);
for (const f of fail) console.log(`  ❌ ${f}`);
process.exit(fail.length === 0 ? 0 : 1);
