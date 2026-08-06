/**
 * 프로필 서명 (ARCHITECTURE §5.5)
 *
 * `verdicts`의 캐시 키다. 프로필이 바뀌면 서명이 바뀌고, unique 제약이 새 행을 허용하면서 자동 재판정된다.
 *
 * **판정 입력에 실제로 들어가는 것만 넣는다.** 전 필드를 넣으면 판정과 무관한 값을 고쳐도 캐시가 전부 무효화된다.
 * `interests`는 목록 필터일 뿐이라 넣지 않는다 — 분야를 켜고 끌 때마다 재판정되면 낭비다.
 * 반대로 **프롬프트도 판정 입력이라** 서명에 넣는다 (`RULES`). 프로필만 보면 규칙이 바뀌어도 캐시가 안 깨진다.
 *
 * 서명 대상이 곧 게이트가 읽는 칸이라 `Profile` 타입을 gate.ts와 공유한다.
 */
import type { Profile } from "./gate";
import { SYSTEM_PROMPT } from "./prompt";

/**
 * 판정 규칙 지문. **프롬프트가 바뀌면 옛 판정은 다른 규칙으로 낸 답이다** — 서명에 넣지 않으면
 * 캐시가 그대로 살아남아 새 규칙인 척한다. `checks`를 추가했을 때 실제로 그럴 뻔했다.
 *
 * 모델이 채워야 할 필드는 프롬프트에 설명이 있어야 채운다. 그래서 응답 스키마를 따로 넣지 않고
 * 프롬프트 문자열 하나만 본다 — 스키마만 바뀌고 프롬프트가 그대로인 변경은 성립하지 않는다.
 *
 * 암호 용도가 아니라 "바뀌었는가"만 보면 되므로 FNV-1a로 충분하다.
 */
const RULES = fnv1a(SYSTEM_PROMPT);

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * `profiles`에서 서명·게이트가 읽는 칸. 판정하는 쪽은 **이 목록만** 읽는다.
 *
 * `Profile` 타입과 한 벌로 움직여야 한다 — 칸이 빠지면 서명이 그 값을 못 보고, 프로필을 고쳐도
 * 캐시가 그대로 남아 **옛 판정이 새 조건인 척한다.** 화면에서는 구별되지 않는 종류의 사고다.
 */
export const SIGNATURE_COLUMNS =
  "birth_year, gender, region_sido, region_sigungu, income_bracket, situations, household, business_status";

/** 서버가 자기 쿼리로 다시 계산한다 — 클라이언트가 보낸 서명을 신뢰하지 않는다 (§2.3) */
export function profileSignature(profile: Profile): string {
  return [
    `b=${profile.birth_year ?? ""}`,
    `g=${profile.gender ?? ""}`,
    `sd=${profile.region_sido ?? ""}`,
    `sg=${profile.region_sigungu ?? ""}`,
    `inc=${profile.income_bracket ?? ""}`,
    `sit=${sortedCodes(profile.situations)}`,
    `hh=${sortedCodes(profile.household)}`,
    `biz=${profile.business_status ?? ""}`,
    `r=${RULES}`,
  ].join("|");
}

/** 선택 순서가 달라도 같은 조건이면 같은 서명이어야 한다 */
function sortedCodes(codes: string[]): string {
  return [...codes].sort().join(",");
}
