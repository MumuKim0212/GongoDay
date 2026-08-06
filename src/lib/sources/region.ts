/**
 * 지역 정규화 — 두 소스 공용 (ARCHITECTURE §2.6).
 *
 * 소스마다 세밀도가 다르다. 온통청년은 시도까지, 정부24는 시군구까지.
 */
import { SIGUNGU_TO_SIDO } from "./regions.generated";

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
 * **판별 실패는 전국으로 취급한다.** `fallback()`까지 거치고 남는 실패분은 비중앙 9,911건의 11.3%이고
 * `대한법률구조공단`처럼 **실제로 전국 기관인 것이 대부분**이다. 지역을 모르는 것을 '아님'으로 만들면
 * "숨기지 않는다"는 원칙에 어긋난다. 모르면 통과다.
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
  if (!hit) return fallback(name);

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

/**
 * 접두사 매칭이 실패했을 때 — 기관명 **안쪽**에서 지역명을 찾는다.
 *
 * 실측: 접두사만으로는 비중앙 9,911건 중 1,528건(15.4%)이 판별되지 않는다.
 * `공공기관` 100% · `지방출자_출연기관` 82% · `지방공기업` 79.5%가 여기 걸린다.
 * 그런데 그중 상당수는 `용산구시설관리공단`·`재단법인경기도시장상권진흥원`처럼
 * **지역명이 접두사가 아닌 위치에** 들어 있다.
 *
 * **오탐은 정책을 숨긴다.** '전국'에서 '특정 지역 전용'으로 바뀌면 다른 지역 사용자에게
 * 안 보이게 되므로(PRD §7.5 위반), 규칙을 좁게 잡는다.
 *
 * 1. **정식 명칭만** 쓴다. `서울`·`충북` 같은 약칭까지 넓히면
 *    `서울올림픽기념국민체육진흥공단`(전국 기관)이 서울 전용이 된다
 * 2. **여러 시도에 겹치는 시군구 이름은 제외**한다 (중구·동구·남구·북구·서구·강서구·고성군).
 *    `regions.generated.ts`가 이미 걸러서 내보낸다
 * 3. **긴 이름 먼저** — `남양주시`가 `양주시`보다 먼저 걸려야 한다
 * 4. **시군구를 시도보다 먼저** 본다. `(재)인천광역시부평구문화재단`은 부평구가 더 정확하다
 *
 * 전량 1,528건에 적용해 96개 기관 406건을 회수했고, 96개를 전수 확인해 오탐은 0건이었다.
 * 나머지 1,122건은 `대한법률구조공단`·`기술보증기금` 등 실제 전국 기관이라 그대로 둔다.
 */
function fallback(name: string): RegionFields {
  const sg = SIGUNGU_TO_SIDO.find(([sigunguName]) => name.includes(sigunguName));
  if (sg) {
    return { is_nationwide: false, region_sidos: [sg[1]], region_sigungu: sg[0], region_codes: [] };
  }

  const sd = SIDO_PREFIXES.find(([sidoName]) => name.includes(sidoName));
  if (sd) {
    return { is_nationwide: false, region_sidos: [sd[1]], region_sigungu: null, region_codes: [] };
  }

  // 지역을 못 찾으면 전국으로 둔다 — 모르는 것을 '아님'으로 만들지 않는다 (§5.0)
  return { is_nationwide: true, region_sidos: [], region_sigungu: null, region_codes: [] };
}
