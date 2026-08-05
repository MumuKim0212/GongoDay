import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/supabase/env";

/**
 * 세션 쿠키 갱신 + 첫 방문자 익명 로그인 (ARCHITECTURE §1.1).
 *
 * Next 16에서 middleware.ts가 proxy.ts로 이름이 바뀌었다. 동작은 같다.
 *
 * 이게 없으면 서버 컴포넌트에서 auth.uid()가 항상 null이고,
 * 목록의 SQL 1차 필터도 RLS도 조용히 동작하지 않는다.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // 이번 요청의 서버 컴포넌트가 새 세션을 읽을 수 있도록 request에도 반영한 뒤,
        // 브라우저에 내려보내기 위해 response를 다시 만든다.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // 만료가 임박한 토큰을 여기서 갱신한다. 호출 자체가 목적이다.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 첫 방문이면 익명 세션을 만든다. 서버에서 만들어야 첫 렌더부터 auth.uid()가 잡힌다.
  if (!user) {
    await supabase.auth.signInAnonymously();
  }

  return response;
}

export const config = {
  matcher: [
    // 정적 파일과 이미지 최적화 요청은 세션이 필요 없다.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
