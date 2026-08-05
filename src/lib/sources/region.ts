/**
 * 지역 정규화 — 두 소스 공용 (ARCHITECTURE §2.6).
 *
 * 소스마다 세밀도가 다르다. 온통청년은 시도까지, 정부24는 시군구까지.
 */

/**
 * 시도 코드 → 이름. **온통청년 전량 2,698건에서 도출한 결과다** (§2.6.1 / 검증기록 §7.2).
 *
 * 표준 법정동코드와 다르다 — 전남(46)이 없고 `12`가 광주·전남 통합 코드다.
 * 외부 코드표로 맞출 수 없어서 데이터에서 뽑았다. 작업 2d에서 재도출해 대조한다.
 */
export const SIDO_NAMES: Record<string, string> = {
  "11": "서울특별시",
  "12": "전남광주통합특별시",
  "26": "부산광역시",
  "27": "대구광역시",
  "28": "인천광역시",
  "30": "대전광역시",
  "31": "울산광역시",
  "36": "세종특별자치시",
  "41": "경기도",
  "43": "충청북도",
  "44": "충청남도",
  "47": "경상북도",
  "48": "경상남도",
  "50": "제주특별자치도",
  "51": "강원특별자치도",
  "52": "전북특별자치도",
};

/** 수도권 3개 시도. 화면 필터의 기본값이지 수집 범위가 아니다 (PRD §9.1). */
export const CAPITAL_AREA_SIDOS = ["11", "28", "41"];

/**
 * 정부24 `소관기관명` 앞에 오는 시도명 → 시도 코드.
 *
 * `SIDO_NAMES`만으로는 부족하다. 온통청년은 광주·전남을 `12` 하나로 합쳐 부르는데
 * **정부24는 실제 행정명(`광주광역시`·`전라남도`)을 쓴다.** 못 잡으면 §2.6.2 규칙에 따라
 * '전국'으로 떨어지고, 그러면 광주·전남 정책이 수도권 사용자 목록에 섞인다.
 *
 * 두 소스가 `region_sidos`라는 한 컬럼을 공유하므로 **코드 공간을 하나로 유지한다** —
 * 광주·전남은 온통청년 쪽 코드 `12`에 맞춘다. 구·신 명칭 흔들림(`강원도`↔`강원특별자치도`)도 함께 받는다.
 * 실제 판별 실패율은 작업 2c에서 센다.
 */
const SIDO_ALIASES: Record<string, string> = {
  광주광역시: "12",
  전라남도: "12",
  강원도: "51",
  전라북도: "52",
  제주도: "50",
  세종시: "36",
};

// 긴 이름이 먼저 걸리도록 정렬한다 ("전라북도"가 "전라남도"보다 먼저 매칭되는 식의 사고 방지).
const SIDO_PREFIXES: Array<[string, string]> = [
  ...Object.entries(SIDO_NAMES).map(([code, name]): [string, string] => [name, code]),
  ...Object.entries(SIDO_ALIASES).map(([name, code]): [string, string] => [name, code]),
].sort((a, b) => b[0].length - a[0].length);

export type RegionFields = {
  is_nationwide: boolean;
  region_sidos: string[];
  region_sigungu: string | null;
  region_codes: string[];
};

/**
 * 온통청년 — `zipCd` 콤마 리스트에서 시도까지만 뽑는다 (§2.6.1).
 *
 * **"빈 `zipCd` = 전국"이 아니다.** 빈 정책은 0건이었고, 전국 정책은 256개 코드를
 * 전부 나열한다. 그래서 전국 판정은 시도 prefix 개수로 한다 (검증기록 §7.1).
 */
export function youthRegion(zipCd: unknown): RegionFields {
  const codes = String(zipCd ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

  const sidos = [...new Set(codes.map((c) => c.slice(0, 2)))].sort();

  return {
    is_nationwide: sidos.length >= 15,
    region_sidos: sidos,
    region_sigungu: null, // 시군구까지 가도 2%밖에 안 줄어든다 (PRD §7.3)
    region_codes: codes,
  };
}

/**
 * 정부24 — `소관기관명`을 파싱해 시군구까지 (§2.6.2).
 *
 * **판별 실패는 전국으로 취급한다.** 실패분은 `한국주택금융공사` 같은 공공기관·재단(0.9%)인데,
 * 지역을 모르는 것을 '아님'으로 만들면 "숨기지 않는다"는 원칙에 어긋난다. 모르면 통과다.
 */
export function gov24Region(orgName: unknown, orgType: unknown): RegionFields {
  const none: RegionFields = {
    is_nationwide: true,
    region_sidos: [],
    region_sigungu: null,
    region_codes: [],
  };

  if (String(orgType ?? "").trim() === "중앙행정기관") return none;

  const name = String(orgName ?? "").trim();
  const hit = SIDO_PREFIXES.find(([sidoName]) => name.startsWith(sidoName));
  if (!hit) return none;

  const [sidoName, code] = hit;
  const rest = name.slice(sidoName.length);

  // 기관명은 `<시도> <시군구> <부서/기관>` 형태다. 공백으로 끊긴 경우만 시군구로 인정하고,
  // **첫 토큰만** 취한다. 시군구 이름에는 공백이 없다.
  //
  //   "서울특별시 동대문구"          → 동대문구
  //   "경기도 고양시 상하수도사업소"  → 고양시   ← 통째로 두면 프로필 드롭다운에 그대로 뜬다
  //   "서울특별시교육청"             → null (서울 전역)
  const sigungu = /^\s/.test(rest) ? (rest.trim().split(/\s+/)[0] || null) : null;

  return {
    is_nationwide: false,
    region_sidos: [code],
    region_sigungu: sigungu,
    region_codes: [],
  };
}
