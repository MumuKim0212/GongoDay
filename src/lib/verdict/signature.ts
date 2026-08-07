/**
 * 프로필 서명 (ARCHITECTURE §5.5)
 *
 * `verdicts`의 캐시 키다. 조건이 바뀌면 서명이 바뀌고, unique 제약이 새 행을 허용하면서 자동 재판정된다.
 *
 * **모델에 실제로 넘긴 문자열에서 뽑는다.** 예전에는 프로필 칸을 하나씩 나열했는데, 그러면
 * 프롬프트 조립이 바뀔 때 목록이 따라오지 않는다 — 실제로 그 틈으로 새는 값이 나이였다.
 * `birth_year`는 그대로인데 프롬프트에 들어가는 나이는 해가 바뀌면 달라져서, **1월 1일을 넘겨도
 * "27세 기준"으로 낸 옛 판정이 그대로 나왔다.** 조립 결과를 그대로 지문으로 삼으면 이 종류의
 * 어긋남이 구조적으로 생기지 않는다.
 *
 * `interests`는 목록 필터일 뿐이라 조립에 들어가지 않고, 따라서 서명에도 없다 — 분야를 켜고 끌
 * 때마다 재판정되면 낭비다. 반대로 **프롬프트도 판정 입력이라** 서명에 넣는다 (`RULES`).
 *
 * 서명 대상이 곧 게이트가 읽는 칸이라 `Profile` 타입을 gate.ts와 공유한다.
 */
import type { Profile } from "./gate";
import { SYSTEM_PROMPT, buildProfileText } from "./prompt";

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
 * `buildProfileText`가 읽는 칸과 한 벌로 움직여야 한다 — 칸이 빠지면 조립이 그 값을 못 보고,
 * 프로필을 고쳐도 서명이 그대로라 **옛 판정이 새 조건인 척한다.** 화면에서는 구별되지 않는
 * 종류의 사고다.
 */
export const SIGNATURE_COLUMNS =
  "birth_year, gender, region_sido, region_sigungu, income_bracket, situations, household, business_status";

/**
 * 서버가 자기 쿼리로 다시 계산한다 — 클라이언트가 보낸 서명을 신뢰하지 않는다 (§2.3).
 *
 * **다중선택은 조립하는 쪽에서 이미 정렬된 순서로 들어간다** — `buildProfileText`가 코드 배열을
 * 라벨로 옮기며 순서를 그대로 쓰므로, 같은 조건을 다른 순서로 고르면 다른 서명이 된다.
 * 그래서 조립에 넘기기 전에 여기서 한 번 정렬한다.
 *
 * `refYear`는 테스트용이다. 비워 두면 조립이 오늘 연도로 나이를 계산한다.
 */
export function profileSignature(profile: Profile, refYear?: number): string {
  const normalized: Profile = {
    ...profile,
    situations: [...profile.situations].sort(),
    household: [...profile.household].sort(),
  };
  return `p=${fnv1a(buildProfileText(normalized, refYear))}|r=${RULES}`;
}
