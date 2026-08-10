import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTabs } from "@/components/AdminTabs";
import { SyncButton } from "@/components/SyncButton";
import { isAdminAllowed, isAdminLocked } from "@/lib/admin/access";
import {
  PRICE_PER_1M,
  SOURCE_LABELS,
  envStatus,
  fetchAdminStats,
  type AdminStats,
  type Num,
  type SyncStatus,
} from "@/lib/admin/stats";
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
  // 시계는 한 번만 읽어 '기준 시각'으로 아래에 넘긴다 — 머리글에 적히는 시각과 수집 카드의
  // 경과 판정이 같은 시계를 쓰게 된다. (`Date.now()`는 react-hooks/purity에 걸린다)
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">오늘공고 · 운영 현황</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {time(now.toISOString())} 기준
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
        {locked ? null : (
          <>
            {" "}
            <code>ADMIN_SLUG</code>가 비어 있어 <strong>주소를 아는 누구나</strong> 열 수 있습니다. 잠그려면 그 값을
            넣고 <code>/admin/&lt;값&gt;</code>으로 들어오세요.
          </>
        )}
      </p>

      <AdminTabs
        tabs={[
          {
            key: "sync",
            label: "수집 · 서버",
            content: (
              <Section title="수집 · 서버">
                {stats ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {stats.sync.map((s) => (
                      <SyncCard key={s.source} status={s} nowMs={now.getTime()} />
                    ))}
                  </div>
                ) : (
                  <Note>
                    <code>SUPABASE_SERVICE_ROLE_KEY</code>가 없어 집계를 읽을 수 없습니다.
                  </Note>
                )}

                {/* 버튼이 자기가 바꾸는 상태(위의 '이어받을 페이지') 바로 옆에 있다 */}
                <div className="mt-3">
                  <SyncButton slug={slug} />
                  <p className="mt-1 text-xs text-gray-500">
                    평소 수집은 <strong>매시간 GitHub Actions</strong>가 돌립니다(
                    <code>.github/workflows/sync.yml</code>). 한 번에 10페이지씩이라 온통청년은 3시간, 정부24는
                    11시간에 한 바퀴입니다 — 이 버튼은 <strong>지금 당장</strong> 한 바퀴 더 돌릴 때만 쓰고, 그냥
                    두면 크론이 마저 받아갑니다.
                  </p>
                </div>

                <h3 className="mt-4 text-sm font-medium">환경 변수</h3>
                <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                  {env.map((e) => (
                    <li key={e.key} className="flex items-center gap-2">
                      <span
                        className={e.set ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}
                      >
                        {e.set ? "설정됨" : "없음"}
                      </span>
                      <code className="text-xs break-all">{e.key}</code>
                      {e.server ? <span className="text-xs text-gray-400">서버 전용</span> : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-xs text-gray-500">값은 표시하지 않습니다. 설정 여부만 봅니다.</p>
              </Section>
            ),
          },
          {
            key: "policies",
            label: "공고",
            content: (
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
                      목록 정렬 기준은 <code>source_registered_at</code>입니다 — <code>fetched_at</code>은 갱신마다
                      바뀝니다.
                    </p>
                  </>
                ) : (
                  <Note>집계를 읽을 수 없습니다.</Note>
                )}
              </Section>
            ),
          },
          ...(stats
            ? [
                {
                  key: "users",
                  label: "사용자",
                  content: <UsersSection users={stats.users} scraps={stats.scraps} />,
                },
                {
                  key: "usage",
                  label: "호출 · 비용",
                  content: <UsageSection usage={stats.usage} verdicts={stats.verdicts} />,
                },
                {
                  key: "categories",
                  label: "분류",
                  content: (
                    <Section title="분류">
                      <h3 className="text-sm font-medium">분야</h3>
                      <Bars
                        rows={stats.categories.map((c) => ({ ...c, hint: pct(c.count, stats.policies.total) }))}
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        한 정책이 여러 분야에 들어가므로 합이 전체보다 큽니다. <code>기타</code>가 커지면 분야
                        매핑에 빠진 값이 생긴 것입니다.
                      </p>

                      <h3 className="mt-5 text-sm font-medium">지역</h3>
                      <Bars rows={stats.regions.map((r) => ({ ...r, hint: pct(r.count, stats.policies.total) }))} />
                      <p className="mt-1 text-xs text-gray-500">
                        &lsquo;전국&rsquo;은 두 종류입니다. 중앙행정기관은 실제로 전국이고,{" "}
                        <strong>지역 판별 실패</strong>는 기관명에서 지역을 못 찾아 전국으로 떨어진 건입니다 —
                        숨기지 않으려고 통과시킨 것이라 수도권 목록에 타 지역이 섞이는 원인입니다.
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
                  ),
                },
                {
                  key: "verdicts",
                  label: "AI 판정",
                  content: (
                    <Section title="AI 판정">
                      {stats.verdicts.total === 0 ? (
                        <Note>저장된 판정이 없습니다. 판정 API(작업 6)가 붙으면 여기부터 채워집니다.</Note>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                            <Stat label="판정 건수" value={fmt(stats.verdicts.total)} />
                            <Stat label="AI가 답한 건" value={fmt(stats.verdicts.ai)} />
                            {/* 분모는 AI 판정 수다. quote가 남은 건수로 나누면 늘 100%가 나온다 (stats.ts 주석) */}
                            <Stat
                              label="인용 검증 통과"
                              value={fmt(stats.verdicts.quoteVerified)}
                              hint={pct(stats.verdicts.quoteVerified, stats.verdicts.ai) ?? undefined}
                            />
                            <Stat label="마지막 판정" value={time(stats.verdicts.latestAt)} />
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            인용 검증을 통과하지 못한 AI 판정{" "}
                            <strong>{fmt(diff(stats.verdicts.ai, stats.verdicts.quoteVerified))}건</strong>은{" "}
                            <code>애매</code>로 강등되고, 상세 화면에 &ldquo;근거를 원문에서 찾지 못했습니다&rdquo;로
                            표시됩니다. 이 수가 늘면 프롬프트나 모델을 다시 봐야 합니다. 코드 게이트 판정에는 인용이
                            없습니다.
                          </p>

                          <h3 className="mt-5 text-sm font-medium">점수 분포</h3>
                          <Bars
                            rows={stats.verdicts.scores.map((s) => ({
                              ...s,
                              hint: pct(s.count, stats.verdicts.scoreSample),
                            }))}
                          />
                          <p className="mt-1 text-xs text-gray-500">
                            점수는 저장하지 않고 <code>checks</code> 길이에서 유도합니다(§5.6). 그래서 집계
                            쿼리로 세지 못하고 판정 {fmt(stats.verdicts.scoreSample)}건을 받아서 셌습니다
                            {(stats.verdicts.scoreSample ?? 0) < (stats.verdicts.total ?? 0)
                              ? " — 전체보다 적으면 표본 상한에서 잘린 것입니다."
                              : " (전수)."}{" "}
                            프롬프트를 바꾸기 전에 저장된 판정은 <code>checks</code>가 비어 2점으로 잡힙니다.
                          </p>

                          <h3 className="mt-5 text-sm font-medium">결과 분포</h3>
                          <Bars
                            rows={stats.verdicts.byVerdict.map((v) => ({
                              ...v,
                              hint: pct(v.count, stats.verdicts.total),
                            }))}
                          />
                          <p className="mt-1 text-xs text-gray-500">
                            <code>아님</code>인데 <code>blockers</code>가 빈 판정{" "}
                            <strong>{fmt(stats.verdicts.ineligibleNoBlockers)}건</strong> — 그 카드에 남는 설명은
                            한 줄짜리 <code>reason</code>뿐입니다. 숨기지 않는 대신 왜 아닌지를 말해주기로 한
                            약속이라(PRD §7.5) 이 수는 0에 가까워야 합니다.
                          </p>

                          <h3 className="mt-5 text-sm font-medium">누가 판정했나</h3>
                          <Bars
                            rows={stats.verdicts.byDecider.map((d) => ({
                              ...d,
                              hint: pct(d.count, stats.verdicts.total),
                            }))}
                          />
                          <p className="mt-1 text-xs text-gray-500">
                            코드 게이트가 처리한 몫이 클수록 Gemini 호출이 적습니다. 호출 자체가 실패한 판정은
                            저장하지 않으므로 (다시 누르면 재시도됩니다) 여기 수치에는 잡히지 않습니다.
                          </p>
                        </>
                      )}
                    </Section>
                  ),
                },
              ]
            : []),
        ]}
      />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────
// 표시 조각
// ─────────────────────────────────────────────────────────────

type BarRow = { label: string; count: Num; hint?: string | null };

/**
 * 사용자 3단계 + 스크랩.
 *
 * **'전체 세션'을 사용자 수라고 부르지 않는다.** `proxy.ts`가 쿠키 없는 화면 요청마다 익명 세션을
 * 만들어서 크롤러 방문이 그대로 섞이기 때문이다. 세 칸을 나란히 두는 것 자체가 그 누수의 감지기다.
 */
function UsersSection({
  users,
  scraps,
}: {
  users: AdminStats["users"];
  scraps: AdminStats["scraps"];
}) {
  const profiled = sum(users.anonProfiled, users.identifiedProfiled);

  return (
    <Section title="사용자">
      {users.total === null ? (
        <Note>
          <code>admin_user_counts()</code>를 읽지 못했습니다. <code>supabase/schema.sql</code>의 운영 집계 함수를
          올렸는지 확인하세요 — <code>auth.users</code>는 PostgREST로 직접 읽을 수 없어 이 함수가 필요합니다.
        </Note>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="전체 세션" value={fmt(users.total)} />
            <Stat label="조건 등록" value={fmt(profiled)} hint={pct(profiled, users.total) ?? undefined} />
            <Stat
              label="익명 · 조건 등록"
              value={fmt(users.anonProfiled)}
              hint={pct(users.anonProfiled, users.anon) ?? undefined}
            />
            <Stat
              label="로그인 계정"
              value={fmt(users.identified)}
              hint={
                users.identifiedProfiled === null ? undefined : `조건 ${fmt(users.identifiedProfiled)}`
              }
            />
          </div>

          <p className="mt-2 text-xs text-gray-500">
            <strong>&lsquo;전체 세션&rsquo;은 사람 수가 아닙니다.</strong> 첫 방문마다 익명 세션이 하나씩
            생기므로(<code>proxy.ts</code>) 크롤러가 훑은 것도 여기 들어옵니다. 그래서 옆 칸들과 같이 봐야
            합니다 — <strong>전체 세션만 늘고 조건 등록이 안 움직이면 사람이 아니라 봇입니다.</strong>
          </p>
          <p className="mt-1 text-xs text-gray-500">
            로그인은 익명 세션을 승격시키지 않고 <strong>별도 계정</strong>을 만듭니다(<code>login/actions.ts</code>)
            — 같은 사람이 익명과 로그인 양쪽에 한 번씩 잡힐 수 있어 두 칸의 합은 사람 수보다 큽니다.
          </p>

          <h3 className="mt-5 text-sm font-medium">스크랩</h3>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="총 스크랩" value={fmt(scraps.total)} />
            <Stat label="스크랩한 사용자" value={fmt(scraps.users)} />
            <Stat label="담긴 정책 종류" value={fmt(scraps.policies)} />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            사용자가 <strong>스스로 한 유일한 행동</strong>이라 참여도를 이 수로 봅니다. 총 건수만 전수이고 나머지
            둘은 {fmt(scraps.sampled)}건 표본에서 셌습니다
            {(scraps.sampled ?? 0) < (scraps.total ?? 0) ? " — 전체보다 적으면 표본 상한에서 잘린 것입니다." : "."}{" "}
            누가 무엇을 담았는지는 읽지 않습니다.
          </p>
        </>
      )}
    </Section>
  );
}

/**
 * 호출·토큰 장부 (`verdict_runs`, §2.7).
 *
 * **`verdicts` 행 수와 다른 것을 세고 있다.** 저 표는 남은 판정이고 이 표는 실제로 나간 호출이다 —
 * 실패분·재판정·캐시 적중이 셋 다 저기서는 안 보인다.
 */
function UsageSection({ usage, verdicts }: { usage: AdminStats["usage"]; verdicts: AdminStats["verdicts"] }) {
  const a = usage.all;
  // 호출하지 않고 답한 몫. 캐시 + 게이트가 요청 대비 얼마나 막아줬는지가 비용 설계의 성적표다 (PRD §7.7)
  const avoided = sum(a.cached, a.gateBlocked);
  const tokens = sum(a.promptTokens, a.outputTokens);
  const cost = estimateCost(a.promptTokens, a.outputTokens);

  if (a.runs === null) {
    return (
      <Section title="호출 · 비용">
        <Note>
          <code>admin_usage_stats()</code>를 읽지 못했습니다. <code>supabase/schema.sql</code>의{" "}
          <code>verdict_runs</code>와 운영 집계 함수를 올렸는지 확인하세요.
        </Note>
      </Section>
    );
  }

  return (
    <Section title="호출 · 비용">
      {a.runs === 0 ? (
        <Note>
          아직 기록된 판정 요청이 없습니다. <code>verdict_runs</code>는 목록에서 자동 판정이 한 번 돌면 그때부터
          쌓입니다 — 이 테이블을 올리기 전의 호출은 여기 잡히지 않습니다.
        </Note>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Gemini 호출" value={fmt(a.aiCalled)} />
            <Stat label="호출 없이 답함" value={fmt(avoided)} hint={pct(avoided, a.requested) ?? undefined} />
            <Stat label="토큰 합계" value={fmt(tokens)} />
            <Stat label="추정 비용" value={cost} />
          </div>
          <p className="mt-2 text-xs text-gray-500">
            <strong>비용은 호출 수가 아니라 토큰으로 매겨집니다.</strong> 토큰은 Gemini 응답의{" "}
            <code>usageMetadata</code>를 그대로 합한 값이라 사실이지만,{" "}
            {PRICE_PER_1M.input === 0 ? (
              <>
                <strong>단가는 아직 넣지 않았습니다</strong> — <code>lib/admin/stats.ts</code>의{" "}
                <code>PRICE_PER_1M</code>에 콘솔에서 확인한 실제 단가를 채우면 금액이 계산됩니다. 지어낸 단가로 만든
                금액은 사실인 척하는 거짓말이라 비워 두었습니다.
              </>
            ) : (
              <>
                단가는 <code>PRICE_PER_1M</code>에 손으로 넣은 값입니다({PRICE_PER_1M.checkedOn} 확인). 실제 청구서와
                다르면 그 상수부터 봅니다.
              </>
            )}
          </p>

          <h3 className="mt-5 text-sm font-medium">요청 한 배치가 어디로 갔나 (누적)</h3>
          <Bars
            rows={[
              { label: "캐시로 답함", count: a.cached, hint: pct(a.cached, a.requested) },
              { label: "코드 게이트가 답함", count: a.gateBlocked, hint: pct(a.gateBlocked, a.requested) },
              { label: "Gemini 호출", count: a.aiCalled, hint: pct(a.aiCalled, a.requested) },
              { label: "└ 그중 실패", count: a.aiFailed, hint: pct(a.aiFailed, a.aiCalled) },
            ]}
          />
          <p className="mt-1 text-xs text-gray-500">
            분모는 요청된 판정 {fmt(a.requested)}건입니다. <strong>캐시 적중률이 곧 조건별 공유 캐시의 성적표고</strong>
            (ARCHITECTURE §2.3의 &lsquo;61%가 중복&rsquo;이 배포본에서도 유효한지가 여기서 보입니다), 실패는{" "}
            <code>verdicts</code>에 저장되지 않아 판정 탭에서는 보이지 않습니다.
          </p>

          <h3 className="mt-5 text-sm font-medium">기간별</h3>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-800">
                  <th className="py-1 font-medium">기간</th>
                  <th className="py-1 text-right font-medium">요청</th>
                  <th className="py-1 text-right font-medium">호출</th>
                  <th className="py-1 text-right font-medium">실패</th>
                  <th className="py-1 text-right font-medium">토큰</th>
                  <th className="py-1 text-right font-medium">비용</th>
                  <th className="py-1 text-right font-medium">p95</th>
                </tr>
              </thead>
              <tbody>
                {(
                  [
                    ["오늘", usage.today],
                    ["최근 7일", usage.week],
                    ["누적", usage.all],
                  ] as const
                ).map(([label, s]) => (
                  <tr key={label} className="border-b border-gray-100 dark:border-gray-900">
                    <td className="py-1.5">{label}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(s.requested)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(s.aiCalled)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(s.aiFailed)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(sum(s.promptTokens, s.outputTokens))}</td>
                    <td className="py-1.5 text-right tabular-nums">{estimateCost(s.promptTokens, s.outputTokens)}</td>
                    <td className="py-1.5 text-right tabular-nums">{s.p95Ms === null ? "—" : `${s.p95Ms}ms`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            &lsquo;오늘&rsquo;은 서울 기준입니다. p95는 배치 한 번이 끝나기까지 걸린 시간이고, 라우트 상한 60초에
            가까워지면 병렬 수나 <code>TIMEOUT_MS</code>를 봐야 합니다.
          </p>

          {(a.cacheErrors ?? 0) > 0 ? (
            <p className="mt-3 rounded bg-red-50 p-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
              캐시 조회가 <strong>{fmt(a.cacheErrors)}번</strong> 실패했습니다. 그 요청은 캐시가 빈 것으로
              취급되어 <strong>게이트 통과분이 전건 재호출됩니다</strong> — 사용자에게는 정상으로 보이고 화면에는
              흔적이 없어서, 비용이 튀는데 이유를 모르는 경로가 이것입니다.
            </p>
          ) : null}

          <h3 className="mt-5 text-sm font-medium">서명 다양성</h3>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="서로 다른 조건 조합" value={fmt(verdicts.signatures)} />
            <Stat label="저장된 판정 (표본)" value={fmt(verdicts.scoreSample)} />
            <Stat
              label="서명당 판정"
              value={ratio(verdicts.scoreSample, verdicts.signatures)}
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">
            캐시가 듣는 정도는 사용자 수보다 <strong>서명 종류 수</strong>가 설명합니다 — 캐시 키가 사용자가 아니라
            조건이기 때문입니다(§2.3). <strong>서명당 판정이 클수록 한 번 판정한 것을 여러 번 재사용하고 있다는
            뜻이고</strong>, 1에 가까우면 조건이 사람마다 달라 캐시가 거의 안 듣는 상태입니다.
          </p>

          {usage.topCallers.length > 0 ? (
            <>
              <h3 className="mt-5 text-sm font-medium">사용량 상위 — 로그인 계정</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[30rem] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500 dark:border-gray-800">
                      <th className="py-1 font-medium">계정</th>
                      <th className="py-1 text-right font-medium">호출</th>
                      <th className="py-1 text-right font-medium">캐시</th>
                      <th className="py-1 text-right font-medium">토큰</th>
                      <th className="py-1 text-right font-medium">마지막</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.topCallers.map((c) => (
                      <tr key={c.emailMasked} className="border-b border-gray-100 dark:border-gray-900">
                        <td className="py-1.5 font-mono text-xs">{c.emailMasked}</td>
                        <td className="py-1.5 text-right tabular-nums">{c.aiCalled.toLocaleString("ko-KR")}</td>
                        <td className="py-1.5 text-right tabular-nums">{c.cached.toLocaleString("ko-KR")}</td>
                        <td className="py-1.5 text-right tabular-nums">{c.totalTokens.toLocaleString("ko-KR")}</td>
                        <td className="py-1.5 text-right tabular-nums">{time(c.lastAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                <strong>익명 세션은 줄 세우지 않습니다</strong> — uid가 사람이 아니라 브라우저 한 벌이라(§2.3) 순위가
                의미를 갖지 못합니다. 이메일은 가려서 표시합니다: 이 화면의 잠금은 <code>ADMIN_SLUG</code> 은닉뿐이라
                그대로 띄우면 주소를 아는 사람에게 계정 목록이 됩니다. <strong>&lsquo;캐시&rsquo;는 이 계정이 캐시로
                답받은 몫이라 값이 나가지 않은 부분입니다</strong> — 사용량 제한을 걸 때 세야 하는 것은 호출 쪽입니다.
              </p>
            </>
          ) : null}
        </>
      )}
    </Section>
  );
}

/**
 * 끝나지 않은 실행을 '진행 중'으로 볼 상한. `api/sync/route.ts`의 `maxDuration`이 60초이므로
 * 그보다 오래 `finished_at`이 비어 있으면 돌고 있는 게 아니라 죽은 것이다. 시계 오차를 감안해 넉넉히 잡는다.
 */
const RUNNING_GRACE_MS = 15 * 60 * 1000;

function SyncCard({ status: s, nowMs }: { status: SyncStatus; nowMs: number }) {
  // ⚠️ **`finished_at`을 봐야 한다.** 행은 시작할 때 만들어지고 끝날 때 갱신되므로(`sync/run.ts`),
  // 함수가 중간에 죽으면 `error`도 `finished_at`도 없는 행이 남는다. 예전에는 그 상태가
  // 초록색 '완료'로 떨어졌다 — 수집이 멈췄는데 화면은 멀쩡하다고 말하던 자리다.
  const unfinished = s.runCount > 0 && !s.error && s.finishedAt === null;
  const sinceStart = s.startedAt ? nowMs - new Date(s.startedAt).getTime() : null;
  const running = unfinished && sinceStart !== null && sinceStart < RUNNING_GRACE_MS;

  const state =
    s.runCount === 0
      ? { label: "실행 기록 없음", tone: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" }
      : s.error
        ? { label: "실패", tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" }
        : running
          ? { label: "진행 중", tone: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200" }
          : unfinished
            ? { label: "끝나지 않음 — 실행이 죽었다", tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" }
            : s.lastPage && s.lastPage > 0
              ? {
                  label: "중단 — 이어받기 대기",
                  tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
                }
              : { label: "완료", tone: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" };

  return (
    <div className="rounded border border-gray-200 p-3 dark:border-gray-800">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{SOURCE_LABELS[s.source] ?? s.source}</span>
        <span className={`rounded px-2 py-0.5 text-xs ${state.tone}`}>{state.label}</span>
      </div>

      <dl className="mt-2 space-y-1 text-sm">
        {/* 사용자 화면 푸터가 두 소스 중 나중 것 하나만 보여준다 — 소스별 내역은 여기가 유일하다 */}
        <Field label="마지막 전량 갱신" value={time(s.lastFullAt)} />
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

      {unfinished && !running ? (
        <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-900 dark:bg-red-950 dark:text-red-200">
          시작만 하고 끝나지도 실패하지도 않았습니다 — 함수가 타임아웃되거나 죽으면 이 모양으로 남습니다.{" "}
          <code>last_page</code>는 그대로라 다음 실행이 그 자리에서 이어받습니다.
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

/** 한쪽이라도 못 읽었으면 뺄셈 결과도 모르는 값이다. */
function diff(a: Num, b: Num): Num {
  return a === null || b === null ? null : a - b;
}

/** 덧셈도 같다 — 한쪽이 `null`이면 합계도 모르는 값이다. 0으로 때우면 "적게 썼다"로 읽힌다. */
function sum(a: Num, b: Num): Num {
  return a === null || b === null ? null : a + b;
}

/** 배수 (예: 서명당 판정 4.2배). 분모가 0이면 나눌 수 없다. */
function ratio(v: Num, base: Num): string {
  if (v === null || base === null || base === 0) return "—";
  return `${(v / base).toFixed(1)}배`;
}

/**
 * 추정 비용. **단가가 0이면 계산하지 않고 그렇게 말한다** — 틀린 금액은 모르는 것보다 나쁘다.
 * 토큰은 API가 준 사실이고 단가는 사람이 손으로 넣은 값이라, 둘을 섞은 결과에는 항상 '추정'이 붙는다.
 */
function estimateCost(promptTokens: Num, outputTokens: Num): string {
  if (PRICE_PER_1M.input === 0 && PRICE_PER_1M.output === 0) return "단가 미설정";
  if (promptTokens === null || outputTokens === null) return "—";

  const usd = (promptTokens / 1_000_000) * PRICE_PER_1M.input + (outputTokens / 1_000_000) * PRICE_PER_1M.output;
  return `$${usd.toFixed(usd < 1 ? 4 : 2)}`;
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
