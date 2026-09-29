/**
 * 서버 로그 — **한 줄에 JSON 하나.**
 *
 * Vercel 런타임 로그는 stdout/stderr의 한 줄을 그대로 한 행으로 받는다. JSON으로 내보내면
 * 대시보드가 필드째 파싱해 `event`나 `source`로 걸러 볼 수 있다 — 사람이 읽는 문장으로 적으면
 * 검색이 문자열 매칭밖에 안 된다.
 *
 * **여러 줄로 쪼개 쓰지 않는다.** 판정 라우트는 10건을 병렬로 돌리므로 줄이 서로 끼어들어
 * 어느 호출의 것인지 알 수 없게 된다. 한 사건은 한 줄에 끝낸다.
 *
 * 시각·경로·요청 id는 Vercel이 각 행에 이미 붙인다. 여기서 또 적지 않는다.
 */

type Fields = Record<string, unknown>;

/**
 * `event`는 **`도메인.사건`** 꼴로 적는다 (`sync.done`, `gemini.failed`).
 * 대시보드에서 `sync.`로 묶어 보려면 접두사가 일정해야 한다.
 *
 * 레벨은 콘솔 함수로 가른다 — `warn`·`error`는 stderr로 나가고 Vercel이 그 행을 오류로 세운다.
 */
function emit(level: "info" | "warn" | "error", event: string, fields: Fields) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  /** 정상 흐름의 사건. 수집 한 바퀴, 판정 한 배치처럼 **나중에 세어 볼 것**만 남긴다 */
  info: (event: string, fields: Fields = {}) => emit("info", event, fields),
  /** 삼켜졌지만 알아야 하는 실패 — 재시도로 가려진 오류, 인증 거절, 개별 판정 실패 */
  warn: (event: string, fields: Fields = {}) => emit("warn", event, fields),
  /** 사람이 손을 대야 하는 실패 — 설정 누락, DB 쓰기 실패 */
  error: (event: string, fields: Fields = {}) => emit("error", event, fields),
};

/**
 * throw된 값에서 메시지만 뽑는다.
 *
 * `Error`를 그대로 필드에 넣으면 `JSON.stringify`가 **`{}`로 직렬화한다** — message가 열거
 * 가능한 속성이 아니라서다. 로그에 빈 객체만 남는 사고를 막으려고 여기 한 곳을 거친다.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
