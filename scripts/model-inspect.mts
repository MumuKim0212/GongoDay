/**
 * 모델 간 판정이 갈린 건의 실제 출력을 원문과 나란히 보여준다.
 *
 *   npx tsx scripts/model-eval.mts      # 먼저 이걸 돌려 .model-eval-raw.json을 만든다
 *   npx tsx scripts/model-inspect.mts
 *
 * **수치만으로는 모델을 못 고른다.** 인용검증·결정론·지연이 전부 동률로 나온 뒤
 * 남은 불일치를 원문과 대조해야 어느 쪽이 맞는지 알 수 있다 (§5.1.2).
 * 프롬프트를 고칠 때도 이걸로 회귀를 확인한다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SYSTEM_PROMPT, buildSourceText, type PolicySourceFields } from "../src/lib/verdict/prompt";
import { validateVerdict } from "../src/lib/verdict/validate";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(repoRoot, ".env.local"), "utf8").split("\n")
    .map((l) => l.trim()).filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const MODELS = ["gemini-3.5-flash-lite", "gemini-3.5-flash", "gemini-3.6-flash"];
const PROFILE_TEXT = `- 나이: 28세 (1998년생)
- 거주지: 서울특별시 동대문구
- 개인 상황: 근로자/직장인
- 가구 상황: 1인가구`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["eligible", "unclear", "ineligible"] },
    reason: { type: "STRING" }, quote: { type: "STRING" },
    blockers: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["verdict", "reason", "quote", "blockers"],
};

const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, "scripts/.model-eval-raw.json"), "utf8"));
const ids: string[] = raw.sample.map((s: { id: string }) => s.id);
const verdicts = Object.fromEntries(
  MODELS.map((m) => [m, raw.byModel[m].map((r: { verdict: string }) => r.verdict)]),
);
const disagreeIdx = ids
  .map((_, i) => i)
  .filter((i) => new Set(MODELS.map((m) => verdicts[m][i])).size > 1)
  .slice(0, 10);

const COLUMNS = "id,source,title,summary,org_name,eligibility_text,criteria_text,support_text,income_text,etc_text,apply_period,biz_period_etc";
const res = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/policies?select=${COLUMNS}&id=in.(${disagreeIdx.map((i) => ids[i]).join(",")})`,
  { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } },
);
const rows = (await res.json()) as (PolicySourceFields & { id: string; source: string })[];

async function call(model: string, sourceText: string) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `[사용자 조건]\n${PROFILE_TEXT}\n\n[정책 원문]\n${sourceText}` }] }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", responseSchema: SCHEMA },
      }),
    },
  );
  const b = await r.json();
  try { return JSON.parse(b.candidates[0].content.parts[0].text); } catch { return null; }
}

for (const row of rows) {
  const sourceText = buildSourceText(row);
  console.log("\n" + "═".repeat(100));
  console.log(`${row.title}  [${row.source}]`);
  console.log("─ 지원대상·자격요건 원문 ".padEnd(100, "─"));
  console.log((row.eligibility_text ?? "(없음)").replace(/\s+/g, " ").slice(0, 300));
  for (const m of MODELS) {
    const out = await call(m, sourceText);
    const v = validateVerdict(out, sourceText);
    console.log(`\n  ${m}  →  ${v.verdict}${v.quote_verified ? "" : "  (인용 검증 실패)"}`);
    console.log(`     이유: ${v.reason}`);
    if (v.blockers?.length) console.log(`     블로커: ${v.blockers.join(" / ")}`);
  }
}
