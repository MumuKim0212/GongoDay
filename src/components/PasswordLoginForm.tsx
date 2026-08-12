"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  signInWithEmailPassword,
  signUpWithEmailPassword,
  type PasswordState,
} from "@/app/login/actions";

/** 이메일+비밀번호 로그인/회원가입 폼. 상단 토글로 모드를 바꾼다. */
export function PasswordLoginForm({ redirectTo }: { redirectTo: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
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
    return <p className="text-small text-muted mt-6">로그인되었습니다. 이동하는 중…</p>;
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setMode("signin")}
          aria-pressed={mode === "signin"}
          className={`tag tag-btn transition-colors ${mode === "signin" ? "tag-solid" : "tag-outline"}`}
        >
          로그인
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          aria-pressed={mode === "signup"}
          className={`tag tag-btn transition-colors ${mode === "signup" ? "tag-solid" : "tag-outline"}`}
        >
          회원가입
        </button>
      </div>

      <form action={mode === "signin" ? signInAction : signUpAction} className="mt-4 space-y-3">
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <label className="text-sub block">
          이메일
          <input type="email" name="email" required className="input mt-2 w-full" placeholder="you@example.com" />
        </label>
        <label className="text-sub block">
          비밀번호
          <input
            type="password"
            name="password"
            required
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            className="input mt-2 w-full"
            placeholder="6자 이상"
          />
        </label>
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "처리 중…" : mode === "signin" ? "로그인" : "가입하기"}
        </button>
        <p
          aria-live="polite"
          className={`text-small ${activeState?.ok === false ? "text-danger" : "text-muted"}`}
        >
          {activeState ? activeState.message : ""}
        </p>
      </form>
    </div>
  );
}
