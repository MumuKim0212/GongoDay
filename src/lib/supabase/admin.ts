import { createClient } from "@supabase/supabase-js";

import { SUPABASE_URL, serviceRoleKey } from "./env";

/**
 * service_role 클라이언트 — RLS를 우회한다. 수집 라우트 전용.
 *
 * `policies`·`sync_runs`에는 클라이언트 write 정책이 아예 없어서(§2.5)
 * 쓰기는 이 키로만 가능하다. **브라우저 코드에서 import하면 키가 번들에 들어간다.**
 */
export function createAdminClient() {
  return createClient(SUPABASE_URL, serviceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
