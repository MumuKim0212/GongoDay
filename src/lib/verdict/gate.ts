/**
 * 코드 게이트 (ARCHITECTURE §5.0, PRD §7.2)
 *
 * 원칙은 **모르면 통과**다. 정책에 조건 코드가 없거나 프로필 값이 비면 그 항목을 검사하지 않는다.
 * 게이트가 하는 일은 "확실히 아닌 것을 빼는 것"이지 "확실한 것만 남기는 것"이 아니다.
 *
 * ⚠️ 같은 규칙이 목록 SQL 1차 필터에도 있다 (§5.0.1). 규칙을 바꿀 때는 두 곳을 같이 바꾼다.
 */
import { CODE_LABELS } from "@/lib/profile/schema";

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
  /** 정부24 `사용자구분`. 온통청년은 빈 배열 */
  audiences: string[];
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

/**
 * 코드로 '아님'을 확정하는 그룹. **`household`는 빠져 있다.**
 *
 * 실데이터 측정(수도권 대표 프로필, 목록 화면 888건 기준. `scripts/gate-probe.mts`가 뽑는다):
 * 가구상황을 유지했다면 잃었을 55건 중 **43건이 `무주택세대` 대상**이었다.
 * `1인가구`와 `무주택세대`는 서로 배타적인 축이 아니다 — 가구 규모와 주택 소유는 별개다.
 * 게다가 주거는 기본 ON 분야라(PRD §6.1) 이 오판이 정확히 주력 화면에서 발생한다.
 * "확실히 아닌 것만 뺀다"는 게이트 원칙에 어긋나므로 가구상황은 AI 판정으로 넘긴다.
 *
 * `situation`은 남긴다. 단독 탈락 103건 중 69건이 `구직자/실업자` 대상이라 근로자에게 정당한 배제다.
 * 남은 34건(장애인·대학생·보훈·질병)은 사용자가 스스로 체크할 동기가 강한 항목이라 폼 안내로 회수한다.
 * **성격의 차이가 아니라 정도와 노출의 차이다** — 잔여 오판 위험 상한 3.8%를 감수한 트레이드오프다.
 */
type CheckedGroup = "gender" | "income" | "situation" | "business";

/**
 * 개인이 신청할 수 있는 `사용자구분`.
 *
 * **이건 프로필 조건이 아니라 서비스 범위 조건이다** — PRD §4가 타겟을 "수도권 거주 개인"으로
 * 못박았으므로 수도권 필터와 같은 층위다. 그래서 프로필 값을 보지 않는다.
 *
 * `소상공인`을 빼면 안 된다. 이 프로젝트의 출발점이 AI 지원사업이고 그 대다수가 사업자 대상이다 (PRD §9.3).
 * `가구`도 개인이 세대를 대표해 신청한다.
 *
 * 실측(28세·서울·기본분야 2개, 888건): `법인/시설/단체` 전용이 **271건(30.5%)**.
 * 개인이 신청 자체를 할 수 없는 공고라 §1.2의 불만 #1 "지원도 못하고"에 정확히 해당한다.
 */
const INDIVIDUAL_AUDIENCES = ["개인", "소상공인", "가구"];

/** JA0111 = 120은 상한 없음이다. 실측에서 가장 흔한 값이라 그대로 읽으면 대량 오판이 난다 (§2.1.3) */
const NO_AGE_LIMIT = 120;

/** 문구가 만나이인지 연나이인지 제각각이다. 경계에서 틀려 신청 기회를 잃게 만드는 것보다 애매한 게 낫다 */
const AGE_SLACK = 1;

/** 그룹별 '해당사항없음' 코드 = 그 그룹은 제한 없음 (§5.0) */
const ANY_CODE: Partial<Record<CheckedGroup, string>> = {
  situation: "JA0322",
};

const GROUP_LABEL: Record<CheckedGroup, string> = {
  gender: "성별",
  income: "소득",
  situation: "개인 상황",
  business: "사업자 상황",
};

/** 블로커 한 줄에 나열할 정책 대상 라벨 수. 넘치면 카드가 읽히지 않는다 */
const MAX_LABELS = 3;

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

  // 사용자구분 — 값이 없으면(온통청년 전체, 정부24 일부) 검사하지 않는다. 모르면 통과다.
  if (
    policy.audiences.length > 0 &&
    !policy.audiences.some((a) => INDIVIDUAL_AUDIENCES.includes(a))
  ) {
    blockers.push(`신청 대상 불일치 (${policy.audiences.join("·")} 대상, 개인은 신청할 수 없습니다)`);
  }

  // household은 일부러 없다 — CheckedGroup 주석 참고. profile.household는 AI 프롬프트로만 간다
  checkCodeGroup(blockers, codes, "gender", toCodes(profile.gender));
  checkCodeGroup(blockers, codes, "income", toCodes(profile.income_bracket));
  checkCodeGroup(blockers, codes, "situation", profile.situations);
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
  group: CheckedGroup,
  mine: string[],
): void {
  const required = codes[group] ?? [];
  if (required.length === 0) return;
  if (codes.no_limit?.includes(group)) return;

  const anyCode = ANY_CODE[group];
  if (anyCode !== undefined && required.includes(anyCode)) return;

  if (mine.length === 0) return;
  if (mine.some((code) => required.includes(code))) return;

  const target = targetLabel(required);
  blockers.push(
    target === null
      ? `${GROUP_LABEL[group]} 조건 불일치`
      : `${GROUP_LABEL[group]} 조건 불일치 (정책 대상: ${target})`,
  );
}

/**
 * 정책이 요구하는 코드를 한글로 적는다.
 *
 * **잔여 오판 위험 상한 3.8%의 회수 장치다** (§5.0.2). 개인상황은 부가 코드(장애인·보훈 등)를
 * 안 고른 사용자를 `아님`으로 확정하는데, "개인 상황 조건 불일치"로만 적으면 무엇을 고쳐야 하는지
 * 알 수 없다. **대상이 적혀 있어야 사용자가 자기 조건을 고쳐 되찾아올 수 있다** (PRD §7.5).
 *
 * 라벨을 모르는 코드는 뺀다 — 폼에 없는 코드까지 원문 코드로 노출하면 읽을 수 없는 문구가 된다.
 */
function targetLabel(required: string[]): string | null {
  const labels = required.map((code) => CODE_LABELS[code]).filter((v) => v !== undefined);
  if (labels.length === 0) return null;
  return labels.length <= MAX_LABELS
    ? labels.join(", ")
    : `${labels.slice(0, MAX_LABELS).join(", ")} 외 ${labels.length - MAX_LABELS}개`;
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
