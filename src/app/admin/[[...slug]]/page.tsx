import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isAdminAllowed, isAdminLocked } from "@/lib/admin/access";
import { SOURCE_LABELS, envStatus, fetchAdminStats, type Num, type SyncStatus } from "@/lib/admin/stats";
import { createAdminClient } from "@/lib/supabase/admin";

/** 운영 화면이라 캐시하지 않는다 — 캐시된 수치는 여기서 거짓말이 된다. */
export const dynamic = "force-dynamic";

/** 주소가 새더라도 검색 결과에는 남지 않게 한다 (배포에서 잠금이 은닉뿐이므로). */
export const metadata: Metadata = {
  title: "오늘공고 · 운영 현황",
  robots: { index: false, follow: false },
};

export default async function AdminPage({ params }: PageProps<"/admin/[[...slug]]">) {
  const { slug } = await params;
  // 통과하지 못하면 404다 — "권한 없음"이라고 알려주면 경로가 있다는 것을 알려주는 셈이다.
  if (!isAdminAllowed(slug)) notFound();

  const locked = isAdminLocked();
  const env = envStatus();
  const hasServiceRole = env.some((e) => e.key === "SUPABASE_SERVICE_ROLE_KEY" && e.set);
  // 집계는 RLS를 우회해야 읽힌다 (`verdicts`는 본인 행만 공개). 키가 없으면 환경 블록만 보여준다.
  const stats = hasServiceRole ? await fetchAdminStats(createAdminClient()) : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">오늘공고 · 운영 현황</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {time(new Date().toISOString())} 기준
            {stats ? ` · 집계 ${stats.dbMs}ms` : ""}
          </p>
        </div>
        {/* 잠금 상태를 화면이 사실대로 말한다 — 잠긴 줄 알고 있는데 열려 있는 상태가 제일 나쁘다 */}
        <span
          className={`rounded px-2 py-1 text-xs ${
            locked
              ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
              : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          {locked ? "ADMIN_SLUG로 잠김" : "잠금 없음 · 주소만 알면 열림"}
        </span>
      </header>

      <p className="mt-3 rounded bg-gray-50 p-3 text-xs text-gray-600 dark:bg-gray-900 dark:text-gray-400">
        이 화면은 <strong>집계 건수만</strong> 읽습니다 — 개별 사용자의 프로필·판정 내용은 조회하지 않습니다.
        {locked ? (
          <>
            {" "}
            지금은 <code>/admin/&lt;ADMIN_SLUG&gt;</code> 한 경로만 열리고 그 외에는 404입니다.
          </>
        ) : (
          <>
            {" "}
            <code>ADMIN_SLUG</code>가 비어 있어 <strong>주소를 아는 누구나</strong> 열 수 있습니다. 잠그려면 그 값을
            넣고 <code>/admin/&lt;값&gt;</code>으로 들어오세요.
          </>
        )}
      </p>

      {/* ── 수집 · 서버 ────────────────────────────── */}
      <Section title="수집 · 서버">
        {stats ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {stats.sync.map((s) => (
              <SyncCard key={s.source} status={s} />
            ))}
          </div>
        ) : (
          <Note>
            <code>SUPABASE_SERVICE_ROLE_KEY</code>가 없어 집계를 읽을 수 없습니다.
          </Note>
        )}

        <h3 className="mt-4 text-sm font-medium">환경 변수</h3>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {env.map((e) => (
            <li key={e.key} className="flex items-center gap-2">
              <span className={e.set ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}>
                {e.set ? "설정됨" : "없음"}
              </span>
              <code className="text-xs break-all">{e.key}</code>
              {e.server ? <span className="text-xs text-gray-400">서버 전용</span> : null}
            </li>
          ))}
        </ul>
        <p className="mt-1 text-xs text-gray-500">값은 표시하지 않습니다. 설정 여부만 봅니다.</p>
      </Section>

      {/* ── 공고 ──────────────────────────────────── */}
      <Section title="공고">
        {stats ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="전체" value={fmt(stats.policies.total)} />
              <Stat label="온통청년" value={fmt(stats.policies.youth)} />
              <Stat label="정부24" value={fmt(stats.policies.gov24)} />
              <Stat label="최신 등록일" value={day(stats.policies.latestRegisteredAt)} />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              목록 정렬 기준은 <code>source_registered_at</code>입니다 — <code>fetched_at</code>은 갱신마다 바뀝니다.
            </p>
          </>
        ) : (
          <Note>집계를 읽을 수 없습니다.</Note>
        )}
      </Section>

      {/* ── 분류 ──────────────────────────────────── */}
      {stats ? (
        <Section title="분류">
          <h3 className="text-sm font-medium">분야</h3>
          <Bars rows={stats.categories.map((c) => ({ ...c, hint: pct(c.count, stats.policies.total) }))} />
          <p className="mt-1 text-xs text-gray-500">
            한 정책이 여러 분야에 들어가므로 합이 전체보다 큽니다. <code>기타</code>가 커지면 분야 매핑에 빠진 값이
            생긴 것입니다.
          </p>

          <h3 className="mt-5 text-sm font-medium">지역</h3>
          <Bars rows={stats.regions.map((r) => ({ ...r, hint: pct(r.count, stats.policies.total) }))} />
          <p className="mt-1 text-xs text-gray-500">
            &lsquo;전국&rsquo;은 두 종류입니다. 중앙행정기관은 실제로 전국이고,{" "}
            <strong>지역 판별 실패</strong>는 기관명에서 지역을 못 찾아 전국으로 떨어진 건입니다 — 숨기지 않으려고
            통과시킨 것이라 수도권 목록에 타 지역이 섞이는 원인입니다.
          </p>

          <h3 className="mt-5 text-sm font-medium">판정 입력 텍스트 채움률</h3>
          <Bars
            rows={stats.fill.map((f) => ({
              label: f.label,
              count: f.count,
              hint: pct(f.count, f.base === "youth" ? stats.policies.youth : stats.policies.total),
            }))}
          />
        </Section>
      ) : null}

      {/* ── AI 판정 ───────────────────────────────── */}
      {stats ? (
        <Section title="AI 판정">
          {stats.verdicts.total === 0 ? (
            <Note>저장된 판정이 없습니다. 판정 API(작업 6)가 붙으면 여기부터 채워집니다.</Note>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="판정 건수" value={fmt(stats.verdicts.total)} />
                <Stat label="인용 붙음" value={fmt(stats.verdicts.quoted)} />
                <Stat
                  label="인용 검증 통과"
                  value={fmt(stats.verdicts.quoteVerified)}
                  hint={pct(stats.verdicts.quoteVerified, stats.verdicts.quoted) ?? undefined}
                />
                <Stat label="마지막 판정" value={time(stats.verdicts.latestAt)} />
              </div>

              <h3 className="mt-5 text-sm font-medium">결과 분포</h3>
              <Bars rows={stats.verdicts.byVerdict.map((v) => ({ ...v, hint: pct(v.count, stats.verdicts.total) }))} />

              <h3 className="mt-5 text-sm font-medium">누가 판정했나</h3>
              <Bars rows={stats.verdicts.byDecider.map((d) => ({ ...d, hint: pct(d.count, stats.verdicts.total) }))} />
              <p className="mt-1 text-xs text-gray-500">
                코드 게이트가 처리한 몫이 클수록 Gemini 호출이 적습니다. 인용 검증을 통과하지 못한 판정은{" "}
                <code>애매</code>로 강등되므로, 검증 통과율이 낮아지면 프롬프트나 모델을 다시 봐야 합니다.
              </p>
            </>
          )}
        </Section>
      ) : null}
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// 표시 조각
// ─────────────────────────────────────────────────────────────

type BarRow = { label: string; count: Num; hint?: string | null };

function SyncCard({ status: s }: { status: SyncStatus }) {
  const state =
    s.runCount === 0
      ? { label: "실행 기록 없음", tone: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" }
      : s.error
        ? { label: "실패", tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" }
        : s.lastPage && s.lastPage > 0
          ? { label: "중단 — 이어받기 대기", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" }
          : { label: "완료", tone: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" };

  return (
    <div className="rounded border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{SOURCE_LABELS[s.source] ?? s.source}</span>
        <span className={`rounded px-2 py-0.5 text-xs ${state.tone}`}>{state.label}</span>
      </div>

      <dl className="mt-2 space-y-1 text-sm">
        <Field label="마지막 성공" value={time(s.lastSuccessAt)} />
        <Field label="마지막 실행" value={time(s.startedAt ?? null)} />
        {/* 수집은 한 번에 10페이지씩 끊어 돌므로 전체 건수가 아니라 '그 실행이 처리한 양'이다 */}
        <Field
          label="그 실행의 받음 / 저장"
          value={`${s.fetched.toLocaleString("ko-KR")} / ${s.upserted.toLocaleString("ko-KR")}`}
        />
        <Field label="이어받을 페이지" value={s.lastPage && s.lastPage > 0 ? String(s.lastPage + 1) : "처음부터"} />
        <Field label="실행 기록" value={`${s.runCount}건`} />
      </dl>

      {s.error ? (
        <p className="mt-2 rounded bg-red-50 p-2 text-xs break-all text-red-900 dark:bg-red-950 dark:text-red-200">
          {s.error}
        </p>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="border-b border-gray-200 pb-1 text-lg font-semibold dark:border-gray-800">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-gray-200 p-3 dark:border-gray-800">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">
        {value}
        {hint ? <span className="ml-1 text-xs font-normal text-gray-500">{hint}</span> : null}
      </dd>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-gray-500">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Bars({ rows }: { rows: BarRow[] }) {
  // 막대는 그룹 안에서 상대적이다. 절대 비율은 옆의 % 숫자가 말한다.
  const max = Math.max(1, ...rows.map((r) => r.count ?? 0));

  return (
    <ul className="mt-2 space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[10rem_1fr_5.5rem] items-center gap-3 text-sm">
          <span className="truncate text-gray-600 dark:text-gray-400" title={r.label}>
            {r.label}
          </span>
          <span className="block h-2 rounded bg-gray-100 dark:bg-gray-800">
            <span
              className="block h-2 rounded bg-gray-900 dark:bg-gray-200"
              style={{ width: `${((r.count ?? 0) / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums">
            {fmt(r.count)}
            {r.hint ? <span className="ml-1 text-xs text-gray-400">{r.hint}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="rounded bg-gray-50 p-3 text-sm text-gray-600 dark:bg-gray-900 dark:text-gray-400">{children}</p>;
}

/** 조회 실패는 `—`다. **0으로 적으면 "없다"로 읽힌다.** */
function fmt(v: Num): string {
  return v === null ? "—" : v.toLocaleString("ko-KR");
}

function pct(v: Num, base: Num): string | null {
  if (v === null || base === null || base === 0) return null;
  return `${((v / base) * 100).toFixed(1)}%`;
}

/** 서버 시간대는 UTC다. 운영 화면에서 시각이 9시간 어긋나면 곧바로 오판으로 이어진다. */
function time(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  });
}

function day(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ko-KR", { dateStyle: "short", timeZone: "Asia/Seoul" });
}
