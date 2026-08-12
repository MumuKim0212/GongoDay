import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";

/** 이메일 확인 링크(회원가입) 콜백. PKCE `code`를 세션으로 교환한다. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const redirectTo = next && next.startsWith("/") ? next : "/profile";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${redirectTo}`);
    }
    log.error("auth.callback_failed", { message: error.message });
  } else {
    log.warn("auth.callback_missing_code");
  }

  return NextResponse.redirect(
    `${origin}/login?error=confirm_failed&redirect=${encodeURIComponent(redirectTo)}`,
  );
}
