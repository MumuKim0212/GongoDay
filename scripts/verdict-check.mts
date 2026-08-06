// 작업 5 완료 판정: 게이트 ±1년 / 모르면 통과 / no_limit / 인용 검증 / 하이라이트 구간 / 서명 안정성
//
//   npx tsx scripts/verdict-check.mts
//
// lib/verdict/*는 순수 함수라 DB도 화면도 네트워크도 필요 없다.
// 판정 규칙을 고칠 때마다 다시 돌린다 — 게이트는 조용히 틀리는 종류라 화면상 구별되지 않는다.
import { checkGate, type PolicyConditions, type Profile } from "../src/lib/verdict/gate";
import { locateQuote } from "../src/lib/verdict/normalize";
import {
  buildProfileText,
  buildSourceText,
  buildUserText,
  type PolicySourceFields,
} from "../src/lib/verdict/prompt";
import { profileSignature } from "../src/lib/verdict/signature";
import { validateVerdict } from "../src/lib/verdict/validate";

const pass: string[] = [];
const fail: string[] = [];
const check = (ok: boolean, label: string, detail = "") =>
  (ok ? pass : fail).push(detail ? `${label} — ${detail}` : label);

/** 나이를 고정해야 판정이 해마다 달라지지 않는다 */
const REF_YEAR = 2026;

/** profiles 실제 행 — interests는 판정 입력이 아니지만 행에는 있다 */
type ProfileRow = Profile & { interests: string[] };

const EMPTY_PROFILE: Profile = {
  birth_year: null,
  gender: null,
  region_sido: null,
  region_sigungu: null,
  income_bracket: null,
  situations: [],
  household: [],
  business_status: null,
};

const BARE_POLICY: PolicyConditions = {
  age_min: null,
  age_max: null,
  is_nationwide: false,
  region_sidos: [],
  region_sigungu: null,
  audiences: [],
  eligibility_codes: {},
};

const prof = (over: Partial<ProfileRow>): ProfileRow => ({
  ...EMPTY_PROFILE,
  interests: ["job", "housing"],
  ...over,
});
const policy = (over: Partial<PolicyConditions>): PolicyConditions => ({ ...BARE_POLICY, ...over });
const passes = (p: PolicyConditions, who: Profile) => checkGate(p, who, REF_YEAR).pass;
const blockersOf = (p: PolicyConditions, who: Profile) => {
  const result = checkGate(p, who, REF_YEAR);
  return result.pass ? [] : result.blockers;
};

// ─── 1. 나이 ±1년 ─────────────────────────────────────────────
const YOUTH = policy({ age_min: 19, age_max: 39 });

check(!passes(YOUTH, prof({ birth_year: 1981 })), "19~39세 정책 + 45세 → 불일치");
check(passes(YOUTH, prof({ birth_year: 1986 })), "19~39세 정책 + 40세 → 통과 (상한 +1년)");
check(passes(YOUTH, prof({ birth_year: 2008 })), "19~39세 정책 + 18세 → 통과 (하한 -1년)");
check(!passes(YOUTH, prof({ birth_year: 2009 })), "19~39세 정책 + 17세 → 불일치");

const ageBlockers = blockersOf(YOUTH, prof({ birth_year: 1981 }));
check(
  ageBlockers.some((b) => b.includes("19~39세") && b.includes("45세")),
  "블로커에 정책 범위와 입력 나이가 함께 들어간다",
  ageBlockers.join(" / "),
);

check(
  passes(policy({ age_min: 19, age_max: 120 }), prof({ birth_year: 1961 })),
  "age_max=120은 상한 없음 → 65세도 통과",
);
check(passes(YOUTH, EMPTY_PROFILE), "나이 정책 + 생년 미입력 → 통과 (모르면 통과)");

// ─── 2. 조건 없는 정책 ────────────────────────────────────────
check(passes(BARE_POLICY, EMPTY_PROFILE), "조건 없는 정책 + 빈 프로필 → 통과");

// ─── 3. 코드 그룹: no_limit / 해당사항없음 / 미입력 ───────────
check(
  passes(policy({ eligibility_codes: { gender: [], no_limit: ["gender"] } }), prof({ gender: "JA0102" })),
  "성별 남녀 모두 Y(빈 배열 + no_limit) + 여성 → 통과",
);
check(
  passes(
    policy({ eligibility_codes: { gender: ["JA0101"], no_limit: ["gender"] } }),
    prof({ gender: "JA0102" }),
  ),
  "no_limit 그룹은 코드가 남아 있어도 무조건 통과",
);

const MALE_ONLY = policy({ eligibility_codes: { gender: ["JA0101"] } });
check(!passes(MALE_ONLY, prof({ gender: "JA0102" })), "성별 남성 대상 + 여성 → 불일치");
check(passes(MALE_ONLY, EMPTY_PROFILE), "성별 남성 대상 + 성별 미입력 → 통과 (모르면 통과)");

check(
  passes(policy({ eligibility_codes: { situation: ["JA0322"] } }), prof({ situations: ["JA0320"] })),
  "개인상황 JA0322(해당사항없음) → 제한 없음",
);
check(
  !passes(policy({ eligibility_codes: { situation: ["JA0321"] } }), prof({ situations: ["JA0320"] })),
  "개인상황 교집합 없음 → 불일치",
);

// 블로커에 정책 대상이 한글로 적혀야 사용자가 자기 조건을 고쳐 되찾아올 수 있다 (§5.0.2의 회수 장치).
const disabledOnly = blockersOf(
  policy({ eligibility_codes: { situation: ["JA0328", "JA0329"] } }),
  prof({ situations: ["JA0326"] }),
);
check(
  disabledOnly.some((b) => b.includes("장애인") && b.includes("국가보훈대상자")),
  "개인상황 블로커에 정책 대상이 한글 라벨로 들어간다",
  disabledOnly.join(" / "),
);
const manyTargets = blockersOf(
  policy({
    eligibility_codes: { situation: ["JA0328", "JA0329", "JA0330", "JA0301", "JA0302"] },
  }),
  prof({ situations: ["JA0326"] }),
);
check(manyTargets[0].includes("외 2개"), "대상이 많으면 3개까지만 적는다", manyTargets.join(" / "));
check(
  blockersOf(
    policy({ eligibility_codes: { situation: ["JA9999"] } }),
    prof({ situations: ["JA0326"] }),
  )[0] === "개인 상황 조건 불일치",
  "라벨을 모르는 코드는 괄호째 생략한다",
);
// 가구상황은 hard block에서 빼기로 했다 — 실측 근거는 gate.ts의 CheckedGroup 주석
const HOMELESS_ONLY = policy({ eligibility_codes: { household: ["JA0412"] } });
check(
  passes(HOMELESS_ONLY, prof({ household: ["JA0404"] })),
  "무주택세대 대상 정책 + 1인가구 프로필 → 통과 (배타적인 축이 아니다)",
);
check(
  blockersOf(HOMELESS_ONLY, prof({ household: ["JA0404"] })).length === 0,
  "가구상황은 블로커를 만들지 않는다 — AI 판정으로 넘긴다",
);
check(
  !passes(policy({ eligibility_codes: { situation: ["JA0327"] } }), prof({ situations: ["JA0326"] })),
  "개인상황은 그대로 hard block — 구직자 대상 + 근로자 → 불일치",
);
check(
  passes(policy({ eligibility_codes: { unknown: { earnCndSeCd: "0043001" } } }), prof({ birth_year: 1998 })),
  "온통청년 unknown 코드는 판정에 쓰지 않는다",
);

// ─── 4. 지역 ──────────────────────────────────────────────────
const SEOUL_ONLY = policy({ region_sidos: ["11"] });
check(!passes(SEOUL_ONLY, prof({ region_sido: "41" })), "서울 정책 + 경기 거주 → 불일치");
check(passes(SEOUL_ONLY, prof({ region_sido: "11" })), "서울 정책 + 서울 거주 → 통과");
check(passes(SEOUL_ONLY, EMPTY_PROFILE), "서울 정책 + 지역 미입력 → 통과");
check(
  passes(policy({ is_nationwide: true, region_sidos: ["11"] }), prof({ region_sido: "41" })),
  "전국 정책은 시도 검사를 건너뛴다",
);

const DONGDAEMUN = policy({ region_sidos: ["11"], region_sigungu: "동대문구" });
check(
  passes(DONGDAEMUN, prof({ region_sido: "11" })),
  "구 단위 정책 + 시군구 미선택 → 통과 (숨기지 않는다)",
);
check(
  !passes(DONGDAEMUN, prof({ region_sido: "11", region_sigungu: "강남구" })),
  "구 단위 정책 + 다른 구 → 불일치",
);

// ─── 5. buildSourceText ───────────────────────────────────────
const YOUTH_LIKE: PolicySourceFields = {
  title: "청년 월세 특별지원",
  summary: "청년의 주거비 부담을 덜기 위해 월세를 지원합니다.",
  org_name: "국토교통부",
  eligibility_text: null, // 온통청년은 33.7%만 채워진다 (R10)
  criteria_text: null,
  support_text: "월 20만원, 최대 12개월",
  income_text: null,
  etc_text: null,
  apply_period: null,
  biz_period_etc: null,
};
const sourceOfYouth = buildSourceText(YOUTH_LIKE);
check(
  sourceOfYouth.includes("[요약]") && sourceOfYouth.includes("[지원내용]"),
  "eligibility_text가 비어도 요약·지원내용이 들어간다 (R10)",
);
check(!sourceOfYouth.includes("[지원대상·자격요건]"), "null 필드는 라벨째 생략된다");
check(
  sourceOfYouth.indexOf("[요약]") < sourceOfYouth.indexOf("[소관기관]") &&
    sourceOfYouth.indexOf("[소관기관]") < sourceOfYouth.indexOf("[지원내용]"),
  "필드 순서가 §5.3 그대로",
);
check(
  !buildSourceText({ ...YOUTH_LIKE, etc_text: "        " }).includes("[기타사항]"),
  "공백만 있는 필드도 생략된다",
);
check(
  buildSourceText({ ...YOUTH_LIKE, biz_period_etc: "상시" }).includes("[신청기간]\n상시"),
  "apply_period가 없으면 biz_period_etc로 대체",
);
check(
  !buildSourceText(YOUTH_LIKE).includes("신청방법"),
  "신청방법·구비서류는 검증 대상에 넣지 않는다",
);

// ─── 5-b. buildProfileText ────────────────────────────────────
// 프로필은 JA 코드로 저장된다. 코드가 그대로 프롬프트에 들어가면 모델이 읽지 못해
// 시스템 프롬프트의 규칙 5·6이 무력해지는데, 그건 화면에서 전혀 드러나지 않는다.
const ME: Profile = {
  birth_year: 1998,
  gender: null,
  region_sido: "11",
  region_sigungu: "동대문구",
  income_bracket: null,
  situations: ["JA0326"],
  household: ["JA0404"],
  business_status: null,
};
const meText = buildProfileText(ME, REF_YEAR);

check(
  meText ===
    "- 나이: 28세 (1998년생)\n- 거주지: 서울특별시 동대문구\n- 개인 상황: 근로자/직장인\n- 가구 상황: 1인가구",
  "§5.1.2 모델 실측에 쓴 문자열과 같다",
  meText.replace(/\n/g, " / "),
);
check(!meText.includes("JA0"), "코드가 그대로 새어나가지 않는다");
check(
  buildProfileText({ ...ME, situations: ["JA0326", "JA0320"] }, REF_YEAR).includes(
    "개인 상황: 근로자/직장인, 대학생/대학원생",
  ),
  "다중선택은 라벨을 이어 붙인다",
);
check(
  buildProfileText({ ...ME, region_sigungu: null }, REF_YEAR).includes("거주지: 서울특별시\n"),
  "시군구가 없으면 시도까지만",
);
check(
  buildProfileText({ ...ME, business_status: "JA1101" }, REF_YEAR).includes(
    "사업자 상황: 예비창업자",
  ),
  "사업자상황이 프롬프트에 들어간다 (규칙 6이 읽는 항목)",
);
// 모든 항목이 선택이라(작업 4) 실제로 저장될 수 있는 상태다. 판정 라우트가 이 경우를 정해야 한다.
check(buildProfileText(EMPTY_PROFILE, REF_YEAR) === "", "빈 프로필은 빈 문자열");
check(
  buildProfileText({ ...EMPTY_PROFILE, birth_year: 1998 }, REF_YEAR) === "- 나이: 28세 (1998년생)",
  "생년만 있으면 그 줄만",
);

// 프로덕션(gemini.ts)과 실측 스크립트(model-eval.mts)가 같은 틀을 쓰는지 — 갈라지면 §5.1.2 전제가 깨진다
check(
  buildUserText("- 나이: 28세", "[정책명]\n청년 월세") ===
    "[사용자 조건]\n- 나이: 28세\n\n[정책 원문]\n[정책명]\n청년 월세",
  "사용자 메시지 틀이 §5.1.2 실측 때와 같다",
);

// ─── 6. locateQuote — \r\n이 낀 원문 ──────────────────────────
const SOURCE = "[지원대상·자격요건]\n만 19세~39세\r\n서울시 거주 청년\n\n[지원내용]\n월 20만원";
const QUOTE = "만 19세~39세 서울시 거주 청년"; // 모델이 개행을 스페이스로 바꿔 인용한 경우

const located = locateQuote(SOURCE, QUOTE);
const sliced = located === null ? null : SOURCE.slice(located.start, located.end);
check(
  sliced === "만 19세~39세\r\n서울시 거주 청년",
  "locateQuote가 \\r\\n이 낀 문장의 원본 구간을 정확히 반환",
  JSON.stringify(sliced),
);
check(locateQuote(SOURCE, "무주택 세대주여야 합니다") === null, "원문에 없는 인용은 null");
check(locateQuote(SOURCE, "   ") === null, "공백만 있는 인용은 null");

// ─── 7. validateVerdict 3단 ───────────────────────────────────
const invented = validateVerdict(
  { verdict: "eligible", reason: "해당됩니다", quote: "무주택 세대주에 한함", blockers: [] },
  SOURCE,
);
check(
  invented.verdict === "unclear" && !invented.quote_verified && invented.quote === null,
  "원문에 없는 quote → unclear로 강등",
);
check(
  invented.reason === "근거를 원문에서 찾지 못했습니다.",
  "강등 시 이유 문구 고정",
  invented.reason,
);

const verified = validateVerdict(
  { verdict: "eligible", reason: "  나이·지역 조건을\n모두 충족합니다  ", quote: QUOTE, blockers: [] },
  SOURCE,
);
check(verified.verdict === "eligible" && verified.quote_verified, "원문에 있는 quote → 판정 유지");
check(
  verified.highlight !== null &&
    SOURCE.slice(verified.highlight.start, verified.highlight.end).includes("서울시 거주 청년"),
  "검증 통과분은 하이라이트 구간이 함께 나온다",
);
check(
  verified.reason === "나이·지역 조건을 모두 충족합니다",
  "reason의 개행·연속 공백 정리",
  JSON.stringify(verified.reason),
);

check(validateVerdict({ verdict: "maybe" }, SOURCE).verdict === "unclear", "정의 밖의 verdict → unclear");
check(validateVerdict(null, SOURCE).verdict === "unclear", "응답이 null → unclear");
check(validateVerdict("{}", SOURCE).verdict === "unclear", "응답이 문자열 → unclear");

const saidUnclear = validateVerdict(
  { verdict: "unclear", reason: "원문에 소득 조건이 없습니다", blockers: [] },
  SOURCE,
);
check(
  saidUnclear.reason === "원문에 소득 조건이 없습니다",
  "인용 없이 unclear를 낸 경우 모델의 이유를 살린다",
  saidUnclear.reason,
);

const longReason = validateVerdict({ verdict: "unclear", reason: "가".repeat(300) }, SOURCE);
check(longReason.reason.length <= 201, "reason 길이 상한", `${longReason.reason.length}자`);

const dirtyBlockers = validateVerdict(
  { verdict: "ineligible", reason: "해당하지 않습니다", quote: QUOTE, blockers: ["무주택 세대", "", 42] },
  SOURCE,
);
check(
  dirtyBlockers.blockers.length === 1 && dirtyBlockers.blockers[0] === "무주택 세대",
  "blockers에서 빈 값·비문자열 제거",
  JSON.stringify(dirtyBlockers.blockers),
);

// ─── 8. profileSignature ──────────────────────────────────────
const BASE = prof({
  birth_year: 1998,
  gender: "JA0102",
  region_sido: "11",
  region_sigungu: "동대문구",
  income_bracket: "JA0203",
  situations: ["JA0320", "JA0321"],
  household: ["JA0412"],
});

check(
  profileSignature(BASE) === profileSignature({ ...BASE, situations: ["JA0321", "JA0320"] }),
  "배열 순서만 바꿔도 서명이 같다",
);
const otherInterests: ProfileRow = { ...BASE, interests: ["edu", "welfare", "farm"] };
check(
  profileSignature(BASE) === profileSignature(otherInterests),
  "interests만 바꾸면 서명이 안 바뀐다",
);
check(
  profileSignature(BASE) !== profileSignature({ ...BASE, birth_year: 1997 }),
  "판정 입력이 바뀌면 서명이 바뀐다",
);
check(
  profileSignature(BASE) !== profileSignature({ ...BASE, region_sigungu: null }),
  "시군구를 지우면 서명이 바뀐다",
);
check(
  profileSignature(EMPTY_PROFILE) === profileSignature({ ...EMPTY_PROFILE }),
  "빈 프로필도 결정론적",
);

console.log("PASS");
for (const p of pass) console.log("  ✓ " + p);
if (fail.length) {
  console.log("FAIL");
  for (const f of fail) console.log("  ✗ " + f);
}
console.log(`\n${pass.length}/${pass.length + fail.length} 통과`);
process.exit(fail.length ? 1 : 0);
