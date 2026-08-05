/**
 * 환경 변수를 읽는 단일 지점.
 *
 * 빠진 키를 undefined로 흘려보내면 Supabase 클라이언트가 만들어지긴 하고
 * 호출 시점에야 인증 오류가 난다. 여기서 즉시 던진다.
 */
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`환경 변수 ${name}가 없습니다. .env.local을 확인하세요.`);
  return value;
}

// NEXT_PUBLIC_ 접두사는 빌드 시점에 인라인되므로 process.env를 통째로 넘기면 안 되고
// 반드시 리터럴로 접근해야 한다.
export const SUPABASE_URL = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_ANON_KEY = required(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

/** 서버 전용. 브라우저 번들에 들어가면 안 된다 — admin.ts에서만 호출한다. */
export function serviceRoleKey(): string {
  return required("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
}
