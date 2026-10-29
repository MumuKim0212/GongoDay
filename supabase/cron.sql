-- 수집·알림·정리 트리거 — Supabase pg_cron + pg_net (ARCHITECTURE §4.3)
--
-- **GitHub Actions에서 옮겨 왔다.** `*/20` 스케줄이 실제로는 3~7시간 간격, 하루 4~5번만 돌았다
-- (`sync_runs` 실측). GitHub는 schedule 이벤트를 부하에 따라 미루거나 버린다. pg_cron은 DB 안에서
-- 분 단위로 정확하게 돈다. 받는 쪽은 그대로 Vercel 라우트다 (`CRON_SECRET` Bearer).
--
-- 다시 실행해도 된다 — `cron.schedule`은 같은 이름이면 덮어쓴다.
--
-- ⚠️ 먼저 Vault에 비밀값을 한 번 넣어야 한다 (값은 Vercel 환경 변수의 CRON_SECRET과 같아야 한다):
--      select vault.create_secret('<CRON_SECRET 값>', 'gongoday_cron_secret');
--    값을 이 파일에 적지 않는다 — 저장소를 여는 순간 누구나 수집을 돌릴 수 있게 된다.
--
-- 시각은 UTC다. 20분마다 두 소스를 1분 간격으로 띄우고, 4분 뒤 알림을 띄운다 — 수집 한 번은 60초
-- 상한 안에서 끝나므로(라우트 `maxDuration`) 알림이 돌 때는 새 정책이 이미 들어와 있다.

create extension if not exists pg_net;

-- pg_net은 비동기다. 요청을 큐에 넣고 바로 돌아오며, 응답은 `net._http_response`에 몇 시간 남는다.
-- 타임아웃 기본값(5초)으로는 60초 걸리는 수집의 응답을 못 받으므로 늘린다.

select cron.schedule('gongoday-sync-youth', '0,20,40 * * * *', $$
  select net.http_post(
    url := 'https://gongoday.vercel.app/api/sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gongoday_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{"source":"youth"}'::jsonb,
    timeout_milliseconds := 90000
  );
$$);

select cron.schedule('gongoday-sync-gov24', '1,21,41 * * * *', $$
  select net.http_post(
    url := 'https://gongoday.vercel.app/api/sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gongoday_cron_secret'),
      'Content-Type', 'application/json'
    ),
    body := '{"source":"gov24"}'::jsonb,
    timeout_milliseconds := 90000
  );
$$);

select cron.schedule('gongoday-notify', '5,25,45 * * * *', $$
  select net.http_post(
    url := 'https://gongoday.vercel.app/api/notify',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gongoday_cron_secret')
    ),
    timeout_milliseconds := 90000
  );
$$);

-- 운영 로그 정리 — 하루 1회, UTC 03:00 (KST 정오). GitHub 시절과 같은 시각이다.
select cron.schedule('gongoday-cleanup', '0 3 * * *', $$
  select net.http_post(
    url := 'https://gongoday.vercel.app/api/cleanup',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'gongoday_cron_secret')
    ),
    timeout_milliseconds := 90000
  );
$$);

-- 확인용:
--   select jobname, schedule, active from cron.job where jobname like 'gongoday-%';
--   select j.jobname, d.status, d.start_time from cron.job_run_details d join cron.job j using (jobid)
--     where j.jobname like 'gongoday-%' order by d.start_time desc limit 20;      -- 작업이 떴는가
--   select id, status_code, left(content, 200), created from net._http_response
--     order by created desc limit 20;                                            -- 라우트가 뭐라고 답했나
