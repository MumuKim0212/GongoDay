# TODO :: 오늘공고

- 기준 문서: [PRD.md](PRD.md) · [ARCHITECTURE.md](ARCHITECTURE.md)
- 제출 기한: **2026-08-09 (일) 23:59**

**날짜가 아니라 의존성 순서로 적는다.** 병렬 가능한 것은 ★로 표시했다.

각 항목에 **완료 판정**을 붙였다. 판정이 통과하지 않으면 다음으로 넘어가지 않는다.

---

## 시작 전 결정 ✅ 완료

- [x] **서비스명 → 오늘공고** (8/5). 랜딩 카피가 "오늘 올라온 공고"가 아니라 **"오늘 내가 신청할 수 있는 공고"** 로 읽히게 한다
- [x] **API 키 6종 발급** (8/5) — `.env.local` 기입
- [x] **특화 축 확정** (8/5) — 실측 기준. **지역(수도권) 주축 + 분야 기본 좁게 + 개인 자격 게이트** (PRD §1.3)
- [ ] Gemini 모델 확정 — 구현 시점 사용 가능 목록 확인 ([§5.1.1](ARCHITECTURE.md))

---

## 작업 0 :: 온통청년 검증 ✅ 완료 (8/5)

- [x] 목록 API 실호출 + **전량 2,698건 수집 후 재검증**
- [x] 채움률 / 지역 코드 구조 / 나이 게이트 실효 측정
- [x] 3건 표본으로 세운 가정 2개가 깨진 것을 확인하고 설계 수정

> 결과: [api/온통청년_실제응답검증.md](api/온통청년_실제응답검증.md) — **§7이 전량 재검증 결과**

## 작업 0-B :: 정부24 검증 ✅ 완료 (8/5)

- [x] `serviceList` / `supportConditions` 실호출 → 양쪽 `totalCount` 10,964 일치
- [x] **`supportConditions` 서비스ID 없이 벌크 페이징 가능 확인** → 건별 호출 불필요
- [x] `Authorization: Infuser <KEY>` 헤더 인증 확인 (쿼리스트링 아님)
- [x] 텍스트 채움률 (지원대상 100%) / 코드 채움률 / `JA****` 값 해석 규칙
- [x] **소관기관명으로 시군구 단위 지역 판별 가능 확인** (99.1%)
- [x] 지역별·분야별 `matchCount` 실측

> 결과: [api/정부24_실제응답검증.md](api/정부24_실제응답검증.md)

---

## 작업 0.5 :: 프로젝트 셋업 + 세션 ★ 1과 병렬

- [ ] `create-next-app` (TypeScript, App Router, Tailwind, **`src/` 사용**)

  > ⚠️ **`.env.local` / `.env.example`이 있으면 `create-next-app .`이 "디렉터리가 비어있지 않다"며 거부한다.**
  > (`docs/`와 `.gitignore`는 허용 목록이라 문제없다. `.env*`만 걸린다.)
  >
  > ```powershell
  > New-Item -ItemType Directory _envtmp
  > Move-Item .env.local, .env.example _envtmp
  > npx create-next-app@latest . --typescript --tailwind --app --src-dir --eslint
  > Move-Item _envtmp\* .
  > Remove-Item _envtmp
  > ```

- [ ] Supabase 프로젝트 생성 + **익명 로그인(Anonymous Sign-Ins) 활성화**
- [ ] `.env.local`에 Supabase 3개 키 추가 (나머지 3개는 이미 있음)
- [ ] **create-next-app이 만든 `.gitignore`가 `!.env.example`을 덮지 않는지 확인**
- [ ] Vercel 프로젝트 연결 + 환경변수 6개 등록 (**첫날에 해둔다**)
- [ ] **`@supabase/ssr` + `middleware.ts`로 세션 쿠키 갱신** ([§1.1](ARCHITECTURE.md))
- [ ] 첫 방문 시 `signInAnonymously()` 자동 호출

**완료 판정 (둘 다)**
1. 빈 페이지가 Vercel URL로 열린다
2. **서버 컴포넌트에서 `auth.uid()`가 값을 반환한다** ← 안 되면 1차 필터도 RLS도 조용히 안 먹는다. **여기서 막히면 다음으로 넘어가지 말 것**

---

## 작업 1 :: 스키마

- [ ] `supabase/schema.sql` — `policies` / `profiles` / `verdicts` / `scraps` / `sync_runs`
- [ ] **배열 컬럼 전부 `not null default '{}'`** — `region_sidos`, `region_codes`, `categories`, `audiences`, `situations`, `household`, `interests`, `blockers`
  - nullable이면 `&&` 비교가 NULL을 반환해 **해당 행이 통째로 사라진다**
- [ ] `policies.is_nationwide` / `region_sidos` / `region_sigungu` / `categories`
- [ ] `policies.source_registered_at` + 인덱스 (정렬 기준)
- [ ] `verdicts.decided_by`
- [ ] `profiles.interests` 기본값 `'{job,housing}'`
- [ ] RLS 5개 테이블 전부 ([§2.5](ARCHITECTURE.md))
- [ ] `policies`에 클라이언트 write 정책을 **만들지 않았는지** 확인

**완료 판정**: anon key로 `policies` INSERT 시도 → 거부. 다른 세션의 `profiles` 조회 → 0행.

---

## 작업 2 :: 수집

### 2a. 온통청년 + 공용 정규화

- [ ] `lib/sources/region.ts` — 시도 prefix ↔ 이름, 정부24 기관명 파싱 ([§2.6](ARCHITECTURE.md))
  - [ ] 온통청년 `is_nationwide` = **시도 prefix 15개 이상** (빈 배열 아님!)
- [ ] `lib/sources/category.ts` — 분야 정규화 ([§2.1.4](ARCHITECTURE.md))
  - [ ] **신·구 분류 합치기** (`복지문화`↔`금융･복지･문화` 등)
  - [ ] 콤마 조합 split, **전각 가운뎃점 `･`** 처리, 미매핑은 `etc`
- [ ] `lib/sources/youth.ts` — `fetchPage()` + `toPolicy()`
  - [ ] `resultCode !== 200`이면 throw
  - [ ] 텍스트를 **라벨별 컬럼에 나눠서** 저장
  - [ ] `toPolicy`는 **throw하지 않는다**
- [ ] `lib/supabase/admin.ts` (service_role 전용)
- [ ] `POST /api/sync` — `source` 파라미터 + `last_page` 이어받기
- [ ] **`export const maxDuration = 60`**
- [ ] **지수 백오프 재시도** ← 전량 수집 중 HTTP 500이 1회 발생했다

**완료 판정**: `select count(*) from policies where source='youth'` = 2,698 (±최근 등록분)

### 2b. 정부24

- [ ] `lib/sources/gov24.ts` — `serviceList` + `supportConditions`를 `서비스ID`로 Map 조인
- [ ] `Authorization: Infuser <KEY>` **헤더** 인증 (쿼리스트링 아님)
- [ ] `JA****` → `eligibility_codes` 정규화
  - [ ] **그룹이 전부 `Y`면 `no_limit`에 기록** ([§2.1.1](ARCHITECTURE.md)) ← 빠뜨리면 대량 오판
  - [ ] **`JA0111 = 120`은 상한 없음**
- [ ] `소관기관유형 == '중앙행정기관'` → `is_nationwide`
- [ ] `소관기관명` 파싱 → `region_sidos` + `region_sigungu`. **판별 실패는 전국 취급**
- [ ] `사용자구분`을 `||`로 split → `audiences`

**완료 판정**: `select source, count(*) from policies group by 1` → youth 2,698 / gov24 10,964

### 2c. 데이터 품질·규모 확인 ★ 건너뛰지 말 것

- [ ] 채움률 확인 — 예상: youth `eligibility_text` 33.7%, gov24 100%
- [ ] **대표 프로필(28세·서울·근로자·1인가구)로 1차 필터 후 건수** ([§5.0.1](ARCHITECTURE.md))

**완료 판정 / 분기** (PRD §8 R14)

| 결과 | 조치 |
|---|---|
| 200~400건 | 그대로 진행 |
| 400건 초과 | 기본 분야를 1개로 줄이거나, 시군구 선택을 유도 |
| 200건 미만 | 기본 분야를 3개로 늘린다 |

> 목표는 **"판정 버튼 한 번에 목록 전체가 판정되는 규모"**다.

### 2d. 지역 목록 도출 ★ 반드시 전량 수집 후

- [ ] **시도**: 단일 시도 정책만으로 prefix → 이름 도출 ([§2.6.1](ARCHITECTURE.md))
  - 예상 16개. `12 = 전남광주통합특별시`가 나오면 정상
- [ ] **시군구**: 정부24 `region_sigungu` distinct (수도권 3개 시도)
  - [ ] **경기도가 비어 있지 않은지 반드시 확인** ← 표본에서는 0개였다 (R12)
- [ ] 결과를 `lib/profile/schema.ts` 상수로 고정

**완료 판정**: 서울·인천·경기 시군구 목록이 모두 비어 있지 않고, 인천에 `영종구`·`제물포구`가 포함된다.

> ⚠️ **하드코딩 금지.** 행정구역이 재편된 데이터다 (R13).

---

## 작업 5 :: 판정 순수 함수 ★ 1·2와 완전 병렬

> DB도 화면도 네트워크도 필요 없다. 입출력 타입만 정하면 독립이다.

- [ ] `lib/verdict/gate.ts` — 나이(±1년) / 시도 / 시군구 / 성별 / 소득 / 상황 / 가구 / 사업자
  - [ ] **"모르면 통과"** — 정책 조건이 없거나 프로필 값이 비면 검사 생략
  - [ ] **`no_limit` 그룹은 무조건 통과**
  - [ ] `JA0322` / `JA0410`(해당사항없음) = 제한 없음
  - [ ] `age_max >= 120` = 상한 없음
- [ ] `lib/verdict/normalize.ts` — 공백 정규화 + **원본 인덱스 맵** + `locateQuote()`
- [ ] `lib/verdict/prompt.ts` — `buildSourceText()` + 시스템 프롬프트
  - [ ] **`summary`·`support_text`를 반드시 포함** (youth `eligibility_text`가 33.7%뿐)
- [ ] `lib/verdict/validate.ts` — 3단 검증
- [ ] `lib/verdict/signature.ts` — `profileSignature()` (배열 정렬 후, **`interests` 제외**)

**완료 판정 (전부)**
1. (19~39세 정책, 45세) → 불일치. (19~39세 정책, 40세) → **통과** (±1년)
2. (조건 없는 정책, 빈 프로필) → 통과
3. **(성별 남녀 모두 Y인 정책, 여성 프로필) → 통과** ← `no_limit` 처리 확인
4. 원문에 없는 `quote` → `unclear`로 강등
5. **`locateQuote`가 `\r\n`이 낀 문장에서도 원본 구간을 정확히 반환한다**
6. 같은 프로필을 배열 순서만 바꿔 넣어도 서명이 같다. **`interests`만 바꾸면 서명이 안 바뀐다**

---

## 작업 3 :: 목록 화면 `/`

- [ ] 서버 컴포넌트로 조회 (페이지당 10건, `source_registered_at desc`)
- [ ] **1차 필터** — 나이·지역·분야 SQL ([§5.0.1](ARCHITECTURE.md))
  - [ ] `±1년`을 `gate.ts`와 **똑같이**
  - [ ] "코드 조건 통과 N건 / 전체 M건 보기" 토글
- [ ] **분야 필터 UI — 기본 `일자리·창업`+`주거` 두 개만 ON**
- [ ] 정책명 검색 + 출처 필터 + 출처 배지
- [ ] 소스별 마지막 갱신 시각 + 갱신 버튼
- [ ] **빈 데이터 / 분야 결과 0건** 안내 (다른 분야 켜기 유도)
- [ ] 랜딩 한 문장 — REQ-05 + 이름 해석 고정
- [ ] 저장된 판정을 `verdicts` left join으로 함께 읽어 배지 표시

**완료 판정**: 시크릿 창에서 열어도 목록이 보인다. 세션 생성 실패를 강제해도 목록은 보인다.

---

## 작업 4 :: 프로필 화면 `/profile` (2d 이후)

- [ ] 폼 — 생년 / 성별 / **시도(3개) + 시군구** / 소득 / 개인상황 / 가구상황 / 사업자상황 / **관심분야**
- [ ] 시군구는 선택한 시도의 목록만
- [ ] **모든 항목 선택 가능** + "채울수록 정확해집니다" 안내
- [ ] 값은 **정부24 코드 문자열 그대로** 저장, 라벨은 상수에서 매핑
- [ ] Server Action 저장 (RLS로 본인 행만)
- [ ] 프로필 없을 때 목록에 CTA

**완료 판정**: 저장 후 새로고침해도 값이 남는다. 다른 세션에서는 안 보인다. 생년만 채워도 저장된다.

---

## 작업 6 :: 판정 API + 배지 ★ 핵심

- [ ] `lib/verdict/gemini.ts` — **never throws**. `responseSchema` + `temperature: 0`
- [ ] `POST /api/verdicts` — 캐시 → 게이트 → AI → 검증 → upsert
- [ ] **서버가 `profiles`를 직접 조회해 서명 계산** (클라이언트 값 불신)
- [ ] `decided_by` 기록
- [ ] **`maxDuration = 60`** + 클라이언트 자체 타임아웃(45초)
- [ ] 배지 + 페이지 내 정렬 (해당 → 애매 → 아님)
- [ ] **`아님`을 제거하지 않는다** — 접힘 유지 + **`blockers` 노출** (PRD §7.5)
- [ ] 코드/AI 판정 구분 표시 (F-11b)
- [ ] 판정 중 스켈레톤, 실패 시 해당 카드만 `애매`

**완료 판정 (전부)**
1. 같은 프로필로 두 번 판정 → 두 번째는 Gemini 호출 **0건**
2. AI 실패를 강제해도 다른 카드는 정상, 화면이 비지 않는다
3. 라우트를 강제 지연시켜도 전건 `애매`로 끝나고 화면이 살아 있다
4. 나이가 크게 어긋나는 정책은 **Gemini 호출 없이** `아님`
5. **`아님` 카드에 "왜 아닌지"가 적혀 있다**

---

## 작업 7 :: 상세 화면 `/policies/[id]`

- [ ] **판정 근거 원문 블록** — `buildSourceText()` 출력
- [ ] **신청 안내 블록** — 신청방법 · 구비서류 · 심사방법 (하이라이트 대상 아님)
- [ ] 인용문 하이라이트 (`locateQuote()` 구간)
- [ ] 검증 실패 시 "근거를 원문에서 찾지 못했습니다"
- [ ] 원문 링크 + 스크랩

**완료 판정**: 검증을 통과한 판정은 **예외 없이** 하이라이트가 맞는다. 개행이 낀 문장으로도 확인한다.

---

## 작업 8 :: 스크랩 → 배포 → 제출

### 스크랩
- [ ] 스크랩 / 해제 + "스크랩만 보기"

### 배포 검증
- [ ] **다른 기기 또는 시크릿 창** 접속 (REQ-04)
- [ ] 첫 방문자 흐름 전체 (목록 → 프로필 → 판정 → 상세)
- [ ] 예외 처리 매트릭스 13항목 ([§7](ARCHITECTURE.md))
- [ ] `service_role` 키가 클라이언트 번들에 없는지 (빌드 산출물 검색)

### 제출물
- [ ] [미니프로젝트3_김경민.md](submission/미니프로젝트3_김경민.md) — 배포 주소를 맨 위에
  - [ ] §4 AI: 코드 게이트/AI 분리 + **인용 검증** + 숨기지 않는 설계
  - [ ] §5 데이터: `source` 컬럼 하나로 두 출처를 한 테이블에
  - [ ] **§7 기획서와 달라진 점 — 아래를 반드시 포함**
    - 뺀 것: **법안 추적** (지금 필요하지 않고, "해당되는가"라는 질문이 성립하지 않아서)
    - 뺀 것: 알림 발송 · 마감 필터 · **비수도권** · 온통청년 시군구 판정
    - **바꾼 것: 알림(push) → 조회·판정(pull), AI 분야 한정 → 다분야 개인 매칭**
    - **좁힌 것: 수도권 특화 — 왜 그 축인지 실측 근거와 함께** (나이 4% vs 지역 82%)
  - [ ] §8 가장 오래 막힌 것: **3건 표본으로 세운 가정 2개가 전량 수집 후 깨진 일** (지역 매핑·전국 표현)
- [ ] **스크린샷 2장 이상 — AI 판정이 동작하는 장면 필수**
  - [ ] 배지가 붙은 목록 (두 출처가 섞인 화면이면 더 좋다)
  - [ ] 상세 화면의 인용 근거 하이라이트
- [ ] `node_modules` 제외 zip
- [ ] [CHECKLIST.md](assignment/CHECKLIST.md) 전 항목 대조

---

## 잘라낼 순서 (시간이 부족할 때)

위에서부터 버린다.

1. **정부24 소스** — 온통청년만으로도 성립한다. 단 **AI 판정 재료가 크게 줄어든다**(gov24 지원대상 100% vs youth 33.7%). 되도록 살린다
2. 스크랩 (기능 3)
3. 출처 필터 — 분야 필터와 검색만 남긴다
4. 상세 화면 하이라이트 — 인용문을 별도 블록으로만 표시
5. 소득·가구·사업자 프로필 필드 — 지역·나이만으로도 게이트가 돈다
6. **시군구 단위 판정** — 시도까지만. 단 이건 웰로 대비 차별점이라 마지막에 버린다

**절대 버리지 않는 것**

- **인용 검증** — 없으면 AI를 신뢰할 근거가 사라진다 (제출 문서 §4의 핵심)
- **`아님`을 숨기지 않는 설계 + `blockers` 노출** — 후기 불만 #1에 대한 답
- **분야 기본값 좁게** — 후기 불만 #2에 대한 답이고, 첫 화면 규모를 통제한다
- **작업 2c·2d** — 안 하면 화면이 비거나 시군구를 못 고른다
- **배포 검증** — 본인 브라우저에서만 되는 사고가 가장 흔하다
