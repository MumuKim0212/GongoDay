/**
 * 판정 근거 원문 + 인용 하이라이트 (ARCHITECTURE §5.4 · §6.2)
 *
 * 넘어오는 `text`는 `buildSourceText()`의 출력 그대로다 — **AI에 넘긴 텍스트 = 검증 대상 =
 * 여기서 보여주는 텍스트**가 같은 문자열이어야 인용 검증이 의미를 갖는다 (§5.3).
 *
 * 구간은 `locateQuote()`가 준 **원본 문자열 기준** 값이다. 정규화 공간의 위치를 그대로 쓰면
 * 개행이 낀 문장에서 엉뚱한 자리가 칠해진다 — 그 변환은 `normalize.ts`의 인덱스 맵이 한다.
 */
export function QuoteHighlight({
  text,
  range,
}: {
  text: string;
  /** 없으면 하이라이트 없이 원문만 보여준다 */
  range: { start: number; end: number } | null;
}) {
  // 개행을 살려서 보여준다. 접으면 원문을 읽을 수 없고, 인덱스 맵을 둔 이유도 사라진다.
  const className = "whitespace-pre-wrap break-words text-sm leading-relaxed";

  if (range === null) return <div className={className}>{text}</div>;

  return (
    <div className={className}>
      {text.slice(0, range.start)}
      <mark className="rounded bg-yellow-200 px-0.5 text-gray-900 dark:bg-yellow-300/80 dark:text-gray-900">
        {text.slice(range.start, range.end)}
      </mark>
      {text.slice(range.end)}
    </div>
  );
}
