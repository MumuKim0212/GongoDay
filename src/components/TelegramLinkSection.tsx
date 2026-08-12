"use client";

import { useActionState } from "react";

import { setNotifyMinScore, unlinkTelegram, type SaveState } from "@/app/profile/actions";
import { TelegramLinkButton } from "@/components/TelegramLinkButton";

/**
 * 프로필 페이지의 텔레그램 알림 연동 섹션 (ARCHITECTURE §11)
 *
 * **익명 세션에는 이 섹션이 통째로 안 보인다.** 연동은 정식 계정만 되는데(§11.1), 프로필 화면
 * 자체가 로그인을 요구하므로(§9.5) 여기 도달한 시점에는 보통 익명이 아니다.
 *
 * 서버 액션도 같은 조건을 다시 검사한다 (`startTelegramLink`) — 화면이 숨기는 것과 별개다.
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
  if (isAnonymous) return null;

  if (telegramChatId === null) {
    return (
      <Section legend="텔레그램 알림">
        <p className="text-small text-muted mb-3">
          연결하면 내 조건에 맞는 새 공고가 올라올 때 텔레그램으로 알려드립니다.
        </p>
        <TelegramLinkButton />
      </Section>
    );
  }

  return (
    <Section legend="텔레그램 알림">
      <p className="text-small text-muted mb-3">연결되었습니다.</p>

      <MinScoreForm notifyMinScore={notifyMinScore} />
      <UnlinkForm />
    </Section>
  );
}

function MinScoreForm({ notifyMinScore }: { notifyMinScore: number | null }) {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(setNotifyMinScore, null);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
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
      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? "저장 중…" : "저장"}
      </button>
      <span aria-live="polite" className={`text-small ${state?.ok === false ? "text-danger" : "text-muted"}`}>
        {state?.message ?? ""}
      </span>
    </form>
  );
}

function UnlinkForm() {
  const [state, formAction, pending] = useActionState<SaveState, FormData>(unlinkTelegram, null);

  return (
    <form action={formAction} className="mt-3 flex flex-wrap items-center gap-2">
      <button type="submit" disabled={pending} className="btn btn-ghost">
        {pending ? "해제 중…" : "연동 해제"}
      </button>
      <span aria-live="polite" className={`text-small ${state?.ok === false ? "text-danger" : "text-muted"}`}>
        {state?.message ?? ""}
      </span>
    </form>
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
