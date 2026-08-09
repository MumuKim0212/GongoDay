import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 운영 토글 (`app_settings`, 단일 행). 관리자 화면에서 즉시 켜고 꺼야 해서 환경변수가 아니라 DB 값이다.
 *
 * **매 요청 조회하지 않는다.** `proxy.ts`가 거의 모든 화면 요청에 걸리므로 DB 왕복을 그대로
 * 얹으면 전체 페이지 로딩이 느려진다. 라이브 트래픽에서 관리자가 이 값을 바꿀 일은 거의 없다고
 * 판단해 1분 TTL 인메모리 캐시로 읽는다 — 완전한 실시간 대신 최대 1분의 반영 지연을 감수한다.
 *
 * Vercel 서버리스 환경이라 이 캐시는 "서버 시작 시 1회"가 아니다. 인스턴스가 콜드 스타트되면
 * 모듈이 다시 로드되어 캐시도 같이 비워진다 — 인스턴스마다 독립적으로 1분씩 유지될 뿐이다.
 */
const TTL_MS = 60_000;

let cached: { requireLogin: boolean; expiresAt: number } | null = null;

export async function isLoginRequired(): Promise<boolean> {
  if (cached && cached.expiresAt > Date.now()) return cached.requireLogin;

  const db = createAdminClient();
  const { data, error } = await db.from("app_settings").select("require_login").eq("id", true).maybeSingle();

  // 못 읽으면 지금까지의 기본 동작(익명 허용)을 유지한다 — 설정 조회 실패로 서비스 전체를 막지 않는다.
  const requireLogin = error || !data ? false : Boolean((data as { require_login: boolean }).require_login);

  cached = { requireLogin, expiresAt: Date.now() + TTL_MS };
  return requireLogin;
}

/** 관리자 화면 전용. 쓰기 직후 캐시도 같이 갱신해 이 인스턴스에서는 지연 없이 반영한다. */
export async function setLoginRequired(value: boolean): Promise<{ error: string | null }> {
  const db = createAdminClient();
  const { error } = await db.from("app_settings").update({ require_login: value }).eq("id", true);

  if (error) return { error: error.message };

  cached = { requireLogin: value, expiresAt: Date.now() + TTL_MS };
  return { error: null };
}
