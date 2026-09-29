import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 운영 토글 (`app_settings`, 단일 행). 관리자 화면에서 즉시 켜고 꺼야 해서 환경변수가 아니라 DB 값이다.
 *
 * **매 요청 조회하지 않는다.** `/api/verdicts`·`/api/notify`가 사용자 요청·크론마다 걸리므로 DB 왕복을
 * 그대로 얹으면 비용이 커진다. 1분 TTL 인메모리 캐시로 읽는다 — 완전한 실시간 대신 최대 1분의
 * 반영 지연을 감수한다.
 *
 * Vercel 서버리스 환경이라 이 캐시는 "서버 시작 시 1회"가 아니다. 인스턴스가 콜드 스타트되면
 * 모듈이 다시 로드되어 캐시도 같이 비워진다 — 인스턴스마다 독립적으로 1분씩 유지될 뿐이다.
 */
const TTL_MS = 60_000;

let cached: { aiEnabled: boolean; expiresAt: number } | null = null;

/** 토큰 절약 등으로 AI 판정을 잠시 끌 때 켜고 끄는 값. 기본은 켜짐이다. */
export async function isAiEnabled(): Promise<boolean> {
  if (cached && cached.expiresAt > Date.now()) return cached.aiEnabled;

  const db = createAdminClient();
  const { data, error } = await db.from("app_settings").select("ai_enabled").eq("id", true).maybeSingle();

  // 못 읽으면 지금까지의 기본 동작(AI 사용)을 유지한다 — 설정 조회 실패로 서비스를 막지 않는다.
  const aiEnabled = error || !data ? true : Boolean((data as { ai_enabled: boolean }).ai_enabled);

  cached = { aiEnabled, expiresAt: Date.now() + TTL_MS };
  return aiEnabled;
}

/** 관리자 화면 전용. 쓰기 직후 캐시도 같이 갱신해 이 인스턴스에서는 지연 없이 반영한다. */
export async function setAiEnabled(value: boolean): Promise<{ error: string | null }> {
  const db = createAdminClient();
  const { error } = await db.from("app_settings").update({ ai_enabled: value }).eq("id", true);

  if (error) return { error: error.message };

  cached = { aiEnabled: value, expiresAt: Date.now() + TTL_MS };
  return { error: null };
}
