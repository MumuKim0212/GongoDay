/**
 * 공백 정규화 + 원본 인덱스 맵 (ARCHITECTURE §5.4)
 *
 * 인용 검증은 '정규화 공간'에서 하는데, 하이라이트는 개행이 살아 있는 '원본 공간'에서 해야 한다.
 * 두 공간을 잇는 맵이 없으면 검증은 통과했는데 하이라이트가 안 되는 상태가 정상적으로 발생한다.
 * 이 파일이 검증과 표시가 갈라지는 유일한 지점을 막는다.
 */

/** JS의 \s는 탭·CR·LF·전각공백(U+3000)·NBSP를 모두 포함한다. */
const WS = /\s/;

export type Normalized = {
  text: string;
  /** map[i] = text[i]에 대응하는 원본 문자열의 인덱스 */
  map: number[];
};

/**
 * 연속 공백류를 단일 스페이스로 접고 trim한다.
 * 접힌 스페이스는 그 공백 구간의 '첫' 원본 인덱스를 가리킨다.
 */
export function normalize(src: string): Normalized {
  const chars: string[] = [];
  const map: number[] = [];

  for (let i = 0; i < src.length; ) {
    if (WS.test(src[i])) {
      const runStart = i;
      while (i < src.length && WS.test(src[i])) i++;
      if (chars.length > 0) {
        // 맨 앞 공백은 버린다 (= trimStart)
        chars.push(" ");
        map.push(runStart);
      }
      continue;
    }
    chars.push(src[i]);
    map.push(i);
    i++;
  }

  // 맨 뒤 공백 한 칸 (= trimEnd)
  if (chars[chars.length - 1] === " ") {
    chars.pop();
    map.pop();
  }

  return { text: chars.join(""), map };
}

/**
 * 정규화 공간에서 quote를 찾아 **원본 문자열 기준** 구간을 돌려준다.
 * 못 찾으면 null — validate가 unclear로 강등한다.
 *
 * 유사도 비교로 완화하지 않는다. AI가 원문을 조금이라도 고쳐 쓰면 떨어지는 것이 의도된 동작이다.
 */
export function locateQuote(
  sourceText: string,
  quote: string,
): { start: number; end: number } | null {
  const src = normalize(sourceText);
  const needle = normalize(quote).text;
  if (!needle) return null;

  const at = src.text.indexOf(needle);
  if (at < 0) return null;

  // needle은 trim되어 있으므로 마지막 문자가 공백이 아니고, map이 실제 문자를 가리킨다
  return { start: src.map[at], end: src.map[at + needle.length - 1] + 1 };
}
