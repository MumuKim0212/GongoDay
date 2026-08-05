# 정부24 대한민국 공공서비스 정보 API

- **Title**: 대한민국 공공서비스 정보
- **Description**: 정부24 대한민국 공공서비스 정보 제공 서비스
- **Version**: 3
- **Host**: `api.odcloud.kr`
- **Base Path**: `/api`
- **Schemes**: https, http

## 인증 방식

| 이름 | 위치 | 타입 | 설명 |
|---|---|---|---|
| ApiKeyAuth | Header | apiKey | `Authorization` 헤더에 인증키 전달 |
| ApiKeyAuth2 | Query | apiKey | `serviceKey` 쿼리 파라미터로 인증키 전달 |

두 방식 중 하나를 사용하면 됩니다.

---

## 1. 공공서비스 목록 조회

`GET /gov24/v3/serviceList`

정부24에서 제공하는 공공서비스 목록을 조회합니다.

**Consumes**: `application/json` / **Produces**: `application/json`

### 요청 Parameter

| 이름 | 위치 | 타입 | 기본값 | 설명 |
|---|---|---|---|---|
| page | query | integer | 1 | 페이지 인덱스 |
| perPage | query | integer | 10 | 페이지 사이즈 |
| returnType | query | string | JSON | 응답 데이터 타입 (JSON / XML). 기본값 JSON |
| cond[서비스명::LIKE] | query | string | - | 서비스명 검색 (부분일치) |
| cond[소관기관명::LIKE] | query | string | - | 소관기관명 검색 (부분일치) |
| cond[소관기관유형::LIKE] | query | string | - | 소관기관유형 검색 (부분일치) |
| cond[사용자구분::LIKE] | query | string | - | 사용자구분 검색 (부분일치) |
| cond[서비스분야::LIKE] | query | string | - | 서비스분야 검색 (부분일치) |
| cond[등록일시::LT] | query | string | - | 등록일시 미만(<) |
| cond[등록일시::LTE] | query | string | - | 등록일시 이하(≤) |
| cond[등록일시::GT] | query | string | - | 등록일시 초과(>) |
| cond[등록일시::GTE] | query | string | - | 등록일시 이상(≥) |
| cond[수정일시::LT] | query | string | - | 수정일시 미만(<) |
| cond[수정일시::LTE] | query | string | - | 수정일시 이하(≤) |
| cond[수정일시::GT] | query | string | - | 수정일시 초과(>) |
| cond[수정일시::GTE] | query | string | - | 수정일시 이상(≥) |

### 응답 (serviceList_api)

| 필드 | 타입 | 설명 |
|---|---|---|
| page | integer | 현재 페이지 |
| perPage | integer | 페이지당 개수 |
| totalCount | integer | 전체 데이터 수 |
| currentCount | integer | 현재 응답에 포함된 데이터 수 |
| matchCount | integer | 조건에 일치하는 전체 수 |
| data | array | `serviceList_model` 배열 |

#### data 항목 (serviceList_model)

| 필드 | 타입 | 설명 |
|---|---|---|
| 서비스ID | string | |
| 지원유형 | string | |
| 서비스명 | string | |
| 서비스목적요약 | string | |
| 지원대상 | string | |
| 선정기준 | string | |
| 지원내용 | string | |
| 신청방법 | string | |
| 신청기한 | string | |
| 상세조회URL | string | |
| 소관기관코드 | string | |
| 소관기관명 | string | |
| 부서명 | string | |
| 조회수 | integer | |
| 소관기관유형 | string | |
| 사용자구분 | string | |
| 서비스분야 | string | |
| 접수기관 | string | |
| 전화문의 | string | |
| 등록일시 | string | |
| 수정일시 | string | |

### 응답 코드

| 코드 | 설명 |
|---|---|
| 200 | 성공적으로 수행됨 |
| 401 | 인증 정보가 정확하지 않음 |
| 500 | API 서버에 문제가 발생하였음 |

---

## 2. 공공서비스 상세내용 조회

`GET /gov24/v3/serviceDetail`

정부24에서 제공하는 개별 공공서비스의 상세한 내용입니다.

**Consumes**: `application/json` / **Produces**: `application/json`

### 요청 Parameter

| 이름 | 위치 | 타입 | 기본값 | 설명 |
|---|---|---|---|---|
| page | query | integer | 1 | 페이지 인덱스 |
| perPage | query | integer | 10 | 페이지 사이즈 |
| returnType | query | string | JSON | 응답 데이터 타입 (JSON / XML) |
| cond[서비스ID::EQ] | query | string | - | 서비스ID 일치 검색 |

### 응답 (serviceDetail_api)

| 필드 | 타입 | 설명 |
|---|---|---|
| page | integer | 현재 페이지 |
| perPage | integer | 페이지당 개수 |
| totalCount | integer | 전체 데이터 수 |
| currentCount | integer | 현재 응답에 포함된 데이터 수 |
| matchCount | integer | 조건에 일치하는 전체 수 |
| data | array | `serviceDetail_model` 배열 |

#### data 항목 (serviceDetail_model)

| 필드 | 타입 | 설명 |
|---|---|---|
| 서비스ID | string | |
| 지원유형 | string | |
| 서비스명 | string | |
| 서비스목적 | string | |
| 신청기한 | string | |
| 지원대상 | string | |
| 선정기준 | string | |
| 지원내용 | string | |
| 신청방법 | string | |
| 구비서류 | string | |
| 접수기관명 | string | |
| 문의처 | string | |
| 온라인신청사이트URL | string | |
| 수정일시 | string | |
| 소관기관명 | string | |
| 행정규칙 | string | |
| 자치법규 | string | |
| 법령 | string | |
| 공무원확인구비서류 | string | |
| 본인확인필요구비서류 | string | |

### 응답 코드

| 코드 | 설명 |
|---|---|
| 200 | 성공적으로 수행됨 |
| 401 | 인증 정보가 정확하지 않음 |
| 500 | API 서버에 문제가 발생하였음 |

---

## 3. 공공서비스 지원조건 조회

`GET /gov24/v3/supportConditions`

공공서비스를 받기 위한 지원조건 정보입니다.

**Consumes**: `application/json` / **Produces**: `application/json`

### 요청 Parameter

| 이름 | 위치 | 타입 | 기본값 | 설명 |
|---|---|---|---|---|
| page | query | integer | 1 | 페이지 인덱스 |
| perPage | query | integer | 10 | 페이지 사이즈 |
| returnType | query | string | JSON | 응답 데이터 타입 (JSON / XML) |
| cond[서비스ID::EQ] | query | string | - | 공공서비스 고유 식별자 |

### 응답 (supportConditions_api)

| 필드 | 타입 | 설명 |
|---|---|---|
| page | integer | 현재 페이지 |
| perPage | integer | 페이지당 개수 |
| totalCount | integer | 전체 데이터 수 |
| currentCount | integer | 현재 응답에 포함된 데이터 수 |
| matchCount | integer | 조건에 일치하는 전체 수 |
| data | array | `supportConditions_model` 배열 |

#### data 항목 (supportConditions_model)

**기본**

| 필드 | 타입 | 설명 |
|---|---|---|
| 서비스ID | string | 공공서비스 고유 식별자 |
| 서비스명 | string | 서비스명 |

**성별**

| 코드 | 설명 |
|---|---|
| JA0101 | 남성 |
| JA0102 | 여성 |

**대상연령**

| 코드 | 타입 | 설명 |
|---|---|---|
| JA0110 | integer | 대상연령(시작) |
| JA0111 | integer | 대상연령(종료) |

**소득구간 (중위소득 기준)**

| 코드 | 설명 |
|---|---|
| JA0201 | 중위소득 0~50% |
| JA0202 | 중위소득 51~75% |
| JA0203 | 중위소득 76~100% |
| JA0204 | 중위소득 101~200% |
| JA0205 | 중위소득 200% 초과 |

**개인 상황 (생애주기·직업 등)**

| 코드 | 설명 |
|---|---|
| JA0301 | 예비부모/난임 |
| JA0302 | 임산부 |
| JA0303 | 출산/입양 |
| JA0313 | 농업인 |
| JA0314 | 어업인 |
| JA0315 | 축산업인 |
| JA0316 | 임업인 |
| JA0317 | 초등학생 |
| JA0318 | 중학생 |
| JA0319 | 고등학생 |
| JA0320 | 대학생/대학원생 |
| JA0322 | 해당사항없음 |
| JA0326 | 근로자/직장인 |
| JA0327 | 구직자/실업자 |
| JA0328 | 장애인 |
| JA0329 | 국가보훈대상자 |
| JA0330 | 질병/질환자 |

**가구 상황**

| 코드 | 설명 |
|---|---|
| JA0401 | 다문화가족 |
| JA0402 | 북한이탈주민 |
| JA0403 | 한부모가정/조손가정 |
| JA0404 | 1인가구 |
| JA0410 | 해당사항없음 |
| JA0411 | 다자녀가구 |
| JA0412 | 무주택세대 |
| JA0413 | 신규전입 |
| JA0414 | 확대가족 |

**사업자 상황**

| 코드 | 설명 |
|---|---|
| JA1101 | 예비창업자 |
| JA1102 | 영업중 |
| JA1103 | 생계곤란/폐업예정자 |

**개인사업자 업종**

| 코드 | 설명 |
|---|---|
| JA1201 | 음식적업 |
| JA1202 | 제조업 |
| JA1299 | 기타업종 |

**기관 유형**

| 코드 | 설명 |
|---|---|
| JA2101 | 중소기업 |
| JA2102 | 사회복지시설 |
| JA2103 | 기관/단체 |

**법인사업자 업종**

| 코드 | 설명 |
|---|---|
| JA2201 | 제조업 |
| JA2202 | 농업,임업 및 어업 |
| JA2203 | 정보통신업 |
| JA2299 | 기타업종 |

### 응답 코드

| 코드 | 설명 |
|---|---|
| 200 | 성공적으로 수행됨 |
| 401 | 인증 정보가 정확하지 않음 |
| 500 | API 서버에 문제가 발생하였음 |

---
*출처: `https://infuser.odcloud.kr/api/stages/44436/api-docs` (Swagger 2.0 명세)*
