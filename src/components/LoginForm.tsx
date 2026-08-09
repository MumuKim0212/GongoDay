"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { sendLoginCode, verifyLoginCode, type SendState, type VerifyState } from "@/app/login/actions";

/**
 * 이메일 OTP 2단계 폼: 이메일 → 코드 발송 → 코드 입력 → 검증.
 *
 * `key`로 감싼 이유는 "이메일 다시 입력"이다 — `useActionState`는 외부에서 리셋할 방법이
 * 없으므로, 처음부터 다시 시작하려면 내부 컴포넌트를 통째로 리마운트해야 이전 `sendState`가
 * 새 시도에 남지 않는다.
 */
export function LoginForm({ redirectTo }: { redirectTo: string }) {
  const [attempt, setAttempt] = useState(0);
  return <LoginFormInner key={attempt} redirectTo={redirectTo} onRestart={() => setAttempt((n) => n + 1)} />;
}

function LoginFormInner({
  redirectTo,
  onRestart,
}: {
  redirectTo: string;
  onRestart: () => void;
}) {
  const router = useRouter();
  const [sendState, sendAction, sending] = useActionState<SendState, FormData>(sendLoginCode, null);
  const [verifyState, verifyAction, verifying] = useActionState<VerifyState, FormData>(
    verifyLoginCode,
    null,
  );
  const [email, setEmail] = useState("");
  const codeSent = sendState?.ok === true;

  useEffect(() => {
    if (verifyState?.ok === true) {
      router.push(redirectTo);
      router.refresh();
    }
  }, [verifyState, router, redirectTo]);

  if (!codeSent) {
    return (
      <form action={sendAction} className="mt-6 space-y-3">
        <label className="text-sub block">
          이메일
          <input
            type="email"
            name="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input mt-2 w-full"
            placeholder="you@example.com"
          />
        </label>
        <button type="submit" disabled={sending} className="btn btn-primary">
          {sending ? "보내는 중…" : "코드 받기"}
        </button>
        <p aria-live="polite" className={`text-small ${sendState?.ok === false ? "text-danger" : "text-muted"}`}>
          {sendState?.ok === false ? sendState.message : ""}
        </p>
      </form>
    );
  }

  // 검증에 성공하면 리다이렉트가 끝날 때까지 폼을 감춘다 — 그사이 '로그인'을 다시 누르면
  // 이미 쓴 코드로 verifyOtp가 재호출되어 애먼 실패 메시지가 뜬다.
  if (verifyState?.ok === true) {
    return <p className="text-small text-muted mt-6">로그인되었습니다. 이동하는 중…</p>;
  }

  return (
    <form action={verifyAction} className="mt-6 space-y-3">
      <input type="hidden" name="email" value={email} />
      <p className="text-small text-muted">
        <strong className="text-[var(--ink)]">{email}</strong>로 코드를 보냈습니다.
      </p>
      <label className="text-sub block">
        인증 코드
        <input
          type="text"
          name="token"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          className="input mt-2 w-full"
          placeholder="6자리 코드"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={verifying} className="btn btn-primary">
          {verifying ? "확인 중…" : "로그인"}
        </button>
        <button type="button" onClick={onRestart} className="btn btn-ghost">
          이메일 다시 입력
        </button>
      </div>
      <p aria-live="polite" className={`text-small ${verifyState?.ok === false ? "text-danger" : "text-muted"}`}>
        {verifyState?.ok === false ? verifyState.message : ""}
      </p>
    </form>
  );
}
