"use server";

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";

export type PasswordState = { ok: boolean; message: string; needsConfirmation?: boolean } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function origin(): Promise<string> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return `${proto}://${host}`;
}

/**
 * 이메일+비밀번호 회원가입 — 계정을 새로 만든다(§9.5).
 *
 * 익명 uid를 유지하는 승격(`updateUser`)이 아니다 — 단순 가입이다. 이전 익명 세션의
 * 조건·판정은 이어지지 않는다(마이그레이션을 만들지 않기로 함, 기존 OTP 로그인과 동일한 정책).
 */
export async function signUpWithEmailPassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!EMAIL_RE.test(email)) {
    return { ok: false, message: "올바른 이메일 주소를 입력해 주세요." };
  }
  if (password.length < 6) {
    return { ok: false, message: "비밀번호는 6자 이상이어야 합니다." };
  }

  const redirectNext = String(formData.get("redirectTo") ?? "/profile");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(redirectNext)}` },
  });

  if (error) {
    return { ok: false, message: `가입하지 못했습니다: ${error.message}` };
  }

  // 보안상 이미 가입된(확인 완료된) 이메일도 에러 없이 성공 응답을 준다 — identities가 비어 있으면 그 경우다.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return { ok: false, message: "이미 가입된 이메일입니다. 로그인해 주세요." };
  }

  if (!data.session) {
    return { ok: true, needsConfirmation: true, message: "확인 메일을 보냈습니다. 메일함을 확인해 주세요." };
  }

  return { ok: true, message: "" };
}

/** 이메일+비밀번호로 로그인한다. */
export async function signInWithEmailPassword(_prev: PasswordState, formData: FormData): Promise<PasswordState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!EMAIL_RE.test(email) || password === "") {
    return { ok: false, message: "이메일과 비밀번호를 확인해 주세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { ok: false, message: "이메일 또는 비밀번호가 올바르지 않습니다." };
  }

  return { ok: true, message: "" };
}
