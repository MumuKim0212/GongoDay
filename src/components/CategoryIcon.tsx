import type { Category } from "@/lib/sources/category";

/**
 * 분야 선화 (docs/DESIGN.md §5.1)
 *
 * 타일의 그림 자리를 채운다. **공고에는 이미지가 없어서** 분야가 그 자리에 들어가는
 * 유일하게 정직한 재료다 — 카드 하나를 대표하는 성질 중 그림으로 만들 수 있는 것이 분야뿐이다.
 *
 * 선 굵기 1.6 · 둥근 끝 · 24 격자 — 로고와 보기 전환 아이콘이 쓰는 값과 같다.
 * **`currentColor`로 그린다.** 색은 `.tile-media`가 정하므로 여기서 잉크를 고르지 않는다.
 *
 * 장식이 아니라 분야를 말하는 그림이지만, 그림만으로는 뜻이 안 전해지므로
 * `aria-hidden`이고 타일 본문에 분야 이름이 글자로 함께 있다 (§6.2와 같은 판단).
 */
const PATHS: Record<Category, React.ReactNode> = {
  // 서류 가방 — 일자리
  job: (
    <>
      <rect x="3.2" y="7.6" width="17.6" height="12" rx="2.5" />
      <path d="M9 7.6V6.2A2 2 0 0 1 11 4.2h2A2 2 0 0 1 15 6.2v1.4" />
      <path d="M3.2 12.8h17.6" />
    </>
  ),
  // 집
  housing: (
    <>
      <path d="M4 11.2 12 4.5l8 6.7" />
      <path d="M6.2 10v9.5h11.6V10" />
      <path d="M10.2 19.5v-5.3h3.6v5.3" />
    </>
  ),
  // 펼친 책 — 교육
  edu: (
    <>
      <path d="M12 7.4v11" />
      <path d="M12 7.4C10.4 6 8.2 5.4 4.8 5.4v10.8c3.4 0 5.6.6 7.2 2" />
      <path d="M12 7.4c1.6-1.4 3.8-2 7.2-2v10.8c-3.4 0-5.6.6-7.2 2" />
    </>
  ),
  // 두 손에 받친 하트 — 복지
  welfare: (
    <>
      <path d="M12 11.6s-3.2-1.9-3.2-4.1a1.9 1.9 0 0 1 3.2-1.3 1.9 1.9 0 0 1 3.2 1.3c0 2.2-3.2 4.1-3.2 4.1Z" />
      <path d="M4.6 13.4v4.2M19.4 13.4v4.2" />
      <path d="M4.6 15.2c2.4 0 3.4 2.4 7.4 2.4s5-2.4 7.4-2.4" />
    </>
  ),
  // 확성기 — 참여·권리
  rights: (
    <>
      <path d="M5 10.4v3.2a1.6 1.6 0 0 0 1.6 1.6h1.8l6.6 3.6V6.8L8.4 10.4H6.6A1.6 1.6 0 0 0 5 12Z" />
      <path d="M17.6 9.4a4.2 4.2 0 0 1 0 5.2" />
    </>
  ),
  // 하트 + 맥박 — 건강·의료
  health: (
    <>
      <path d="M12 19.4s-7.2-4.4-7.2-9.4A4.2 4.2 0 0 1 12 7.2a4.2 4.2 0 0 1 7.2 2.8c0 5-7.2 9.4-7.2 9.4Z" />
      <path d="M8.4 11.8h2l1-1.8 1.4 3 1-1.2h1.8" />
    </>
  ),
  // 아기 — 임신·출산
  birth: (
    <>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M10.6 8h.02M13.4 8h.02" />
      <path d="M10.8 9.8c.7.6 1.7.6 2.4 0" />
      <path d="M5.6 19.4c1.2-3 3.6-4.6 6.4-4.6s5.2 1.6 6.4 4.6" />
    </>
  ),
  // 새싹 — 농림축산어업
  farm: (
    <>
      <path d="M12 19.4v-7.2" />
      <path d="M12 12.2C12 8.8 9.4 6.2 6 6.2c0 3.4 2.6 6 6 6Z" />
      <path d="M12 12.2c0-3.4 2.6-6 6-6 0 3.4-2.6 6-6 6Z" />
      <path d="M7.6 19.4h8.8" />
    </>
  ),
  // 서류 — 기타
  etc: (
    <>
      <path d="M6.4 4.6h7.4l4 4v10.8H6.4Z" />
      <path d="M13.6 4.6v4.2h4.2" />
      <path d="M9.2 13h5.6M9.2 16h3.6" />
    </>
  ),
};

export function CategoryIcon({ category }: { category: Category }) {
  return (
    <svg
      width="52"
      height="52"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[category]}
    </svg>
  );
}
