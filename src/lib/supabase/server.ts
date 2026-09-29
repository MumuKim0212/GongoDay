import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * 서버 컴포넌트 / 라우트 핸들러 / Server Action용. anon key라 RLS가 그대로 적용된다.
 *
 * 요청마다 새로 만든다 — 모듈 스코프에 캐시하면 다른 사용자의 세션이 섞인다.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. proxy.ts가 갱신을 대신하므로 무시해도 된다.
        }
      },
    },
  });
}
