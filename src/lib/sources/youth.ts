import { toCategories } from "./category";
import { youthRegion } from "./region";
import { age, emptyCodes, text, timestamp, type PolicyInsert } from "./types";

const ENDPOINT = "https://www.youthcenter.go.kr/go/ythip/getPlcy";

type Raw = Record<string, unknown>;

/**
 * 목록 1페이지. 실패 시 throw — 호출자가 재시도하고 `sync_runs.error`에 기록한다.
 *
 * 응답 껍데기가 `{ resultCode, result: { pagging, youthPolicyList } }`이고,
 * **HTTP 200이어도 `resultCode`가 200이 아니면 실패다** (검증기록 §1).
 */
export async function fetchPage(page: number, size: number) {
  const key = process.env.YOUTH_API_KEY;
  if (!key) throw new Error("환경 변수 YOUTH_API_KEY가 없습니다.");

  const url = `${ENDPOINT}?apiKeyNm=${encodeURIComponent(key)}&pageNum=${page}&pageSize=${size}&rtnType=json`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`온통청년 HTTP ${res.status} (page ${page})`);

  const body = (await res.json()) as {
    resultCode?: number;
    resultMessage?: string;
    result?: { pagging?: { totCount?: number }; youthPolicyList?: Raw[] };
  };

  if (body.resultCode !== 200) {
    throw new Error(`온통청년 resultCode ${body.resultCode}: ${body.resultMessage ?? ""}`);
  }

  return {
    items: body.result?.youthPolicyList ?? [],
    totalCount: body.result?.pagging?.totCount ?? 0,
  };
}

/**
 * 응답 1건 → `policies` 행 (§2.1.2). **절대 throw하지 않는다** —
 * 한 건의 이상한 값이 전체 수집을 중단시켜서는 안 된다.
 */
export function toPolicy(raw: unknown): PolicyInsert {
  const r = (raw ?? {}) as Raw;

  return {
    source: "youth",
    external_id: String(r.plcyNo ?? ""),
    title: text(r.plcyNm) ?? "(제목 없음)",

    // 판정 주입력 addAplyQlfcCndCn이 33.7%뿐이라(R10) summary·support_text가 근거를 떠받친다.
    summary: text(r.plcyExplnCn),
    eligibility_text: text(r.addAplyQlfcCndCn),
    criteria_text: text(r.ptcpPrpTrgtCn),
    support_text: text(r.plcySprtCn),
    income_text: text(r.earnEtcCn),
    etc_text: text(r.etcMttrCn),

    apply_method_text: text(r.plcyAplyMthdCn),
    document_text: text(r.sbmsnDcmntCn),
    screening_text: text(r.srngMthdCn),

    ...youthRegion(r.zipCd),

    categories: toCategories(r.lclsfNm),
    audiences: [], // 온통청년에는 대상 구분이 없다
    raw_category: text(r.lclsfNm),

    // sprtTrgtAgeLmtYn은 쓰지 않는다 — 값이 N인데 원문에 19~39세가 명시된 건이 있었다 (§4)
    age_min: age(r.sprtTrgtMinAge),
    age_max: age(r.sprtTrgtMaxAge),

    // 의미를 모르는 코드는 판정에 쓰지 않고 보관만 한다 (PRD §8 R6)
    eligibility_codes: {
      ...emptyCodes(),
      unknown: {
        earnCndSeCd: text(r.earnCndSeCd),
        jobCd: text(r.jobCd),
        schoolCd: text(r.schoolCd),
        plcyMajorCd: text(r.plcyMajorCd),
        mrgSttsCd: text(r.mrgSttsCd),
        sbizCd: text(r.sbizCd),
        aplyPrdSeCd: text(r.aplyPrdSeCd),
      },
    },

    org_name: text(r.sprvsnInstCdNm),
    org_type: null,
    keywords: text(r.plcyKywdNm),
    apply_period: text(r.aplyYmd), // 파싱하지 않고 원문 그대로 (R2)
    biz_period_etc: text(r.bizPrdEtcCn),
    source_url: text(r.aplyUrlAddr) ?? text(r.refUrlAddr1),

    raw: r,
    source_registered_at: timestamp(r.frstRegDt),
    source_updated_at: timestamp(r.lastMdfcnDt),
  };
}
