/**
 * 프로필 서명 (ARCHITECTURE §5.5)
 *
 * `verdicts`의 캐시 키다. 프로필이 바뀌면 서명이 바뀌고, unique 제약이 새 행을 허용하면서 자동 재판정된다.
 *
 * **판정 입력에 실제로 들어가는 필드만 넣는다.** 전 필드를 넣으면 판정과 무관한 값을 고쳐도 캐시가 전부 무효화된다.
 * `interests`는 목록 필터일 뿐이라 넣지 않는다 — 분야를 켜고 끌 때마다 재판정되면 낭비다.
 *
 * 서명 대상이 곧 게이트가 읽는 칸이라 `Profile` 타입을 gate.ts와 공유한다.
 */
import type { Profile } from "./gate";

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
  ].join("|");
}

/** 선택 순서가 달라도 같은 조건이면 같은 서명이어야 한다 */
function sortedCodes(codes: string[]): string {
  return [...codes].sort().join(",");
}
