-- 오늘공고 스키마 — 단일 진실 원천
-- 대응 문서: docs/ARCHITECTURE.md §2
--
-- 여러 번 돌려도 안전하도록 create ... if not exists / drop policy if exists 를 쓴다.

-- ─────────────────────────────────────────────────────────────
-- policies — 수집된 정책 (소스 무관 공통 스키마)  §2.1
-- ─────────────────────────────────────────────────────────────
create table if not exists policies (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,              -- 'youth' | 'gov24'
  external_id   text not null,
  title         text not null,

  -- AI 판정 입력 텍스트 (buildSourceText가 이 순서로 조립) §5.3
  summary          text,
  eligibility_text text,
  criteria_text    text,
  support_text     text,
  income_text      text,
  etc_text         text,

  -- 표시 전용 (AI 입력 아님) — 넣으면 검증 대상이 넓어져 엉뚱한 문장이 근거로 통과한다
  apply_method_text text,
  document_text     text,
  screening_text    text,

  -- 지역 §2.6
  is_nationwide  boolean not null default false,
  region_sidos   text[]  not null default '{}',   -- 시도 코드 배열 ← SQL 1차 필터가 읽음
  region_sigungu text,                            -- 시군구 이름. 정부24만, 온통청년은 null
  region_codes   text[]  not null default '{}',   -- 온통청년 zipCd 원본 (참고·재도출용)

  -- 분야 · 대상 §2.1.4
  categories    text[] not null default '{}',   -- 정규화된 통합 분야 ← SQL 1차 필터가 읽음
  audiences     text[] not null default '{}',   -- 정부24 사용자구분
  raw_category  text,                           -- 소스 원본 분류 문자열 (표시·디버깅)

  -- 코드 게이트 §2.1.1
  age_min       int,
  age_max       int,
  eligibility_codes jsonb not null default '{}'::jsonb,

  -- 기관 · 기간 · 링크
  org_name       text,     -- 소관/주관 기관 (AI 입력에 포함)
  org_type       text,     -- 정부24 소관기관유형
  keywords       text,
  apply_period   text,     -- 파싱하지 않고 원문 그대로 (R2)
  biz_period_etc text,
  source_url     text,

  -- 원본 · 정렬
  raw           jsonb not null,
  source_registered_at timestamptz,   -- ← 목록 정렬 기준. fetched_at은 upsert마다 갱신되어 못 쓴다
  source_updated_at    timestamptz,
  fetched_at    timestamptz not null default now(),

  unique (source, external_id)
);

-- 목록 정렬 기준. 1차 필터 컬럼에는 인덱스를 걸지 않는다 — 13,662행 순차 스캔으로 충분하다 (§5.0.1)
create index if not exists policies_source_registered_at_idx
  on policies (source_registered_at desc);

-- ─────────────────────────────────────────────────────────────
-- profiles — 내 조건 (정부24 코드 체계 기준)  §2.2
-- 모든 필드가 선택이다. 비어 있으면 게이트가 그 항목을 건너뛴다 ("모르면 통과", §5.0)
-- ─────────────────────────────────────────────────────────────
create table if not exists profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  birth_year      int,                      -- 생년만 (개인정보 최소화)
  gender          text,                     -- 'JA0101'(남) | 'JA0102'(여)
  region_sido     text,                     -- '11' 서울 | '28' 인천 | '41' 경기
  region_sigungu  text,                     -- 시군구 '이름' (예: '동대문구'). 코드가 아니다 §2.2
  income_bracket  text,                     -- 'JA0201'~'JA0205'
  situations      text[] not null default '{}',   -- JA03xx
  household       text[] not null default '{}',   -- JA04xx
  business_status text,                     -- JA11xx
  interests       text[] not null default '{job,housing}',  -- 관심 분야 §2.1.4 / PRD §6.1
  updated_at      timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- verdicts — AI 판정 결과 (캐시 겸용)  §2.3
-- profile_signature가 캐시 키다. 프로필이 바뀌면 서명이 바뀌어 자동 재판정된다 §5.5
-- ─────────────────────────────────────────────────────────────
create table if not exists verdicts (
  id                uuid primary key default gen_random_uuid(),
  policy_id         uuid not null references policies (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  profile_signature text not null,
  verdict           text not null,   -- 'eligible' | 'unclear' | 'ineligible'
  decided_by        text not null,   -- 'code' | 'ai'  (F-11b)
  reason            text,
  quote             text,            -- 원문 인용 (검증 통과분만) §7.4
  quote_verified    boolean not null default false,
  blockers          text[] not null default '{}',   -- 왜 아닌지 §7.5
  -- 애매일 때 '무엇을 확인하면 판정이 갈리는지' §5.6. 5단계 점수가 이 배열의 길이에서 나온다
  checks            text[] not null default '{}',
  created_at        timestamptz not null default now(),

  unique (policy_id, user_id, profile_signature)
);

create index if not exists verdicts_user_signature_idx
  on verdicts (user_id, profile_signature);

-- ─────────────────────────────────────────────────────────────
-- scraps / sync_runs  §2.4
-- ─────────────────────────────────────────────────────────────
create table if not exists scraps (
  user_id    uuid not null references auth.users (id) on delete cascade,
  policy_id  uuid not null references policies (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, policy_id)
);

-- 소스별로 쌓인다. 소스별 마지막 갱신 시각 표시 + 중단 시 last_page부터 이어받기
create table if not exists sync_runs (
  id             uuid primary key default gen_random_uuid(),
  source         text not null,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  last_page      int,
  fetched_count  int not null default 0,
  upserted_count int not null default 0,
  error          text
);

create index if not exists sync_runs_source_started_at_idx
  on sync_runs (source, started_at desc);

-- ─────────────────────────────────────────────────────────────
-- RLS  §2.5
-- policies / sync_runs 는 읽기만 공개. write 정책을 '아예 만들지 않는다' —
-- service_role은 RLS를 우회하므로 수집 라우트는 정책 없이도 쓴다.
-- ─────────────────────────────────────────────────────────────
alter table policies  enable row level security;
alter table profiles  enable row level security;
alter table verdicts  enable row level security;
alter table scraps    enable row level security;
alter table sync_runs enable row level security;

drop policy if exists policies_read_all on policies;
create policy policies_read_all on policies
  for select to anon, authenticated using (true);

drop policy if exists sync_runs_read_all on sync_runs;
create policy sync_runs_read_all on sync_runs
  for select to anon, authenticated using (true);

-- 본인 행만. auth.uid()가 null이면 (= 세션 없음) 아무 행도 안 잡힌다 §1.1
drop policy if exists profiles_own on profiles;
create policy profiles_own on profiles
  for all to authenticated using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists verdicts_own on verdicts;
create policy verdicts_own on verdicts
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists scraps_own on scraps;
create policy scraps_own on scraps
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
