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
  //
  // **화면 요청일 때만이다.** 쿠키를 들고 오지 않는 요청마다 만들면 `auth.users`가 무한히 늘어난다.
  // 확실한 누수가 우리 자동화였다 — `.github/workflows/sync.yml`의 크론이 매시간 두 번
  // `curl`로 `/api/sync`를 치는데 쿠키가 없으니 정각마다 익명 유저가 둘씩 생겼다(월 1,400여 개).
  // 세션이 갱신되는 것은 여전히 모든 경로에서다(위 `getUser()`) — **여기서 막는 것은 생성뿐이다.**
  //
  // API 경로에서 새 세션을 만들어봐야 쓸 데도 없다. `/api/verdicts`는 프로필이 있어야 판정하는데
  // 방금 만든 익명 유저에게는 프로필 행이 없어 어차피 400으로 돌아간다.
  if (!user && !request.nextUrl.pathname.startsWith("/api/")) {
    await supabase.auth.signInAnonymously();
  }

  return response;
}

export const config = {
  matcher: [
    // 정적 파일과 이미지 최적화 요청은 세션이 필요 없다.
    //
    // **`robots.txt`를 빼는 것이 특히 중요하다.** 그 파일을 읽는 것은 크롤러뿐인데, 매처에
    // 걸려 있으면 **크롤 범위를 확인하러 온 요청 자체가 익명 유저를 하나 만든다.** 훑을 표면을
    // 줄이려고 둔 파일이 정반대로 작동하는 셈이다.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
