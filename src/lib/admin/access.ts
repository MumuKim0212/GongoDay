/**
 * 관리자 화면 접근 규칙 — **`ADMIN_SLUG` 하나로만** 정한다.
 *
 * 실행 환경(NODE_ENV)을 보지 않는다. 로컬이든 Vercel이든 규칙이 같아서
 * "배포에서만 다르게 도는" 상태를 만들지 않는다. 잠그고 싶어지면 값만 넣으면 된다.
 *
 * | `ADMIN_SLUG` | 열리는 주소 |
 * |---|---|
 * | 비어 있음 | `/admin` (그리고 그 하위 아무 경로) — **잠금 없음** |
 * | 설정됨 | `/admin/<값>` 하나뿐, 나머지는 404 |
 *
 * **잠금이 걸려도 그건 은닉이지 인증이 아니다.** 그래서 이 화면이 읽는 범위를 좁혀뒀다
 * (`stats.ts`): 집계 건수만 읽고 개별 사용자의 프로필·판정 내용은 조회하지 않는다.
 * 경로 조각을 소스에 박지 않는 것도 같은 이유다 — 저장소를 여는 순간 은닉이 끝난다.
 */

/** 잠겨 있는가. 화면이 자기 상태를 사실대로 표시하는 데 쓴다. */
export function isAdminLocked(): boolean {
  return Boolean(process.env.ADMIN_SLUG);
}

export function isAdminAllowed(slug: string[] | undefined): boolean {
  const expected = process.env.ADMIN_SLUG;
  if (!expected) return true;

  return slug?.length === 1 && slug[0] === expected;
}
