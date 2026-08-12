"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  signInWithEmailPassword,
  signUpWithEmailPassword,
  type PasswordState,
} from "@/app/login/actions";

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.4 4.3M6.5 6.6C3.9 8.3 2 12 2 12s3.6 7 10 7c1.3 0 2.5-.2 3.6-.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </svg>
  );
}

/**
 * 이메일+비밀번호 로그인/회원가입 카드 (Masthead 시안 §옵션 3 + 하단은 옵션 1 스타일).
 * 상단 이중 룰선·킥커는 이 서비스 디자인의 "종이에 인쇄한 잉크" 모티프를 그대로 가져온 것이다.
 */
export function PasswordLoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [showPassword, setShowPassword] = useState(false);
  const [signInState, signInAction, signingIn] = useActionState<PasswordState, FormData>(
    signInWithEmailPassword,
    null,
  );
  const [signUpState, signUpAction, signingUp] = useActionState<PasswordState, FormData>(
    signUpWithEmailPassword,
    null,
  );

  const activeState = mode === "signin" ? signInState : signUpState;
  const pending = mode === "signin" ? signingIn : signingUp;
  const loggedIn = activeState?.ok === true && !activeState.needsConfirmation;

  useEffect(() => {
    if (loggedIn) {
      router.push(redirectTo);
      router.refresh();
    }
  }, [loggedIn, router, redirectTo]);

  if (loggedIn) {
    return <p className="text-small text-muted mt-6 text-center">로그인되었습니다. 이동하는 중…</p>;
  }

  return (
    <div className="relative mx-auto mt-6 w-full max-w-[360px] rounded-sm border border-divider bg-surface p-7 pt-9 elev-sm">
      <div className="absolute inset-x-0 top-0 h-[5px] bg-[var(--ink)]" />
      <div className="absolute inset-x-0 top-[8px] h-px bg-[var(--ink)]" />

      <p className="text-accent-ink mb-1 text-micro font-bold tracking-[0.08em]">오늘공고 계정</p>
      <h2 className="text-title">{mode === "signin" ? "로그인" : "회원가입"}</h2>

      <form action={mode === "signin" ? signInAction : signUpAction} className="mt-5 flex flex-col gap-4">
        <input type="hidden" name="redirectTo" value={redirectTo} />

        {mode === "signup" ? (
          <label className="text-sub block">
            이름(닉네임)
            <input
              type="text"
              name="nickname"
              required
              maxLength={20}
              className="input bg-bg mt-2 w-full"
              placeholder="다른 사람에게 보일 이름"
            />
          </label>
        ) : null}

        <label className="text-sub block">
          이메일
          <input
            type="email"
            name="email"
            required
            className="input bg-bg mt-2 w-full"
            placeholder="you@example.com"
          />
        </label>

        <label className="text-sub block">
          비밀번호
          <div className="relative mt-2">
            <input
              type={showPassword ? "text" : "password"}
              name="password"
              required
              minLength={6}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              className="input bg-bg w-full pr-11"
              placeholder="6자 이상"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-pressed={showPassword}
              aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 표시"}
              className="text-faint hover:text-ink absolute top-1/2 right-1 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-sm"
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        </label>

        <button type="submit" disabled={pending} className="btn btn-primary btn-block mt-1">
          {pending ? "처리 중…" : mode === "signin" ? "로그인" : "가입하기"}
        </button>

        <p
          aria-live="polite"
          className={`text-small ${activeState?.ok === false ? "text-danger" : "text-muted"}`}
        >
          {activeState ? activeState.message : ""}
        </p>
      </form>

      <div className="border-divider text-muted mt-5 flex items-center justify-center gap-1.5 border-t pt-4 text-small">
        <span>{mode === "signin" ? "계정이 없으신가요?" : "이미 계정이 있으신가요?"}</span>
        <button
          type="button"
          onClick={() => setMode((m) => (m === "signin" ? "signup" : "signin"))}
          className="text-accent-ink hover:underline underline-offset-3 font-bold"
        >
          {mode === "signin" ? "가입하기" : "로그인"}
        </button>
      </div>
    </div>
  );
}
