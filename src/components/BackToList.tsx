"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * 상세에서 목록으로 돌아가는 링크 (docs/DESIGN.md §5.2)
 *
 * **목록을 다시 부르지 않는다.** `<Link href="/">`는 뒤로가기가 아니라 `/`로 가는 정방향
 * 이동이고, `/`는 `force-dynamic`이라 클라이언트 캐시에 페이지 세그먼트가 남지 않는다
 * (`next/dist/docs/01-app/04-glossary.md` Client Cache — "페이지는 캐시되지 않지만 브라우저
 * 뒤로/앞으로 이동에서는 재사용된다"). 그래서 누를 때마다 프로필·목록·건수·판정·갱신시각
 * 쿼리가 전부 다시 돌았다. 같은 자리에서 브라우저 뒤로가기를 누르면 왕복이 0이다.
 *
 * **주소가 `/`로 박혀 있던 것이 더 큰 문제였다.** 3페이지에서 들어와도 1페이지로 돌아갔고
 * 분야·검색·출처·보기 방식·스크롤 위치도 함께 잃었다. 아래 판정 안내 링크는 더 나빴다 —
 * 1페이지에 이 정책이 없을 수 있는데 "이 정책도 함께 판정됩니다"라고 적혀 있었다.
 *
 * 뒤로가기는 둘 다 해결한다. 다만 **공유 링크로 상세에 바로 들어온 경우에는 돌아갈 목록이
 * 없다** — 그때 `back()`은 앱을 벗어나거나 아무 일도 하지 않는다. 그 경우만 링크로 남긴다.
 *
 * `<button>`이 아니라 링크인 이유는 주소를 복사하고 새 탭으로 열 수 있어야 하기 때문이다.
 * 그래서 수식 키가 눌린 클릭은 브라우저에 그대로 넘긴다 (`ViewToggle`과 같은 판단).
 */
export function BackToList({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <Link
      href="/"
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (!enteredFromInside()) return;
        e.preventDefault();
        router.back();
      }}
    >
      {children}
    </Link>
  );
}

/**
 * 이 문서가 지금 보고 있는 주소로 열렸다면 앱 안을 거쳐 오지 않았다 — 뒤로 갈 목록이 없다.
 *
 * 문서가 열린 주소는 클라이언트 전환으로는 바뀌지 않으므로 이 비교가 곧 "목록을 거쳐 왔는가"다.
 * 못 읽으면 링크로 둔다 — 왕복 한 번이 눌러도 안 움직이는 버튼보다 낫다.
 */
function enteredFromInside(): boolean {
  const [nav] = performance.getEntriesByType("navigation");
  if (!nav) return false;
  return new URL(nav.name).pathname !== window.location.pathname;
}
