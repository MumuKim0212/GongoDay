/**
 * 분야 정규화 — 두 소스 공용 (ARCHITECTURE §2.1.4, PRD §6.1).
 *
 * 두 소스의 분류 체계가 다르고, **온통청년은 자체적으로 신·구 분류가 섞여 있다.**
 * 합치지 않으면 같은 분야가 필터 선택지에 두 번 나온다 (검증기록 §7.5).
 */

export const CATEGORIES = [
  "job",
  "housing",
  "edu",
  "welfare",
  "rights",
  "health",
  "birth",
  "farm",
  "etc",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  job: "일자리·창업",
  housing: "주거",
  edu: "교육·훈련",
  welfare: "복지·금융·문화",
  rights: "참여·권리",
  health: "건강·의료",
  birth: "임신·출산",
  farm: "농림축산어업",
  etc: "기타",
};

/** 첫 화면 규모를 통제한다. 넓히는 것은 사용자가 (PRD §1.2 후기 불만 #2). */
export const DEFAULT_CATEGORIES: Category[] = ["job", "housing"];

/**
 * 원본 분류 문자열 → 통합 분야.
 *
 * 키는 가운뎃점·공백을 제거한 형태로 둔다. 원본에 **전각 가운뎃점 `･`(U+FF65)**,
 * 가운뎃점 `·`(U+00B7), 카타카나 중점 `・`(U+30FB)가 섞여 오기 때문이다.
 */
const MAP: Record<string, Category> = {
  // ── 온통청년 lclsfNm (신·구 표기가 같은 값을 가리킨다)
  일자리: "job",
  주거: "housing",
  교육: "edu",
  교육직업훈련: "edu",
  복지문화: "welfare",
  금융복지문화: "welfare",
  참여권리: "rights",
  참여기반: "rights",

  // ── 정부24 서비스분야
  고용창업: "job",
  주거자립: "housing",
  보육교육: "edu",
  생활안정: "welfare",
  문화환경: "welfare",
  보호돌봄: "welfare",
  행정안전: "rights",
  보건의료: "health",
  임신출산: "birth",
  농림축산어업: "farm",
};

/** 가운뎃점 변종과 공백을 걷어내 매핑 키로 만든다. */
function key(s: string): string {
  return s.replace(/[·・･•ㆍ\s]/g, "");
}

/**
 * 콤마 조합(`"일자리,교육"`)을 쪼개 각각 매핑한다.
 * **매핑에 없는 값은 버리지 않고 `etc`로 넣는다.**
 */
export function toCategories(raw: unknown): Category[] {
  const parts = String(raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const out = new Set<Category>();
  for (const p of parts) out.add(MAP[key(p)] ?? "etc");
  return [...out];
}
