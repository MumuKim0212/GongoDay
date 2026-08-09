"use server";

import { createClient } from "@/lib/supabase/server";

export type SendState = { ok: boolean; message: string } | null;
export type VerifyState = { ok: boolean; message: string } | null;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 로그인 코드 발송 — 계정을 새로 만들거나(§9.5) 이미 있는 계정에 보낸다.
 *
 * 익명 uid를 유지하는 승격(`updateUser`)이 아니다 — 단순 로그인이다. 이미 있는 계정으로
 * 로그인하면 이전 익명 세션의 조건·판정은 이어지지 않는다(마이그레이션을 만들지 않기로 함).
 */
export async function sendLoginCode(_prev: SendState, formData: FormData): Promise<SendState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!EMAIL_RE.test(email)) {
    return { ok: false, message: "올바른 이메일 주소를 입력해 주세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({ email });

  if (error) {
    return { ok: false, message: `코드를 보내지 못했습니다: ${error.message}` };
  }

  return { ok: true, message: email };
}

/** 메일로 받은 6자리 코드를 검증해 로그인을 완료한다. */
export async function verifyLoginCode(_prev: VerifyState, formData: FormData): Promise<VerifyState> {
  const email = String(formData.get("email") ?? "").trim();
  const token = String(formData.get("token") ?? "").trim();

  if (!EMAIL_RE.test(email) || token === "") {
    return { ok: false, message: "이메일과 코드를 확인해 주세요." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });

  if (error) {
    return { ok: false, message: "코드가 올바르지 않거나 만료되었습니다. 다시 시도해 주세요." };
  }

  return { ok: true, message: "" };
}
