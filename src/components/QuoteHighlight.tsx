/**
 * 판정 근거 원문 + 인용 하이라이트 (ARCHITECTURE §5.4 · §6.2)
 *
 * 넘어오는 `sections`는 `sourceSections()`의 출력 그대로다 — **AI에 넘긴 텍스트 = 검증 대상 =
 * 여기서 보여주는 텍스트**가 같은 문자열이어야 인용 검증이 의미를 갖는다 (§5.3). 라벨만
 * `[정책명]`이 아니라 제목으로 세운다.
 *
 * 구간은 `locateQuote()`가 준 **조립 문자열 기준** 값이다. 정규화 공간의 위치를 그대로 쓰면
 * 개행이 낀 문장에서 엉뚱한 자리가 칠해진다 — 그 변환은 `normalize.ts`의 인덱스 맵이 한다.
 */
import type { SourceSection } from "@/lib/verdict/prompt";

type Range = { start: number; end: number };

export function QuoteHighlight({
  sections,
  range,
}: {
  sections: SourceSection[];
  /** 없으면 하이라이트 없이 원문만 보여준다 */
  range: Range | null;
}) {
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.label}>
          <h2 className="text-sub">{section.label}</h2>
          <Body text={section.body} range={localRange(section, range)} />
        </div>
      ))}
    </div>
  );
}

function Body({ text, range }: { text: string; range: Range | null }) {
  // 개행을 살려서 보여준다. 접으면 원문을 읽을 수 없고, 인덱스 맵을 둔 이유도 사라진다.
  // 행간 1.7 — 길게 이어지는 한글 원문이라 기본 1.55에서는 줄이 뭉친다 (DESIGN.md §2.3).
  const className = "text-compact mt-1 leading-[1.7] break-words whitespace-pre-wrap";

  if (range === null) return <div className={className}>{text}</div>;

  return (
    <div className={className}>
      {text.slice(0, range.start)}
      {/*
        노란 형광펜이 아니라 시안 틴트다 (DESIGN.md §4.3). 원본 시스템의 공정 노랑은
        인쇄 처리 전용이라 본문에 쓸 수 없고, 목업도 인용을 이 틴트로 칠한다.
      */}
      <mark className="rounded-xs bg-[var(--tint-accent-bg)] px-0.5 text-[var(--tint-accent-fg)]">
        {text.slice(range.start, range.end)}
      </mark>
      {text.slice(range.end)}
    </div>
  );
}

/** 조립 문자열 기준 구간을 조각 안의 위치로 옮긴다. 겹치지 않는 조각은 `null`이다. */
function localRange(section: SourceSection, range: Range | null): Range | null {
  if (range === null) return null;
  const start = Math.max(range.start - section.start, 0);
  const end = Math.min(range.end - section.start, section.body.length);
  return start < end ? { start, end } : null;
}
