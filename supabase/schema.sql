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

-- 텔레그램 알림 배치가 읽는 두 칸 §11.
-- `create table if not exists`는 이미 있는 테이블에 컬럼을 추가하지 않으므로 alter로 분리한다.
--
-- created_at — 정책이 처음 들어온 시각. fetched_at과 달리 재수집으로 갱신되지 않으므로(§2.1)
-- 알림 배치가 "오래된 것부터" 처리하는 순서 기준이 된다.
-- upsert 쿼리(toPolicy 등)가 이 컬럼을 절대 채우지 않아야 한다 — 채우면 매번 now()로 덮여 fetched_at과 같아진다.
alter table policies add column if not exists created_at timestamptz not null default now();

-- notify_checked_at — 알림 배치가 이 정책을 처리했는가. null이면 아직 안 본 것이다.
--
-- **`created_at > 마지막 값` 커서로는 이 일을 못 한다.** `now()`는 문장 단위로 고정이라
-- 한 번에 100건씩 upsert하는 수집(`sync/run.ts`)에서 그 100건이 전부 같은 created_at을 갖는다 —
-- 커서가 그 값을 지나가는 순간 같은 시각의 나머지가 통째로, 조용히 누락된다.
-- 판정에 실패해 다음 배치가 다시 봐야 하는 건도 커서로는 표현할 수 없다 (이미 지나가 버렸다).
-- 행마다 표시하면 둘 다 사라진다.
--
-- **기존 행은 '이미 처리한 것'으로 시작해야 한다** — 안 그러면 첫 배치가 수집해 둔 전량을
-- 신규로 보고 옛 공고를 알린다. `add column`의 default가 기존 행을 채우고, 곧바로 default를
-- 지워 앞으로 들어오는 정책만 null(=미처리)로 남게 한다.
alter table policies add column if not exists notify_checked_at timestamptz default now();
alter table policies alter column notify_checked_at drop default;

-- 미처리분만 오래된 순으로 훑는다. 처리된 행은 인덱스에서 빠지므로 정책이 쌓여도 조회 비용은 그대로다.
create index if not exists policies_notify_pending_idx
  on policies (created_at) where notify_checked_at is null;

-- 커서 방식에서 쓰던 인덱스. 위 partial 인덱스가 대신하고 created_at을 그 밖에서 읽는 곳은 없다.
drop index if exists policies_created_at_idx;

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

-- 회원가입 시 받는 표시 이름. profiles 행 자체가 정식 가입 시점에 (닉네임만 채운 채) 처음 생긴다.
alter table profiles add column if not exists nickname text;

-- 텔레그램 알림 연동 §11. 익명 세션에는 허용하지 않는다 — 쿠키가 지워지면 연동이 끊기고,
-- 매시간 크론이 익명 유저를 만들 수 있어(§1.1) 익명에게 허용하면 쓸모없는 연동이 쌓인다.
-- 서버 액션이 user.is_anonymous로 막는다 (스키마 제약이 아니다).
-- `create table if not exists`는 이미 있는 테이블에 컬럼을 추가하지 않으므로 alter로 분리한다.
alter table profiles add column if not exists telegram_chat_id text;          -- 연동되면 채워진다. null = 미연동
alter table profiles add column if not exists telegram_notify_min_score int;  -- 1~5. null = 알림 꺼짐(기본값)

do $$ begin
  alter table profiles add constraint profiles_telegram_notify_min_score_check
    check (telegram_notify_min_score is null or telegram_notify_min_score between 1 and 5);
exception when duplicate_object then null;
end $$;

-- 한 텔레그램 계정이 여러 프로필에 물리는 것을 막는다 — 안 그러면 알림이 조용히 다른 계정으로 샌다
create unique index if not exists profiles_telegram_chat_id_idx
  on profiles (telegram_chat_id) where telegram_chat_id is not null;

-- ─────────────────────────────────────────────────────────────
-- verdicts — AI 판정 결과 (캐시 겸용)  §2.3
-- (policy_id, profile_signature)가 캐시 키다. 프로필이 바뀌면 서명이 바뀌어 자동 재판정된다 §5.5
-- **사용자별이 아니다.** 판정은 (정책 원문, 서명, 프롬프트)에만 의존하고 temperature 0이라,
-- 같은 조건이면 누가 불렀든 같은 답이다. 익명 세션이라 user_id는 사람이 아니라 브라우저 한 벌이고,
-- 키에 넣으면 같은 사람이 기기를 바꿀 때마다 캐시를 통째로 잃는다 §5.5
-- ─────────────────────────────────────────────────────────────
create table if not exists verdicts (
  id                uuid primary key default gen_random_uuid(),
  policy_id         uuid not null references policies (id) on delete cascade,
  -- 처음 이 판정을 부른 사람. **캐시 키가 아니다** — 로그인 기능이 붙을 때를 위해 남긴다.
  -- 계정이 지워져도 남들이 쓰는 캐시는 살아야 하므로 cascade가 아니라 set null이다.
  requested_by      uuid references auth.users (id) on delete set null,
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

  unique (policy_id, profile_signature)
);

-- 조회는 (서명 → 정책 목록) 순서다
create index if not exists verdicts_signature_policy_idx
  on verdicts (profile_signature, policy_id);

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
-- verdict_runs — 판정 배치 한 번의 장부  §2.7
--
-- **`verdicts` 행 수로는 호출 수를 셀 수 없다.** 실패한 호출은 저장하지 않고(route.ts),
-- upsert라 재판정이 행을 덮어쓰며, 캐시 적중은 애초에 행을 만들지 않는다. 셋 다 비용 판단에
-- 필요한 값이라 배치마다 한 줄씩 따로 적는다 — `sync_runs`가 수집에 대해 하는 일과 같다.
--
-- 자동 판정이라 **목록 페이지를 열 때마다 한 행씩 쌓인다.** 정수 몇 개짜리라 가볍지만
-- 무한히 늘어나는 테이블이므로, 커지면 오래된 행을 지우거나 일 단위로 말아 넣는다.
-- ─────────────────────────────────────────────────────────────
create table if not exists verdict_runs (
  id                uuid primary key default gen_random_uuid(),
  -- 누가 불렀나. 계정이 지워져도 장부는 남아야 하므로 set null이다 (verdicts.requested_by와 같다)
  requested_by      uuid references auth.users (id) on delete set null,
  -- 호출 시점에 익명이었는지. 나중에 uid로 되짚으면 로그인 전환분이 섞여 답이 달라진다
  was_anonymous     boolean not null default true,
  -- 사용자별로 묶지 못할 때(익명) 조건별로는 묶어 볼 수 있다
  profile_signature text,

  requested         int not null default 0,   -- 이번 요청이 물어본 정책 수 (≤ PAGE_SIZE)
  cached            int not null default 0,   -- 캐시로 답한 수 — 호출하지 않은 몫
  gate_blocked      int not null default 0,   -- 코드 게이트가 답한 수 — 역시 호출하지 않은 몫
  ai_called         int not null default 0,   -- **실제로 Gemini에 보낸 수. 비용의 분자다**
  ai_failed         int not null default 0,   -- 그중 답을 못 받은 수 (저장되지 않아 verdicts에는 안 남는다)

  -- 실제 청구는 호출 수가 아니라 토큰으로 매겨진다. Gemini 응답의 usageMetadata를 합산한 값이고,
  -- 응답에 없으면 0으로 남는다 — 그때는 "호출은 있는데 토큰이 0"으로 드러난다
  prompt_tokens     int not null default 0,
  output_tokens     int not null default 0,

  -- 캐시 조회 자체가 실패하면 전건이 재호출된다. 화면에 안 보이면서 값이 나가는 유일한 경로라 센다
  cache_error       boolean not null default false,
  save_error        boolean not null default false,
  duration_ms       int not null default 0,
  created_at        timestamptz not null default now()
);

-- 사용량 조회는 (사용자 → 최근) 순서다. 나중에 붙일 '유저당 사용량 제한'도 이 인덱스를 쓴다
create index if not exists verdict_runs_user_created_at_idx
  on verdict_runs (requested_by, created_at desc);

-- 기간별 합계(오늘 / 최근 7일)용
create index if not exists verdict_runs_created_at_idx
  on verdict_runs (created_at desc);

-- ─────────────────────────────────────────────────────────────
-- telegram_link_tokens — 딥링크 연동용 일회성 토큰
-- 프로필 화면에서 "텔레그램으로 연결"을 누르면 한 행이 생기고,
-- 사용자가 텔레그램에서 /start <token>을 보내면 웹훅이 이 행으로 profile_id를 되찾는다.
-- ─────────────────────────────────────────────────────────────
create table if not exists telegram_link_tokens (
  token      text primary key,               -- crypto.randomUUID() — 추정 불가능해야 한다
  profile_id uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null,           -- 발급 후 짧게(10분). 만료분은 웹훅이 거절한다
  used_at    timestamptz,                    -- null이면 미사용. 재사용 방지
  created_at timestamptz not null default now()
);

create index if not exists telegram_link_tokens_profile_id_idx
  on telegram_link_tokens (profile_id);

-- ─────────────────────────────────────────────────────────────
-- telegram_notified — (정책, 사용자) 단위 발송 이력. 중복 알림 방지.
--
-- verdicts를 이 용도로 못 쓴다 — verdicts는 프로필이 아니라 서명 단위 공유 캐시라서(§2.3),
-- 같은 조건을 가진 사용자 중 한 명에게 보낸 것을 다른 사용자에게도 보낸 것으로 잘못 취급하게 된다.
-- ─────────────────────────────────────────────────────────────
create table if not exists telegram_notified (
  policy_id  uuid not null references policies (id) on delete cascade,
  profile_id uuid not null references auth.users (id) on delete cascade,
  sent_at    timestamptz not null default now(),
  primary key (policy_id, profile_id)
);

-- ─────────────────────────────────────────────────────────────
-- notify_runs — 알림 배치 한 번의 장부. sync_runs·verdict_runs와 같은 패턴이다.
--
-- 어디까지 처리했는지는 이 표가 아니라 `policies.notify_checked_at`이 들고 있다 —
-- 실행이 중간에 끊겨도(60초 상한) 표시된 행까지가 그대로 남아 다음 배치가 이어받는다.
-- `policies_found`와 `checked`의 차이가 "다음 배치가 다시 볼 건수"다 (판정 실패분).
-- ─────────────────────────────────────────────────────────────
create table if not exists notify_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  policies_found int not null default 0,
  checked        int not null default 0,
  recipients     int not null default 0,
  ai_called      int not null default 0,
  ai_failed      int not null default 0,
  sent           int not null default 0,
  send_failed    int not null default 0,
  prompt_tokens  int not null default 0,
  output_tokens  int not null default 0,
  error          text
);

-- 커서 방식에서 쓰던 칸. 위 create table은 이미 있는 표를 건드리지 않으므로 alter로 지운다.
alter table notify_runs add column if not exists checked int not null default 0;
alter table notify_runs drop column if exists cursor_before;
alter table notify_runs drop column if exists cursor_after;

create index if not exists notify_runs_started_at_idx
  on notify_runs (started_at desc);

-- ─────────────────────────────────────────────────────────────
-- app_settings — 운영 토글 (단일 행)
-- 관리자 화면에서 즉시 켜고 꺼야 해서 환경변수가 아니라 DB 값이다. 서버는 1분 TTL로 캐시해 읽는다.
-- ─────────────────────────────────────────────────────────────
create table if not exists app_settings (
  id            boolean primary key default true check (id),  -- 항상 한 행만 존재하도록 강제
  require_login boolean not null default false
);

insert into app_settings (id, require_login)
values (true, false)
on conflict (id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- RLS  §2.5
-- policies / sync_runs 는 읽기만 공개. write 정책을 '아예 만들지 않는다' —
-- service_role은 RLS를 우회하므로 수집 라우트는 정책 없이도 쓴다.
-- ─────────────────────────────────────────────────────────────
alter table policies      enable row level security;
alter table profiles      enable row level security;
alter table verdicts      enable row level security;
alter table scraps        enable row level security;
alter table sync_runs     enable row level security;
alter table app_settings  enable row level security;
alter table verdict_runs  enable row level security;
alter table telegram_link_tokens enable row level security;
alter table telegram_notified    enable row level security;
alter table notify_runs          enable row level security;

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

-- verdicts는 공유 캐시라 '본인 행만'이 성립하지 않는다. **정책을 아예 만들지 않는다** —
-- policies/sync_runs의 write와 같은 방식으로, service_role만 읽고 쓴다.
-- 서명은 서버가 직접 계산하므로(§2.3) 클라이언트가 캐시를 오염시킬 길이 함께 막힌다.
drop policy if exists verdicts_own on verdicts;

drop policy if exists scraps_own on scraps;
create policy scraps_own on scraps
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- verdict_runs / app_settings 도 정책을 만들지 않는다 — 운영 장부와 운영 토글이라 service_role 전용이다.

-- telegram_link_tokens / telegram_notified / notify_runs도 정책을 만들지 않는다 — service_role 전용.
-- telegram_link_tokens는 웹훅(서버)만 소비하면 되고 화면이 자기 토큰을 되읽을 이유가 없다
-- (딥링크 URL 자체가 토큰을 담고 있다). telegram_notified/notify_runs는 verdict_runs와 같은 운영 장부다.

-- ─────────────────────────────────────────────────────────────
-- 운영 집계 함수  §2.8
--
-- `stats.ts`는 원래 RPC 없이 `count: exact, head: true` 병렬 조회만 쓴다 (스키마를 안 건드리려고).
-- 아래 셋은 **PostgREST로는 불가능해서** 예외로 둔 것이다:
--   · `auth.users`는 PostgREST에 노출되는 스키마가 아니다 (public/graphql_public만)
--   · `sum()` / `group by`가 PostgREST 쿼리 문법에 없다 — 행을 다 받아와 세는 수밖에 없는데
--     `verdict_runs`는 페이지뷰마다 쌓여서 그 방법이 곧 못 쓰게 된다
--
-- 셋 다 `security definer`다 (auth 스키마를 읽어야 하므로). **`anon`·`authenticated`에서 실행 권한을
-- 회수하고 service_role에만 준다** — 그러지 않으면 브라우저에 나가 있는 anon 키로 누구나
-- 사용자 수와 이메일을 읽어간다. `search_path` 고정도 같은 이유다 (definer 함수의 검색 경로 탈취 방지).
--
-- ⚠️ **`revoke ... from public` 만으로는 못 막는다.** Supabase는 `public` 의사 역할이 아니라
-- `anon`·`authenticated`에 **직접** EXECUTE를 부여한다(default privileges). 그래서 실제 ACL이
-- `anon=X/postgres`로 남고, PUBLIC에서만 회수하면 그 줄이 그대로 살아 함수가 열려 있다.
-- 실측으로 확인한 자리다 — 적용 직후 anon 키로 세 함수가 전부 호출됐다. 역할을 이름으로 회수한다.
-- ─────────────────────────────────────────────────────────────

-- 방문 → 조건 등록 → 로그인의 세 단계를 한 번에 센다.
-- ⚠️ `total`은 사람 수가 아니다. proxy.ts가 쿠키 없는 **화면 요청마다** 익명 세션을 만들므로
--    크롤러 방문이 그대로 섞인다 (§1.1). 그래서 아래 세 칸을 나란히 두는 것 자체가 누수 감지기다.
create or replace function admin_user_counts()
returns table (
  total              bigint,
  anon               bigint,
  identified         bigint,
  anon_profiled      bigint,
  identified_profiled bigint
)
language sql
security definer
set search_path = public, auth
as $$
  select
    count(*),
    count(*) filter (where u.is_anonymous),
    count(*) filter (where not u.is_anonymous),
    count(*) filter (where u.is_anonymous and p.id is not null),
    count(*) filter (where not u.is_anonymous and p.id is not null)
  from auth.users u
  left join public.profiles p on p.id = u.id;
$$;

revoke execute on function admin_user_counts() from public, anon, authenticated;
grant execute on function admin_user_counts() to service_role;

-- 호출·토큰 누적. 전체 / 최근 7일 / 오늘(KST)을 한 번에 돌려준다.
-- 날짜 경계는 서울 기준이다 — 운영자가 "오늘"이라고 말할 때의 오늘이어야 한다.
create or replace function admin_usage_stats()
returns table (
  span          text,
  runs          bigint,
  requested     bigint,
  cached        bigint,
  gate_blocked  bigint,
  ai_called     bigint,
  ai_failed     bigint,
  prompt_tokens bigint,
  output_tokens bigint,
  cache_errors  bigint,
  save_errors   bigint,
  p50_ms        int,
  p95_ms        int
)
language sql
security definer
set search_path = public
as $$
  with spans as (
    select 'all'::text as span, '-infinity'::timestamptz as since
    union all select 'week', now() - interval '7 days'
    union all select 'today', date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
  )
  select
    s.span,
    count(r.id),
    coalesce(sum(r.requested), 0),
    coalesce(sum(r.cached), 0),
    coalesce(sum(r.gate_blocked), 0),
    coalesce(sum(r.ai_called), 0),
    coalesce(sum(r.ai_failed), 0),
    coalesce(sum(r.prompt_tokens), 0),
    coalesce(sum(r.output_tokens), 0),
    count(r.id) filter (where r.cache_error),
    count(r.id) filter (where r.save_error),
    coalesce(percentile_disc(0.5) within group (order by r.duration_ms), 0)::int,
    coalesce(percentile_disc(0.95) within group (order by r.duration_ms), 0)::int
  from spans s
  left join verdict_runs r on r.created_at >= s.since
  group by s.span;
$$;

revoke execute on function admin_usage_stats() from public, anon, authenticated;
grant execute on function admin_usage_stats() to service_role;

-- 사용량 상위 **로그인 사용자**. 익명은 uid가 사람이 아니라 브라우저 한 벌이라(§2.3) 줄 세울 의미가 없다.
-- 이메일은 그대로 내보내지 않는다 — 이 화면의 잠금은 `ADMIN_SLUG` 은닉뿐이라(access.ts),
-- 여기 뜨는 순간 주소를 아는 사람에게 계정 목록이 된다. 본인 사용자를 알아볼 만큼만 남기고 가린다.
create or replace function admin_top_callers(limit_n int default 10)
returns table (
  email_masked  text,
  runs          bigint,
  ai_called     bigint,
  cached        bigint,
  total_tokens  bigint,
  last_at       timestamptz
)
language sql
security definer
set search_path = public, auth
as $$
  select
    -- 첫 글자 + 도메인만 남긴다. `^(.).*(.)@`처럼 앞뒤 두 글자를 남기면 **로컬부가 한 글자인 주소가
    -- 아예 매치되지 않아 원문 그대로 나간다** — 가리기가 조용히 실패하는 쪽이라 이 형태를 쓴다.
    regexp_replace(u.email, '^(.).*@', '\1***@') as email_masked,
    count(r.id),
    coalesce(sum(r.ai_called), 0),
    coalesce(sum(r.cached), 0),
    coalesce(sum(r.prompt_tokens + r.output_tokens), 0),
    max(r.created_at)
  from verdict_runs r
  join auth.users u on u.id = r.requested_by
  where not r.was_anonymous and u.email is not null
  group by u.email
  order by coalesce(sum(r.ai_called), 0) desc, count(r.id) desc
  limit greatest(1, least(limit_n, 50));
$$;

revoke execute on function admin_top_callers(int) from public, anon, authenticated;
grant execute on function admin_top_callers(int) to service_role;
