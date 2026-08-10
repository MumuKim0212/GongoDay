import { setNotifyMinScore, startTelegramLink, unlinkTelegram } from "@/app/profile/actions";

/**
 * 프로필 페이지의 텔레그램 알림 연동 섹션 (ARCHITECTURE §11)
 *
 * 익명 세션에는 연동 버튼 대신 로그인 안내만 보인다 — 서버 액션도 같은 조건을 다시 검사한다
 * (`startTelegramLink`).
 */
export function TelegramLinkSection({
  isAnonymous,
  telegramChatId,
  notifyMinScore,
}: {
  isAnonymous: boolean;
  telegramChatId: string | null;
  notifyMinScore: number | null;
}) {
  if (isAnonymous) {
    return (
      <Section legend="텔레그램 알림">
        <p className="text-small text-muted">
          로그인하면 새 공고를 텔레그램으로 받아볼 수 있습니다.{" "}
          <a href="/login?redirect=/profile" className="text-[var(--accent-ink)] underline">
            로그인하기
          </a>
        </p>
      </Section>
    );
  }

  if (telegramChatId === null) {
    return (
      <Section legend="텔레그램 알림">
        <p className="text-small text-muted mb-3">
          연결하면 내 조건에 맞는 새 공고가 올라올 때 텔레그램으로 알려드립니다.
        </p>
        <form action={startTelegramLink}>
          <button type="submit" className="btn btn-primary">
            텔레그램으로 연결
          </button>
        </form>
      </Section>
    );
  }

  return (
    <Section legend="텔레그램 알림">
      <p className="text-small text-muted mb-3">연결되었습니다.</p>

      <form action={setNotifyMinScore} className="flex flex-wrap items-center gap-2">
        <label className="text-sub" htmlFor="min_score">
          알림 받을 최소 점수
        </label>
        <select
          id="min_score"
          name="min_score"
          defaultValue={notifyMinScore ?? ""}
          className="input w-auto"
        >
          <option value="">알림 끔</option>
          <option value="5">5점 (신청 가능)만</option>
          <option value="4">4점 이상</option>
          <option value="3">3점 이상</option>
          <option value="2">2점 이상</option>
          <option value="1">1점 이상 (전부)</option>
        </select>
        <button type="submit" className="btn btn-primary">
          저장
        </button>
      </form>

      <form action={unlinkTelegram} className="mt-3">
        <button type="submit" className="btn btn-ghost">
          연동 해제
        </button>
      </form>
    </Section>
  );
}

function Section({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="mt-7">
      <legend className="text-sub">{legend}</legend>
      <div className="mt-2">{children}</div>
    </fieldset>
  );
}
