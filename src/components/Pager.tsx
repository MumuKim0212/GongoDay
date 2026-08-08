"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * 페이저 (DESIGN.md §7 미정 1)
 *
 * **주소를 서버가 받은 `searchParams`로 만들면 안 된다.** `ViewToggle`이 `pushState`로 주소만
 * 갈아끼우므로 서버는 다시 돌지 않는다 (§5.1) — 서버가 아는 주소에는 `view=list`가 없어서
 * `다음 →`이 `/?page=2`로 가고, **페이지를 넘기는 순간 타일 보기로 되돌아갔다.**
 *
 * 지금 주소를 아는 것은 클라이언트뿐이라 `useSearchParams()`로 읽는다 — 이 훅이 서버
 * 컴포넌트에서 지원되지 않는 이유가 곧 이 버그다("to prevent stale values during partial
 * rendering", `next/dist/docs/01-app/03-api-reference/04-functions/use-search-params.md`).
 * 같은 이유로 `ListControls`는 처음부터 이 훅으로 주소를 만들고 있었다.
 *
 * `page`·`lastPage`는 서버가 센 값이라 그대로 받는다 — 보기를 바꿔도 변하지 않는다.
 */
export function Pager({ page, lastPage }: { page: number; lastPage: number }) {
  const params = useSearchParams();

  const href = (p: number) => {
    const next = new URLSearchParams(params.toString());
    next.delete("page"); // 1페이지는 주소에 적지 않는다 — `/`와 `/?page=1`이 같은 화면이다
    if (p > 1) next.set("page", String(p));
    return next.toString() ? `/?${next}` : "/";
  };

  return (
    <nav className="mt-6 flex items-center justify-between">
      {page > 1 ? (
        <Link href={href(page - 1)} className="btn btn-ghost">
          ← 이전
        </Link>
      ) : (
        <span />
      )}
      <span className="text-small text-muted tabular-nums">
        {page} / {lastPage}
      </span>
      {page < lastPage ? (
        <Link href={href(page + 1)} className="btn btn-ghost">
          다음 →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}
