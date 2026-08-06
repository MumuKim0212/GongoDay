"use client";

import { useSearchParams } from "next/navigation";

import { parseView, type View } from "@/lib/policies/view";

/**
 * 타일 ↔ 목록 (docs/DESIGN.md §5.1)
 *
 * **주소는 바꾸지만 서버는 부르지 않는다.** 전에는 `<Link href="/?view=list">`였는데, 그러면
 * URL이 바뀌므로 `force-dynamic` 페이지가 통째로 다시 렌더된다 — 프로필·목록·건수·판정·갱신시각
 * 쿼리가 전부 다시 돌고(개발 환경 실측 230~420ms, 배포는 Supabase 왕복이 더 붙는다) 돌아오는
 * 데이터는 방금 그린 것과 **완전히 같다.** 표시 방식만 바뀌는데 왕복할 이유가 없다.
 * `<Link>`의 프리페치까지 얹혀 마우스를 올리기만 해도 서버 렌더가 한 번 더 돌고 있었다.
 *
 * 그래서 네이티브 History API로 주소만 갈아끼운다 — Next가 `pushState`를 라우터에 물려 두어
 * `useSearchParams()`가 다시 읽힌다(`next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md`
 * "Native History API"). 서버 트리는 그대로 있고 클라이언트 컴포넌트만 다시 그린다.
 *
 * 얻는 것이 하나 더 있다: `PolicyList`가 다시 마운트되지 않으므로 **판정 결과가 살아남는다.**
 *
 * `<button>`이 아니라 `<a href>`인 이유는 주소를 복사하고 새 탭으로 열 수 있어야 하기 때문이다.
 * 그래서 수식 키가 눌린 클릭은 브라우저에 그대로 넘긴다.
 */
export function ViewToggle() {
  const params = useSearchParams();
  const view = parseView(params.get("view"));

  // 기본값(`tile`)은 주소에 적지 않는다 — `/`와 `/?view=tile`이 같은 화면임이 보여야 한다
  const hrefFor = (v: View) => {
    const next = new URLSearchParams(params.toString());
    if (v === "list") next.set("view", "list");
    else next.delete("view");
    return next.toString() ? `/?${next}` : "/";
  };

  const swap = (e: React.MouseEvent<HTMLAnchorElement>, v: View) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    window.history.pushState(null, "", hrefFor(v));
  };

  const items = [
    { v: "tile" as const, label: "타일로 보기", icon: <TileIcon /> },
    { v: "list" as const, label: "목록으로 보기", icon: <ListIcon /> },
  ];

  return (
    <nav
      aria-label="보기 방식"
      className="border-divider flex items-center gap-1 rounded-pill border p-1"
    >
      {items.map((it) => {
        const on = view === it.v;
        return (
          <a
            key={it.v}
            href={hrefFor(it.v)}
            onClick={(e) => swap(e, it.v)}
            aria-label={it.label}
            // 아이콘만 있으므로 마우스 사용자에게도 이름이 필요하다 — `aria-label`은 툴팁을 안 띄운다
            title={it.label}
            // 링크라 `aria-pressed`를 쓸 수 없다. 지금 보고 있는 쪽을 `aria-current`가 말한다
            aria-current={on ? "true" : undefined}
            className={`flex size-8 items-center justify-center rounded-pill transition-colors ${
              on
                ? "bg-[var(--accent-ink)] text-[var(--accent-on)]"
                : "text-muted hover:bg-[color-mix(in_srgb,var(--ink)_10%,transparent)]"
            }`}
          >
            {it.icon}
          </a>
        );
      })}
    </nav>
  );
}

/* 선 굵기와 반경은 로고·분야 선화와 같은 값이다 — 크롬이 한 벌로 보여야 한다 */
function TileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1" y="1" width="6" height="6" rx="1.5" />
      <rect x="9" y="1" width="6" height="6" rx="1.5" />
      <rect x="1" y="9" width="6" height="6" rx="1.5" />
      <rect x="9" y="9" width="6" height="6" rx="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <rect x="1" y="2" width="14" height="3.2" rx="1.5" />
      <rect x="1" y="6.9" width="14" height="3.2" rx="1.5" />
      <rect x="1" y="11.8" width="14" height="3.2" rx="1.5" />
    </svg>
  );
}
