/**
 * 목록의 보기 방식 (docs/DESIGN.md §5.1)
 *
 * **필터가 아니다.** 조회는 그대로고 같은 10건을 타일로 그릴지 목록으로 그릴지만 정한다 —
 * `fetchPolicies`는 이 값을 보지 않는다.
 *
 * 기본값이 두 곳(토글과 목록)에서 갈리면 화면이 어긋나므로 파싱을 여기 하나로 둔다.
 */
export type View = "tile" | "list";

export function parseView(raw: string | null | undefined): View {
  return raw === "list" ? "list" : "tile";
}
