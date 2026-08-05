/**
 * 코드 게이트 (ARCHITECTURE §5.0, PRD §7.2)
 *
 * 원칙은 **모르면 통과**다. 정책에 조건 코드가 없거나 프로필 값이 비면 그 항목을 검사하지 않는다.
 * 게이트가 하는 일은 "확실히 아닌 것을 빼는 것"이지 "확실한 것만 남기는 것"이 아니다.
 *
 * ⚠️ 같은 규칙이 목록 SQL 1차 필터에도 있다 (§5.0.1). 규칙을 바꿀 때는 두 곳을 같이 바꾼다.
 */

/** eligibility_codes jsonb (§2.1.1). 의미를 아는 그룹만 읽고 unknown은 읽지 않는다. */
export type EligibilityCodes = {
  gender?: string[];
  income?: string[];
  situation?: string[];
  household?: string[];
  business?: string[];
  /** 원본이 '전부 Y'였던 그룹 이름 = 제한 없음 */
  no_limit?: string[];
  /** 온통청년 — 의미 불명. 판정에 쓰지 않는다 */
  unknown?: Record<string, unknown>;
};

/** policies에서 게이트가 읽는 칸만. */
export type PolicyConditions = {
  age_min: number | null;
  age_max: number | null;
  is_nationwide: boolean;
  region_sidos: string[];
  /** 시군구 '이름'. 정부24만 채워진다 */
  region_sigungu: string | null;
  eligibility_codes: EligibilityCodes;
};

/** profiles 행 중 판정 입력이 되는 칸 (§2.2). 전부 선택이다. interests는 목록 필터라 읽지 않는다. */
export type Profile = {
  birth_year: number | null;
  gender: string | null;
  region_sido: string | null;
  region_sigungu: string | null;
  income_bracket: string | null;
  situations: string[];
  household: string[];
  business_status: string | null;
};

export type GateResult = { pass: true } | { pass: false; blockers: string[] };

type CodeGroup = "gender" | "income" | "situation" | "household" | "business";

/** JA0111 = 120은 상한 없음이다. 실측에서 가장 흔한 값이라 그대로 읽으면 대량 오판이 난다 (§2.1.3) */
const NO_AGE_LIMIT = 120;

/** 문구가 만나이인지 연나이인지 제각각이다. 경계에서 틀려 신청 기회를 잃게 만드는 것보다 애매한 게 낫다 */
const AGE_SLACK = 1;

/** 그룹별 '해당사항없음' 코드 = 그 그룹은 제한 없음 (§5.0) */
const ANY_CODE: Partial<Record<CodeGroup, string>> = {
  situation: "JA0322",
  household: "JA0410",
};

const GROUP_LABEL: Record<CodeGroup, string> = {
  gender: "성별",
  income: "소득",
  situation: "개인 상황",
  household: "가구 상황",
  business: "사업자 상황",
};

/** 생년만 저장하므로 연나이다. 목록 SQL의 `:age`도 이 값을 써야 게이트와 답이 갈리지 않는다 (§5.0.1) */
export function ageFromBirthYear(birthYear: number, refYear = new Date().getFullYear()): number {
  return refYear - birthYear;
}

/**
 * 코드로 답이 나오는 조건만 대조한다. 불일치가 하나라도 있으면 AI를 호출하지 않고 '아님'으로 확정한다.
 *
 * `refYear`는 나이 계산 기준 연도다 — 기본값은 올해. 테스트가 나이를 고정하기 위해 넘긴다.
 */
export function checkGate(
  policy: PolicyConditions,
  profile: Profile,
  refYear?: number,
): GateResult {
  const blockers: string[] = [];
  const codes = policy.eligibility_codes;

  // 나이 — 프로필에 생년이 없으면 검사하지 않는다
  if (profile.birth_year !== null) {
    const age = ageFromBirthYear(profile.birth_year, refYear);
    const min = policy.age_min;
    const max = policy.age_max !== null && policy.age_max < NO_AGE_LIMIT ? policy.age_max : null;

    if ((min !== null && age < min - AGE_SLACK) || (max !== null && age > max + AGE_SLACK)) {
      blockers.push(`나이 조건 불일치 (정책 ${ageRangeLabel(min, max)}, 입력 ${age}세)`);
    }
  }

  // 지역 (시도) — 전국 정책이거나 대상 시도를 모르면 검사하지 않는다
  if (
    profile.region_sido !== null &&
    !policy.is_nationwide &&
    policy.region_sidos.length > 0 &&
    !policy.region_sidos.includes(profile.region_sido)
  ) {
    blockers.push("거주 지역 조건 불일치 (정책 대상 지역이 아닙니다)");
  }

  // 지역 (시군구) — 프로필에 시군구가 없으면 검사하지 않는다.
  // 구 단위 정책도 시도만 맞으면 통과시킨다. 숨기지 않는다 (§5.0)
  if (
    policy.region_sigungu !== null &&
    profile.region_sigungu !== null &&
    policy.region_sigungu !== profile.region_sigungu
  ) {
    blockers.push(`시군구 조건 불일치 (정책 대상 ${policy.region_sigungu})`);
  }

  checkCodeGroup(blockers, codes, "gender", toCodes(profile.gender));
  checkCodeGroup(blockers, codes, "income", toCodes(profile.income_bracket));
  checkCodeGroup(blockers, codes, "situation", profile.situations);
  checkCodeGroup(blockers, codes, "household", profile.household);
  checkCodeGroup(blockers, codes, "business", toCodes(profile.business_status));

  return blockers.length === 0 ? { pass: true } : { pass: false, blockers };
}

/**
 * 코드 그룹 하나를 대조한다. 아래 넷은 모두 통과다.
 * 조건 없음(빈 배열) / no_limit 그룹 / 해당사항없음 코드 / 프로필 미입력.
 */
function checkCodeGroup(
  blockers: string[],
  codes: EligibilityCodes,
  group: CodeGroup,
  mine: string[],
): void {
  const required = codes[group] ?? [];
  if (required.length === 0) return;
  if (codes.no_limit?.includes(group)) return;

  const anyCode = ANY_CODE[group];
  if (anyCode !== undefined && required.includes(anyCode)) return;

  if (mine.length === 0) return;
  if (mine.some((code) => required.includes(code))) return;

  blockers.push(`${GROUP_LABEL[group]} 조건 불일치`);
}

function toCodes(value: string | null): string[] {
  return value === null ? [] : [value];
}

function ageRangeLabel(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `${min}~${max}세`;
  if (min !== null) return `${min}세 이상`;
  // 둘 다 null이면 블로커 자체가 안 생기므로 여기 오면 max는 있다
  return `${max}세 이하`;
}
