"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { PolicyListRow } from "@/lib/policies/query";
import { parseView } from "@/lib/policies/view";
import { scoreOf, type Score } from "@/lib/verdict/score";
import type { DecidedVerdict } from "@/lib/verdict/validate";

import { PolicyCard } from "./PolicyCard";
import { PolicyTile } from "./PolicyTile";

/**
 * 목록 + 자동 판정 (ARCHITECTURE §6.1)
 *
 * **화면을 열면 알아서 판정한다.** 버튼을 눌러야 배지가 붙던 때는 페이지를 넘길 때마다 같은 동작을
 * 반복해야 했다. 자동으로 돌리는 대신 세 가지를 지킨다 — 캐시에 다 있으면 요청을 아예 만들지 않고,
 * 한 화면에서 두 번 쏘지 않고, 떠날 때 끊는다.
 *
 * 판정 결과를 클라이언트 상태로 들고 있어야 하는 이유는 **실패 경로 때문이다.** 라우트 타임아웃분은
 * 저장하지 않으므로(§5.2) `router.refresh()`로 서버에서 다시 읽으면 화면에 아무것도 안 나타난다.
 * 저장된 판정은 서버가 목록과 함께 읽어 `initialVerdicts`로 내려준다 — 그 경우 호출이 0건이다.
 */

/** 라우트 상한(60초)보다 짧게 잡는다. 넘기면 못 받은 것만 '애매'로 끝내고 화면을 돌려준다 (§7) */
const CLIENT_TIMEOUT_MS = 45_000;

/**
 * 판정 후 **현재 페이지 안에서만** 다시 정렬한다 (§6.1). 점수가 높은 것부터다.
 * 미판정은 '조건 미기재'(2점)보다 뒤, '아님'(1점)보다 앞이다 — 아직 모르는 것을 확정된 탈락보다
 * 뒤로 보낼 이유는 없다.
 */
const UNJUDGED_RANK = 3.5;

type VerdictMap = Record<string, DecidedVerdict>;

/** `/api/verdicts`가 흘리는 NDJSON 한 줄 (라우트 주석과 한 벌이다) */
type StreamLine =
  | { t: "v"; id: string; v: DecidedVerdict; failed?: boolean }
  | { t: "done" };

/** 판정을 못 받은 카드가 들고 있을 자리. 라우트의 AI 실패분과 같은 모양이다. */
const FAILED_PLACEHOLDER: DecidedVerdict = {
  verdict: "unclear",
  decided_by: "ai",
  reason: "판정하지 못했습니다. 다시 시도해 주세요.",
  quote: null,
  quote_verified: false,
  blockers: [],
  // 확인 항목이 비면 2점('조건 미기재')이 된다. 판정을 못 한 카드가
  // 확정된 3·4점보다 뒤로 가는 편이 맞다 — 아는 게 없으니까.
  checks: [],
};

/**
 * 이 문서가 이번 방문에 받은 판정
 *
 * **상세에서 뒤로 돌아오면 이 트리가 다시 마운트된다.** 클라이언트 캐시가 돌려주는 RSC
 * 페이로드는 목록을 처음 그릴 때 만들어진 것이라, 그 뒤에 받은 판정은 `initialVerdicts`에
 * 없다 — 방금 본 배지가 사라진다. 저장은 이미 끝났으므로 서버를 다시 부를 이유는 없고,
 * 문서가 살아 있는 동안 여기서 다시 채운다. 새로고침하면 서버가 내려준 것으로 돌아간다.
 *
 * **서명으로 묶는다.** 조건을 고치면 옛 판정은 지금 조건의 판정이 아니다 — 서명을 빼면
 * 프로필을 저장한 뒤에도 옛 배지가 그대로 붙어 새 조건으로 판정한 것처럼 보인다 (§5.5).
 *
 * **타임아웃분은 넣지 않는다.** 서버에 저장하지 않은 '판정 못 함'까지 되살리면 다시 눌러
 * 지우는 길이 막힌다 — 아래 `catch`가 채우는 것은 화면 한 번 분량이다.
 */
let carried: { signature: string | null | undefined; map: VerdictMap } = {
  signature: undefined,
  map: {},
};

export function PolicyList({
  rows,
  initialVerdicts,
  signature,
  hasSession,
  hasProfile,
}: {
  rows: PolicyListRow[];
  initialVerdicts: VerdictMap;
  signature: string | null;
  hasSession: boolean;
  hasProfile: boolean;
}) {
  // 보기 방식은 주소에서 읽는다 — `ViewToggle`이 `pushState`로 주소만 갈아끼우므로
  // 서버를 다시 부르지 않고 이 훅이 다시 읽힌다 (§5.1). 상태를 여기 두면 토글과 어긋난다.
  const view = parseView(useSearchParams().get("view"));

  // 서버가 내려준 것이 우선이다 — 서명으로 걸러 읽은 값이라 이쪽이 사실에 가깝다.
  const known = () =>
    signature === carried.signature ? { ...carried.map, ...initialVerdicts } : initialVerdicts;

  const [verdicts, setVerdicts] = useState<VerdictMap>(known);
  /**
   * 정렬 기준. **판정이 끝날 때만 갱신한다** — 한 건 도착할 때마다 다시 정렬하면
   * 읽고 있는 카드가 발밑에서 자리를 옮긴다. 채워지는 동안 순서는 그대로 두고
   * 스트림이 닫힐 때 한 번만 옮긴다 (§6.1).
   */
  const [sortBasis, setSortBasis] = useState<VerdictMap>(known);
  const [judging, setJudging] = useState(false);
  const [failedIds, setFailedIds] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  // 쓰기는 렌더 밖에서만 한다. 조건이 바뀌었으면 들고 있던 것을 버린다.
  useEffect(() => {
    if (signature !== carried.signature) carried = { signature, map: {} };
    carried.map = { ...carried.map, ...initialVerdicts };
  }, [signature, initialVerdicts]);

  // 정렬은 판정이 하나라도 있을 때만. 정렬 자체는 안정 정렬이라 동률은 최신순(서버 정렬) 그대로다.
  const ordered = useMemo(() => {
    const rank = (id: string) => {
      const v = sortBasis[id];
      return v ? 5 - scoreOf(v) : UNJUDGED_RANK;
    };
    return [...rows].sort((a, b) => rank(a.id) - rank(b.id));
  }, [rows, sortBasis]);

  /** 아직 판정이 없는 것. 비어 있으면 왕복 자체를 만들지 않는다 — 캐시 적중의 값이 여기서 나온다. */
  const pendingIds = useMemo(
    () => rows.filter((r) => !verdicts[r.id]).map((r) => r.id),
    [rows, verdicts],
  );

  /**
   * 판정 한 번. 응답은 NDJSON이라 **한 줄 도착할 때마다 그 카드만 채운다** —
   * 예전처럼 제일 느린 1건이 나머지 9건을 붙잡고 있지 않는다.
   *
   * 렌더 스코프에서 읽는 값이 없으므로 한 번만 만든다. 무엇을 판정할지는 인자로 받는다.
   */
  const judge = useCallback(async (ids: string[], controller: AbortController) => {
    setJudging(true);
    setNote(null);
    setFailedIds([]);

    // 끊긴 이유를 가른다. **떠나면서 끊은 것과 오래 걸려 끊은 것은 다르다** — 앞의 것은
    // 화면에 남길 게 없고(이 트리가 사라졌거나 새 요청이 이미 돌고 있다), 뒤의 것만
    // '판정 못 함'으로 칠해야 한다.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CLIENT_TIMEOUT_MS);
    const leftPage = () => controller.signal.aborted && !timedOut;

    const arrived: VerdictMap = {};
    const failed: string[] = [];

    try {
      const res = await fetch("/api/verdicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyIds: ids }),
        signal: controller.signal,
      });

      // 판정을 시작하기도 전에 끝난 실패(세션·프로필·조회)는 스트림이 아니라 상태코드 붙은 JSON이다.
      // 결과가 없으므로 카드는 건드리지 않는다.
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setNote(body.error ?? "판정하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // 마지막 조각은 줄이 덜 왔을 수 있다. 개행까지 온 것만 처리하고 나머지는 버퍼에 남긴다.
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const text of lines) {
          if (text === "") continue;
          const msg = JSON.parse(text) as StreamLine;

          if (msg.t === "done") {
            setNote(summarize(arrived));
            continue;
          }

          arrived[msg.id] = msg.v;
          // 실패분은 서버가 저장하지 않았다 — 들고 다니면 다시 부를 길이 막힌다.
          if (msg.failed) failed.push(msg.id);
          else carried.map[msg.id] = msg.v;

          setVerdicts((prev) => ({ ...prev, [msg.id]: msg.v }));
        }
      }
    } catch {
      // 떠나면서 끊었다면 칠할 화면이 없다. **여기서 칠하면 안 된다** — StrictMode의 첫 마운트가
      // 끊길 때 카드 열 장이 전부 '판정 못 함'으로 잠깐 칠해지고 `N건 다시 판정`이 번쩍인다.
      if (leftPage()) return;

      // 45초 상한 · 네트워크 실패 (§7). **도착한 것은 이미 화면에 있다** —
      // 못 받은 것만 채운다. 실패가 알던 것까지 지우면 화면이 더 나빠진다.
      const missing = ids.filter((id) => !arrived[id]);
      if (missing.length > 0) {
        setVerdicts((prev) => {
          const filled = { ...prev };
          for (const id of missing) filled[id] ??= FAILED_PLACEHOLDER;
          return filled;
        });
        failed.push(...missing);
        setNote("판정이 오래 걸려 끝내지 못했습니다. 다시 시도해 주세요.");
      }
    } finally {
      clearTimeout(timer);
      // 떠나면서 끊긴 요청은 상태를 되돌리지 않는다 — 되돌리면 뒤이어 시작된 요청의
      // `판정 중…`을 이 요청이 꺼버린다.
      if (!leftPage()) {
        setFailedIds(failed);
        // 여기서 한 번만 정렬한다. 채워지는 동안은 자리를 옮기지 않았다.
        setSortBasis((prev) => ({ ...prev, ...arrived }));
        setJudging(false);
      }
    }
  }, []);

  /**
   * 화면당 한 번 쏜다.
   *
   * **이 트리는 rows가 바뀌면 통째로 remount된다** (page.tsx의 `key`) — 페이지·필터가 바뀌면
   * 이 효과가 새로 돈다. 같은 화면에서 두 번 쏘는 것만 막으면 되고, 그 기준은 서명이다
   * (조건을 고치면 옛 판정은 지금 조건의 판정이 아니다 §5.5).
   */
  const firedFor = useRef<string | null | undefined>(undefined);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!hasProfile || !hasSession) return;
    if (pendingIds.length === 0) return;
    if (firedFor.current === signature) return;

    firedFor.current = signature;
    const controller = new AbortController();
    inFlight.current = controller;
    void judge(pendingIds, controller);
  }, [signature, pendingIds, hasProfile, hasSession, judge]);

  /**
   * 떠날 때 끊는다. 안 끊으면 페이지를 빠르게 넘길 때 45초짜리 요청이 뒤에 줄줄이 남는다.
   *
   * **정리를 위 효과에 넣으면 안 된다** — `pendingIds`가 판정이 도착할 때마다 바뀌므로
   * 정리 함수가 진행 중인 스트림을 스스로 끊어버린다. 언마운트에만 걸어야 한다.
   */
  useEffect(
    () => () => {
      inFlight.current?.abort();
      // StrictMode의 두 번째 마운트에서 다시 쏠 수 있게 푼다 (진짜 언마운트면 의미 없는 줄이다).
      firedFor.current = undefined;
    },
    [],
  );

  /** 실패분만 다시. 저장되지 않은 것들이라 캐시에 걸리지 않고 그대로 재호출된다. */
  const retry = () => {
    const controller = new AbortController();
    inFlight.current = controller;
    void judge(failedIds, controller);
  };

  return (
    <>
      {/* 평소에는 비어 있는 줄이다 — 판정은 화면을 열면 알아서 붙는다 (DESIGN.md §5.1).
          버튼이 서는 경우는 하나뿐이다: 판정을 못 받아 다시 불러야 할 때 */}
      <div className="flex flex-wrap items-center gap-2">
        {!hasProfile ? (
          // 프로필이 없으면 판정하지 않는다 (F-15). **버튼이 아니라 글이다** —
          // 조건 입력으로 가는 문은 마스트헤드의 채움 버튼 하나뿐이어야 한다 (§5.1).
          <p className="text-small text-muted">
            오른쪽 위 <strong className="text-[var(--ink)]">내 조건 입력하기</strong>로 조건을 넣으면
            이 목록을 판정할 수 있습니다.
          </p>
        ) : (
          <>
            {failedIds.length > 0 && !judging ? (
              <button type="button" onClick={retry} className="btn btn-primary">
                {failedIds.length}건 다시 판정
              </button>
            ) : null}

            {!hasSession ? (
              <span className="text-micro text-muted">
                세션을 만들지 못해 판정을 쓸 수 없습니다. 목록은 그대로 보입니다.
              </span>
            ) : judging ? (
              <span className="text-micro text-muted">판정 중…</span>
            ) : note ? (
              <span className="text-micro text-muted">{note}</span>
            ) : null}
          </>
        )}
      </div>

      {/* 구분선이 아니라 여백으로 나눈다 (원칙 1) */}
      <div
        className={
          view === "tile" ? "mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" : "mt-4 grid gap-3"
        }
      >
        {ordered.map((p) => {
          const props = {
            policy: p,
            verdict: verdicts[p.id] ?? null,
            judging: judging && !verdicts[p.id],
          };
          return view === "tile" ? (
            <PolicyTile key={p.id} {...props} />
          ) : (
            <PolicyCard key={p.id} {...props} />
          );
        })}
      </div>
    </>
  );
}

/** 점수별 몇 건인지. 5점부터 적어서 "볼 게 있는지"가 맨 앞에 오게 한다. */
function summarize(verdicts: VerdictMap): string {
  const counts = new Map<Score, number>();
  for (const v of Object.values(verdicts)) {
    const s = scoreOf(v);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return ([5, 4, 3, 2, 1] as Score[])
    .filter((s) => counts.has(s))
    .map((s) => `${s}점 ${counts.get(s)}`)
    .join(" · ");
}
