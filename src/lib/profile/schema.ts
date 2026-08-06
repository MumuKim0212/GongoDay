/**
 * 프로필 선택지 상수 (ARCHITECTURE §2.2 · §6.3)
 *
 * **값은 정부24 코드 문자열 그대로 저장하고 라벨은 여기서만 붙인다.** 한글을 저장하면
 * 게이트에서 코드로 되돌리는 매핑이 또 필요하다. 코드표 출처는
 * `docs/api/정부24_공공서비스정보API.md`이고, 게이트가 읽는 그룹 이름은 `lib/verdict/gate.ts`에 있다.
 *
 * 이 상수는 폼이 그리는 목록이면서 **Server Action의 허용 목록**이기도 하다 (`app/profile/actions.ts`).
 */
import { CAPITAL_AREA_SIDOS, SIDO_NAMES } from "@/lib/sources/region";
import { SIGUNGU_BY_SIDO } from "@/lib/sources/regions.generated";

export type Option = { code: string; label: string };

export const GENDERS: Option[] = [
  { code: "JA0101", label: "남성" },
  { code: "JA0102", label: "여성" },
];

export const INCOME_BRACKETS: Option[] = [
  { code: "JA0201", label: "중위소득 0~50%" },
  { code: "JA0202", label: "중위소득 51~75%" },
  { code: "JA0203", label: "중위소득 76~100%" },
  { code: "JA0204", label: "중위소득 101~200%" },
  { code: "JA0205", label: "중위소득 200% 초과" },
];

/**
 * 개인상황 (JA03xx). **`JA0322`(해당사항없음)는 뺐다.**
 *
 * 정책 쪽 `JA0322`는 "이 그룹에 제한이 없다"는 뜻이라 게이트가 통과로 읽는다(§5.0). 그런데
 * 프로필 쪽에서 같은 코드를 고르면 정책의 요구 코드와 하나도 겹치지 않아 **오히려 탈락시킨다.**
 * 해당 없으면 아무것도 고르지 않으면 된다 — 빈 값은 "모르면 통과"다.
 */
export const SITUATIONS: Option[] = [
  { code: "JA0326", label: "근로자/직장인" },
  { code: "JA0327", label: "구직자/실업자" },
  { code: "JA0320", label: "대학생/대학원생" },
  { code: "JA0319", label: "고등학생" },
  { code: "JA0318", label: "중학생" },
  { code: "JA0317", label: "초등학생" },
  { code: "JA0328", label: "장애인" },
  { code: "JA0329", label: "국가보훈대상자" },
  { code: "JA0330", label: "질병/질환자" },
  { code: "JA0301", label: "예비부모/난임" },
  { code: "JA0302", label: "임산부" },
  { code: "JA0303", label: "출산/입양" },
  { code: "JA0313", label: "농업인" },
  { code: "JA0314", label: "어업인" },
  { code: "JA0315", label: "축산업인" },
  { code: "JA0316", label: "임업인" },
];

/** 가구상황 (JA04xx). `JA0410`(해당사항없음)을 뺀 이유는 `SITUATIONS`와 같다. */
export const HOUSEHOLDS: Option[] = [
  { code: "JA0404", label: "1인가구" },
  { code: "JA0412", label: "무주택세대" },
  { code: "JA0411", label: "다자녀가구" },
  { code: "JA0403", label: "한부모가정/조손가정" },
  { code: "JA0414", label: "확대가족" },
  { code: "JA0413", label: "신규전입" },
  { code: "JA0401", label: "다문화가족" },
  { code: "JA0402", label: "북한이탈주민" },
];

export const BUSINESS_STATUSES: Option[] = [
  { code: "JA1101", label: "예비창업자" },
  { code: "JA1102", label: "영업중" },
  { code: "JA1103", label: "생계곤란/폐업예정자" },
];

/** 시도는 수도권 3개만 (PRD §3 — 비수도권은 비목표). */
export const SIDO_OPTIONS: Option[] = CAPITAL_AREA_SIDOS.map((code) => ({
  code,
  label: SIDO_NAMES[code],
}));

/**
 * 시도별 시군구 선택지 (작업 2d의 마지막 항목).
 *
 * **수집 데이터에서 도출한 것을 그대로 쓴다** — 행정구역이 재편된 데이터라 손으로 적으면 틀린다 (R13, §2.6.3).
 * 인천의 `영종구`·`제물포구`·`검단구`·`서해구`가 그 증거다. 도출은 `scripts/derive-regions.mjs`.
 */
export const SIGUNGU_OPTIONS: Record<string, string[]> = Object.fromEntries(
  CAPITAL_AREA_SIDOS.map((code) => [code, SIGUNGU_BY_SIDO[code] ?? []]),
);

/** 생년 하한. 상한은 올해다 — 게이트가 연나이로 계산하므로 미래 연도는 음수 나이가 된다. */
export const BIRTH_YEAR_MIN = 1900;
