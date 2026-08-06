# 오늘공고

**오늘, 내가 신청할 수 있는 공고만.** 수도권(서울·인천·경기)에 사는 개인이 온통청년·정부24에 흩어진 지원정책 중 **자기가 실제로 신청할 수 있는 것**을 골라 볼 수 있게, 조건을 한 번 등록해두면 AI가 원문 근거와 함께 해당 여부를 판정합니다.

- **배포 주소** : https://gongoday.vercel.app (로그인 없이 바로 사용)
- **제출 문서** : [docs/submission/미니프로젝트3_김경민.md](docs/submission/미니프로젝트3_김경민.md)
- **스크린샷** : [docs/submission/screenshots/](docs/submission/screenshots)

## 무엇을 하나

1. **목록** — 두 출처 13,662건을 한 테이블에 모아 최신순으로. 나이·지역·분야·신청대상으로 1차 필터를 걸고, 걸러진 것도 "전체 보기"로 볼 수 있습니다
2. **판정** — 현재 페이지 10건을 `해당 / 애매 / 아님`으로 판정합니다. **코드로 답이 나오는 조건은 AI를 부르지 않고**, 나머지만 Gemini가 판정합니다. 근거는 원문에서 그대로 인용한 문장이고 서버가 원문과 대조해 검증합니다
3. **상세** — 판정에 쓰인 원문을 그대로 보여주고 인용 구간을 하이라이트합니다. 스크랩할 수 있습니다

## 실행

```bash
npm install
cp .env.example .env.local   # 키 7개를 채운다
npm run dev
```

`supabase/schema.sql`이 스키마의 단일 진실 원천입니다. 정책 데이터는 화면의 **갱신** 버튼(`POST /api/sync`)으로 받습니다 — 한 번에 10페이지씩이라 전량을 받으려면 여러 번 누릅니다.

## 문서

| 문서 | 내용 |
|---|---|
| [docs/PRD.md](docs/PRD.md) | 무엇을 왜 만드는가 · 기능 목록 · 리스크 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 데이터 모델 · 판정 흐름 · 예외 처리 매트릭스 |
| [docs/TODO.md](docs/TODO.md) | 작업 순서와 **각 작업의 완료 판정 결과** |
| [docs/api/](docs/api) | 두 API를 실제로 호출해 검증한 기록 |

## 검증 스크립트

각 작업의 완료 판정을 실제로 돌려 확인합니다 (`npm run dev` 필요).

```bash
npx tsx scripts/verdict-check.mts       # 판정 순수 함수 60항목
npx tsx scripts/query-check.mts         # 목록 1차 필터 17항목
npx tsx scripts/profile-check.mts       # 프로필 저장·세션 격리 21항목
npx tsx scripts/verdict-api-check.mts   # 판정 API·캐시·배지 20항목
npx tsx scripts/detail-check.mts        # 인용 하이라이트 22항목
npx tsx scripts/release-check.mts       # 첫 방문자 흐름 + 예외 매트릭스 38항목
```

`BASE_URL=https://gongoday.vercel.app npx tsx scripts/release-check.mts` 로 배포본에도 같은 검사를 돌립니다.
