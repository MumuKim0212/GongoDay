/**
 * Gemini 모델 비교 (TODO "Gemini 모델 확정", ARCHITECTURE §5.1.1)
 *
 *   npx tsx scripts/model-eval.mts
 *
 * **프로덕션 코드 경로를 그대로 쓴다** — SYSTEM_PROMPT · buildSourceText · buildProfileText · validateVerdict.
 * 그래야 여기서 잰 수치가 실제로 배포될 동작의 수치가 된다.
 *
 * > 처음에는 사용자 조건 텍스트만 이 파일에 손으로 적어뒀다. 프로필이 코드로 저장되는데
 * > 코드→라벨 변환이 프로덕션에 없었기 때문이다. 작업 4가 그 상수를 만들면서 `buildProfileText`로
 * > 옮겼고, **옮긴 문자열이 실측에 쓴 것과 같은지 아래에서 대조한다** — 다르면 §5.1.2가 잰 수치가
 * > 지금 배포될 동작의 수치가 아니게 된다.
 *
 * 1순위 지표는 **인용 검증 통과율**이다. 정답 라벨 없이 객관적으로 잴 수 있고,
 * 이 프로젝트가 AI를 신뢰하는 유일한 근거이기 때문이다 (PRD §7.4).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SYSTEM_PROMPT,
  buildProfileText,
  buildSourceText,
  type PolicySourceFields,
} from "../src/lib/verdict/prompt";
import { validateVerdict } from "../src/lib/verdict/validate";
import { checkGate, type PolicyConditions, type Profile } from "../src/lib/verdict/gate";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

/**
 * 대표군. **`-preview` 붙은 것은 뺐다** — 8/9 제출물이라 조용히 사라지면 곤란하다.
 * 두 세대(2.5 / 3.x) × 두 티어(flash / flash-lite)를 걸치게 골랐다.
 */
const MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.5-flash",
  "gemini-3.6-flash",
];

const SAMPLE_SIZE = 30;
const DETERMINISM_SIZE = 10;
const TIMEOUT_MS = 15_000; // §5.1.1
const CONCURRENCY = 5;

/** 대표 프로필 (TODO 2c와 동일) */
const REF_YEAR = 2026;
const ME: Profile = {
  birth_year: 1998,
  gender: null,
  region_sido: "11",
  region_sigungu: "동대문구",
  income_bracket: null,
  situations: ["JA0326"], // 근로자/직장인
  household: ["JA0404"], // 1인가구
  business_status: null,
};

const PROFILE_TEXT = buildProfileText(ME, REF_YEAR);

// 모델 실측(§5.1.2)이 실제로 넘겼던 문자열. buildProfileText가 이것과 달라지면 실측 전제가 깨진다.
const MEASURED_PROFILE_TEXT = `- 나이: ${REF_YEAR - ME.birth_year!}세 (${ME.birth_year}년생)
- 거주지: 서울특별시 동대문구
- 개인 상황: 근로자/직장인
- 가구 상황: 1인가구`;

if (PROFILE_TEXT !== MEASURED_PROFILE_TEXT) {
  console.error("사용자 조건 텍스트가 §5.1.2 실측 때와 다르다. 모델 비교 수치를 다시 재야 한다.\n");
  console.error(`실측:\n${MEASURED_PROFILE_TEXT}\n\n현재:\n${PROFILE_TEXT}`);
  process.exit(1);
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    verdict: { type: "STRING", enum: ["eligible", "unclear", "ineligible"] },
    reason: { type: "STRING" },
    quote: { type: "STRING" },
    blockers: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["verdict", "reason", "quote", "blockers"],
};

type Row = PolicySourceFields & PolicyConditions & { id: string; source: string; categories: string[] };

const COLUMNS = [
  "id", "source", "title", "summary", "org_name", "eligibility_text", "criteria_text",
  "support_text", "income_text", "etc_text", "apply_period", "biz_period_etc",
  "age_min", "age_max", "is_nationwide", "region_sidos", "region_sigungu", "audiences",
  "eligibility_codes", "categories",
].join(",");

async function fetchCandidates(): Promise<Row[]> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const rows: Row[] = [];
  for (let offset = 0; offset < 4000; offset += 1000) {
    const res = await fetch(
      `${url}/rest/v1/policies?select=${COLUMNS}&order=id&limit=1000&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    );
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const page = (await res.json()) as Row[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function callModel(model: string, sourceText: string) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [
            {
              role: "user",
              parts: [{ text: `[사용자 조건]\n${PROFILE_TEXT}\n\n[정책 원문]\n${sourceText}` }],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
    );

    const ms = Date.now() - started;
    if (!res.ok) return { ms, error: `HTTP ${res.status}`, raw: null };

    const body = await res.json();
    const text = body?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") return { ms, error: "본문 없음", raw: null };

    try {
      return { ms, error: null, raw: JSON.parse(text) };
    } catch {
      return { ms, error: "JSON 파싱 실패", raw: null };
    }
  } catch (e) {
    return {
      ms: Date.now() - started,
      error: controller.signal.aborted ? "타임아웃" : String(e).slice(0, 60),
      raw: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const pct = (n: number, d: number) => (d === 0 ? "—" : `${((100 * n) / d).toFixed(1)}%`);
const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
};

// ── 실행 ───────────────────────────────────────────────────────────────
const all = await fetchCandidates();

// AI에 실제로 도달하는 것만 평가한다: 1차 필터 + 기본 분야 + 게이트 통과 (§5.0.1)
const reaching = all.filter(
  (r) =>
    (r.is_nationwide || r.region_sidos.includes("11")) &&
    (r.age_min === null || r.age_min <= 29) &&
    (r.age_max === null || r.age_max >= 27) &&
    r.categories.some((c) => c === "job" || c === "housing") &&
    checkGate(r, ME, REF_YEAR).pass,
);

// 두 소스가 섞이도록 번갈아 뽑는다 — 온통청년은 eligibility_text가 33.7%뿐이라 난이도가 다르다
const youth = reaching.filter((r) => r.source === "youth");
const gov24 = reaching.filter((r) => r.source === "gov24");
const sample: Row[] = [];
for (let i = 0; sample.length < SAMPLE_SIZE && (i < youth.length || i < gov24.length); i++) {
  if (i < youth.length && sample.length < SAMPLE_SIZE) sample.push(youth[i]);
  if (i < gov24.length && sample.length < SAMPLE_SIZE) sample.push(gov24[i]);
}

const texts = sample.map((p) => buildSourceText(p));
console.log(
  `게이트 통과 ${reaching.length}건 중 ${sample.length}건 표본 ` +
    `(youth ${sample.filter((s) => s.source === "youth").length} / gov24 ${sample.filter((s) => s.source === "gov24").length})`,
);
console.log(`모델 ${MODELS.length}개 × ${sample.length}건 + 결정론 재실행 ${DETERMINISM_SIZE}건\n`);

type Result = { verdict: string | null; quoteOk: boolean; ms: number; error: string | null };
const byModel = new Map<string, Result[]>();
const verdictsByModel = new Map<string, (string | null)[]>();

for (const model of MODELS) {
  const results = await mapLimit(texts, CONCURRENCY, async (sourceText) => {
    const { ms, error, raw } = await callModel(model, sourceText);
    if (error !== null) return { verdict: null, quoteOk: false, ms, error };
    const v = validateVerdict(raw, sourceText);
    return { verdict: v.verdict, quoteOk: v.quote_verified, ms, error: null };
  });

  // 결정론 — 같은 입력을 한 번 더
  const again = await mapLimit(texts.slice(0, DETERMINISM_SIZE), CONCURRENCY, async (sourceText) => {
    const { error, raw } = await callModel(model, sourceText);
    if (error !== null) return null;
    return validateVerdict(raw, sourceText).verdict;
  });
  const stable = again.filter((v, i) => v !== null && v === results[i].verdict).length;

  byModel.set(model, results);
  verdictsByModel.set(model, results.map((r) => r.verdict));

  const ok = results.filter((r) => r.error === null);
  const lat = ok.map((r) => r.ms);
  console.log(`── ${model}`);
  console.log(`   인용 검증 통과   ${pct(results.filter((r) => r.quoteOk).length, results.length)}  (${results.filter((r) => r.quoteOk).length}/${results.length})`);
  console.log(`   호출 실패        ${results.filter((r) => r.error !== null).length}건 ${[...new Set(results.map((r) => r.error).filter(Boolean))].join(", ")}`);
  console.log(`   판정 분포        해당 ${results.filter((r) => r.verdict === "eligible").length} · 애매 ${results.filter((r) => r.verdict === "unclear").length} · 아님 ${results.filter((r) => r.verdict === "ineligible").length}`);
  console.log(`   지연 p50/p95/max ${quantile(lat, 0.5)} / ${quantile(lat, 0.95)} / ${Math.max(0, ...lat)} ms`);
  console.log(`   결정론(2회 동일) ${pct(stable, DETERMINISM_SIZE)}\n`);
}

// 모델 간 판정 불일치 — 전원 일치하지 않는 건이 몇 개인가
let disagree = 0;
for (let i = 0; i < sample.length; i++) {
  const vs = new Set(MODELS.map((m) => verdictsByModel.get(m)![i]));
  if (vs.size > 1) disagree++;
}
console.log(`모델 간 판정이 갈린 정책: ${disagree}/${sample.length} (${pct(disagree, sample.length)})`);

fs.writeFileSync(
  path.join(repoRoot, "scripts/.model-eval-raw.json"),
  JSON.stringify(
    { at: new Date().toISOString(), sample: sample.map((s) => ({ id: s.id, source: s.source, title: s.title })), byModel: Object.fromEntries(byModel) },
    null,
    2,
  ),
);
