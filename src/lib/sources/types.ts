/** `policies` 한 행. 두 소스의 `toPolicy()`가 공통으로 뱉는 모양 (ARCHITECTURE §2.1). */
export type PolicyInsert = {
  source: "youth" | "gov24";
  external_id: string;
  title: string;

  // AI 판정 입력
  summary: string | null;
  eligibility_text: string | null;
  criteria_text: string | null;
  support_text: string | null;
  income_text: string | null;
  etc_text: string | null;

  // 표시 전용
  apply_method_text: string | null;
  document_text: string | null;
  screening_text: string | null;

  // 지역
  is_nationwide: boolean;
  region_sidos: string[];
  region_sigungu: string | null;
  region_codes: string[];

  // 분야 · 대상
  categories: string[];
  audiences: string[];
  raw_category: string | null;

  // 코드 게이트
  age_min: number | null;
  age_max: number | null;
  eligibility_codes: EligibilityCodes;

  // 기관 · 기간 · 링크
  org_name: string | null;
  org_type: string | null;
  keywords: string | null;
  apply_period: string | null;
  biz_period_etc: string | null;
  source_url: string | null;

  raw: unknown;
  source_registered_at: string | null;
  source_updated_at: string | null;
};

/** §2.1.1 — `no_limit`이 "그룹 값이 전부 Y였다(= 제한 없음)"를 기록한다. */
export type EligibilityCodes = {
  gender: string[];
  income: string[];
  situation: string[];
  household: string[];
  business: string[];
  no_limit: string[];
  unknown?: Record<string, string | null>;
};

export function emptyCodes(): EligibilityCodes {
  return { gender: [], income: [], situation: [], household: [], business: [], no_limit: [] };
}

/** 공백만 있는 문자열이 실제로 온다 (`"        "`). 빈 값은 전부 null로 통일한다. §2.1.5 */
export function text(v: unknown): string | null {
  if (typeof v !== "string") return v == null ? null : String(v).trim() || null;
  return v.trim() || null;
}

/** 숫자가 문자열로 온다 (`sprtTrgtMinAge: "19"`). 파싱 실패는 null. */
export function int(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number.parseInt(String(v), 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * 나이 전용 — **`0`은 "제한 없음"이지 나이가 아니다.**
 *
 * 온통청년은 나이 조건이 없는 정책에 `sprtTrgtMinAge`/`MaxAge`를 `"0"`으로 채워 보낸다
 * (전량의 약 19%). 그대로 저장하면 `age_max = 0`이 되어 SQL 1차 필터의
 * `age_max >= :age - 1`에서 전부 탈락하고, **모든 사용자의 목록에서 조용히 사라진다.**
 * 상한 0은 성립하지 않고 하한 0은 하한 없음과 같으므로 양쪽 다 null로 읽는다.
 */
export function age(v: unknown): number | null {
  const n = int(v);
  return n === 0 ? null : n;
}

/** 정렬 컬럼이라 잘못된 값보다 null이 낫다. §2.1.5 */
export function timestamp(v: unknown): string | null {
  const s = text(v);
  if (!s) return null;
  // "20260727" · "20260727093000" · "2026-07-27 09:30:00" 이 섞여 온다.
  const digits = s.replace(/\D/g, "");
  let iso: string;
  if (digits.length >= 14) {
    iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}Z`;
  } else if (digits.length >= 8) {
    iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00Z`;
  } else {
    return null;
  }
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}
