import { toCategories } from "./category";
import { gov24Region } from "./region";
import { age, emptyCodes, text, timestamp, type EligibilityCodes, type PolicyInsert } from "./types";

const BASE = "https://api.odcloud.kr/api/gov24/v3";

type Raw = Record<string, unknown>;

/** 자격 코드 그룹 (§2.1.1 / 명세 `JA****` 코드표). */
const CODE_GROUPS = {
  gender: ["JA0101", "JA0102"],
  income: ["JA0201", "JA0202", "JA0203", "JA0204", "JA0205"],
  situation: [
    "JA0301", "JA0302", "JA0303", "JA0313", "JA0314", "JA0315", "JA0316",
    "JA0317", "JA0318", "JA0319", "JA0320", "JA0322", "JA0326", "JA0327",
    "JA0328", "JA0329", "JA0330",
  ],
  household: [
    "JA0401", "JA0402", "JA0403", "JA0404", "JA0410",
    "JA0411", "JA0412", "JA0413", "JA0414",
  ],
  business: ["JA1101", "JA1102", "JA1103"],
} as const;

async function get(path: string, page: number, perPage: number) {
  const key = process.env.GOV24_API_KEY;
  if (!key) throw new Error("환경 변수 GOV24_API_KEY가 없습니다.");

  // 키에 +와 ==가 들어 있어 쿼리스트링에 넣으면 이중 인코딩으로 깨진다.
  // 발급값이 "Infuser "로 시작하므로 그 문자열 전체가 헤더 값이다 (검증기록 서두).
  const res = await fetch(`${BASE}/${path}?page=${page}&perPage=${perPage}&returnType=JSON`, {
    headers: { Authorization: key },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`정부24 ${path} HTTP ${res.status} (page ${page})`);

  return (await res.json()) as { totalCount?: number; data?: Raw[] };
}

/**
 * `serviceList`와 `supportConditions`를 같은 페이지 번호로 나란히 받아 `서비스ID`로 조인한다.
 *
 * **서비스ID 없이 벌크 페이징이 된다**는 것이 작업 0-B의 핵심 발견이다 (검증기록 §2).
 * 건별 호출이면 10,964회가 필요했다.
 *
 * 조인에 실패한 건은 **버리지 않고** 코드 없이 저장한다 — 텍스트만으로도 AI 판정은 된다.
 */
export async function fetchPage(page: number, size: number) {
  const [list, conds] = await Promise.all([
    get("serviceList", page, size),
    get("supportConditions", page, size),
  ]);

  const byId = new Map<string, Raw>();
  for (const c of conds.data ?? []) {
    const id = text(c["서비스ID"]);
    if (id) byId.set(id, c);
  }

  const items = (list.data ?? []).map((svc) => {
    const id = text(svc["서비스ID"]);
    return { svc, cond: (id && byId.get(id)) || null };
  });

  return {
    items,
    totalCount: list.totalCount ?? 0,
    joinMisses: items.filter((i) => !i.cond).length,
  };
}

/**
 * 코드 그룹을 3상태로 읽는다 (§2.1.1 / 검증기록 §4.1).
 *
 * | 그룹 상태 | 저장 | 게이트 |
 * | 전부 None | 빈 배열 | 통과 (조건 없음) |
 * | **전부 Y** | 빈 배열 + no_limit | 통과 (제한 없음) |
 * | 일부만 Y | Y인 코드만 | 내 코드가 있어야 통과 |
 *
 * 전부 Y를 그대로 배열에 넣고 교집합 검사를 하면 **대량 오판**이 난다.
 */
function toCodes(cond: Raw | null): EligibilityCodes {
  const out = emptyCodes();
  if (!cond) return out;

  for (const [group, codes] of Object.entries(CODE_GROUPS)) {
    const yes = codes.filter((c) => String(cond[c] ?? "").trim().toUpperCase() === "Y");
    if (yes.length === 0) continue; // 전부 None → 조건 정보 없음
    if (yes.length === codes.length) {
      out.no_limit.push(group); // 전부 Y → 제한 없음
      continue;
    }
    out[group as keyof typeof CODE_GROUPS] = yes;
  }
  return out;
}

/** 응답 1건 → `policies` 행 (§2.1.3). **절대 throw하지 않는다.** */
export function toPolicy(raw: unknown): PolicyInsert {
  const { svc, cond } = (raw ?? {}) as { svc: Raw; cond: Raw | null };
  const s = svc ?? {};

  return {
    source: "gov24",
    external_id: String(s["서비스ID"] ?? ""),
    title: text(s["서비스명"]) ?? "(제목 없음)",

    summary: text(s["서비스목적요약"]),
    eligibility_text: text(s["지원대상"]), // 100% 채움 — 온통청년 33.7%와 대조된다
    criteria_text: text(s["선정기준"]),
    support_text: text(s["지원내용"]),
    income_text: null,
    etc_text: null,

    apply_method_text: text(s["신청방법"]),
    document_text: text(s["구비서류"]),
    screening_text: null,

    ...gov24Region(s["소관기관명"], s["소관기관유형"]),

    categories: toCategories(s["서비스분야"]),
    audiences: String(s["사용자구분"] ?? "")
      .split("||")
      .map((a) => a.trim())
      .filter(Boolean),
    raw_category: text(s["서비스분야"]),

    // JA0111 = 120은 실제 상한이 아니라 "상한 없음"이다. 게이트가 그렇게 읽는다 (§4.2)
    age_min: cond ? age(cond["JA0110"]) : null,
    age_max: cond ? age(cond["JA0111"]) : null,
    eligibility_codes: toCodes(cond),

    org_name: text(s["소관기관명"]),
    org_type: text(s["소관기관유형"]),
    keywords: null,
    apply_period: text(s["신청기한"]),
    biz_period_etc: null,
    source_url: text(s["온라인신청사이트URL"]) ?? text(s["상세조회URL"]),

    raw: { svc: s, cond },
    source_registered_at: timestamp(s["등록일시"]),
    source_updated_at: timestamp(s["수정일시"]),
  };
}
