# 온통청년 오픈(OPEN) API - 청년정책 API

> ⚠️ **이 명세는 실제 응답보다 빈약하다.** 출력 필드가 실제로는 훨씬 많고, 자격요건 코드(`sprtTrgtMinAge` 등)가 이 표에 빠져 있다.
> 구현 전에 [온통청년_실제응답검증.md](온통청년_실제응답검증.md)를 먼저 볼 것.

## 1. 요청 URL

| 항목 | 내용 |
|---|---|
| URL | `https://www.youthcenter.go.kr/go/ythip/getPlcy` |

## 2. 요청 Parameter

| 항목 | 타입 | 필수여부 | 설명 |
|---|---|---|---|
| apiKeyNm | String | Y | 발급받은 인증키 (마이페이지 > OPEN API에서 확인) |
| pageNum | Number | N | 페이지번호 |
| pageSize | Number | N | 페이지사이즈 |
| pageType | String | N | 화면유형 : 1(목록) / 2(상세) |
| plcyNo | String | N | 정책번호 |
| rtnType | String | N | 호출문서 : xml / json |
| plcyKywdNm | String | N | 정책키워드명<br>요청형식: `"키워드1,키워드2,..."` |
| plcyExplnCn | String | N | 정책설명 |
| plcyNm | String | N | 정책명 |
| zipCd | String | N | 법정시군구코드(5자리)<br>요청형식: `"11000,11330,..."`<br>VWORLD > 국가중점데이터API > 부동산 개방데이터 > 법정동정보 참고<br>예) 11000 (서울특별시), 11680 (11: 서울특별시, 680: 강남구) |
| lclsfNm | String | N | 정책대분류명<br>요청형식: `"대분류1,대분류2,..."` |
| mclsfNm | String | N | 정책중분류명<br>요청형식: `"중분류1,중분류2,..."` |

## 3. 출력결과

> 코드정의서 다운로드 별도 제공 (원문 페이지 참고)

| 항목 | 타입 | 설명 | 비고 |
|---|---|---|---|
| `<youthPolicyList>` | - | 최상위 리스트 노드 | `</youthPolicyList>` |
| `<plcyNo>` | String | 정책번호 | `</plcyNo>` |
| `<bscPlanCycl>` | String | 기본계획차수 | `</bscPlanCycl>` |
| `<bscPlanPlcyWayNo>` | String | 기본계획정책방향번호 | `</bscPlanPlcyWayNo>` |
| `<bscPlanFcsAsmtNo>` | String | 기본계획중점과제번호 | `</bscPlanFcsAsmtNo>` |
| `<bscPlanAsmtNo>` | String | 기본계획과제번호 | `</bscPlanAsmtNo>` |
| `<pvsnInstGroupCd>` | String | 제공기관그룹코드 | `</pvsnInstGroupCd>` |
| `<plcyPvsnMthdCd>` | String | 정책제공방법코드 | `</plcyPvsnMthdCd>` |
| `<plcyAprvSttsCd>` | String | 정책승인상태코드 | `</plcyAprvSttsCd>` |
| `<plcyNm>` | String | 정책명 | `</plcyNm>` |
| `<plcyKywdNm>` | String | 정책키워드명 | `</plcyKywdNm>` |
| `<plcyExplnCn>` | String | 정책설명내용 | `</plcyExplnCn>` |
| `<lclsfNm>` | String | 정책대분류명 | `</lclsfNm>` |
| `<aplyYmd>` | String | 신청기간 | `</aplyYmd>` |
| `<frstRegDt>` | String | 최초등록일시 | `</frstRegDt>` |
| `<lastMdfcnDt>` | String | 최종수정일시 | `</lastMdfcnDt>` |
| `<sBizCd>` | String | 정책특화요건코드 | `</sBizCd>` |

> ⚠️ 원본 PDF에서 출력결과 표가 3페이지에 걸쳐 나뉘어 있어(1페이지 `<lclsfNm>`까지 → 2페이지 `<aplyYmd>`부터), `<lclsfNm>` 이후 `<aplyYmd>` 사이에 `<mclsfNm>`(정책중분류명) 등 추가 항목이 있었을 가능성이 있습니다. 원문 캡처에는 해당 구간이 보이지 않아 이 부분만 확인이 필요합니다.

## 4. 요청 예시

```
https://www.youthcenter.go.kr/go/ythip/getPlcy
```

**Parameter 예시:**

```
apiKeyNm=testKey
pageNum=1
pageSize=10
rtnType=json
```

**요청 URL 예시 (조합):**

```
https://www.youthcenter.go.kr/go/ythip/getPlcy?apiKeyNm=testKey&pageNum=1&pageSize=10&rtnType=json
```

---
*출처: 온통청년 - 이용안내 > 오픈(OPEN) API 소개 > 오픈(OPEN) API 제공목록 > 청년정책API*
