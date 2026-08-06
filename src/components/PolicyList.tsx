"use client";

import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import type { PolicyListRow } from "@/lib/policies/query";
import { parseView } from "@/lib/policies/view";
import { scoreOf, type Score } from "@/lib/verdict/score";
import type { DecidedVerdict } from "@/lib/verdict/validate";

import { PolicyCard } from "./PolicyCard";
import { PolicyTile } from "./PolicyTile";

/**
 * 판정 버튼 + 목록 (ARCHITECTURE §6.1)
 *
 * 판정 결과를 클라이언트 상태로 들고 있어야 하는 이유는 **실패 경로 때문이다.** 라우트 타임아웃분은
 * 저장하지 않으므로(§5.2) `router.refresh()`로 서버에서 다시 읽으면 화면에 아무것도 안 나타난다.
 * 저장된 판정은 서버가 목록과 함께 읽어 `initialVerdicts`로 내려준다 — 다시 눌러도 호출이 0건이다.
 */

/** 라우트 상한(60초)보다 짧게 잡는다. 넘기면 요청분을 '애매'로 끝내고 화면을 돌려준다 (§7) */
const CLIENT_TIMEOUT_MS = 45_000;

/**
 * 판정 후 **현재 페이지 안에서만** 다시 정렬한다 (§6.1). 점수가 높은 것부터다.
 * 미판정은 '조건 미기재'(2점)보다 뒤, '아님'(1점)보다 앞이다 — 아직 모르는 것을 확정된 탈락보다
 * 뒤로 보낼 이유는 없다.
 */
const UNJUDGED_RANK = 3.5;

type VerdictMap = Record<string, DecidedVerdict>;

export function PolicyList({
  rows,
  initialVerdicts,
  hasSession,
  hasProfile,
}: {
  rows: PolicyListRow[];
  initialVerdicts: VerdictMap;
  hasSession: boolean;
  hasProfile: boolean;
}) {
  // 보기 방식은 주소에서 읽는다 — `ViewToggle`이 `pushState`로 주소만 갈아끼우므로
  // 서버를 다시 부르지 않고 이 훅이 다시 읽힌다 (§5.1). 상태를 여기 두면 토글과 어긋난다.
  const view = parseView(useSearchParams().get("view"));

  const [verdicts, setVerdicts] = useState<VerdictMap>(initialVerdicts);
  const [judging, setJudging] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // 정렬은 판정이 하나라도 있을 때만. 정렬 자체는 안정 정렬이라 동률은 최신순(서버 정렬) 그대로다.
  const ordered = useMemo(() => {
    const rank = (id: string) => {
      const v = verdicts[id];
      return v ? 5 - scoreOf(v) : UNJUDGED_RANK;
    };
    return [...rows].sort((a, b) => rank(a.id) - rank(b.id));
  }, [rows, verdicts]);

  async function judge() {
    setJudging(true);
    setNote(null);

    const ids = rows.map((r) => r.id);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);

    try {
      const res = await fetch("/api/verdicts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policyIds: ids }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        verdicts?: VerdictMap;
        error?: string;
      };

      if (!res.ok || !body.verdicts) {
        // 세션 없음·프로필 없음·조회 실패. 결과가 없으므로 카드는 건드리지 않는다.
        setNote(body.error ?? "판정하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }

      const next = body.verdicts;
      setVerdicts((prev) => ({ ...prev, ...next }));
      setNote(summarize(next));
    } catch {
      // 라우트 전체 타임아웃·네트워크 실패 (§7). 저장하지 않았으므로 다시 누르면 재시도된다.
      // **이미 받은 판정은 덮지 않는다** — 실패가 알던 것까지 지우면 화면이 더 나빠진다.
      setVerdicts((prev) => {
        const filled = { ...prev };
        for (const id of ids) {
          if (!filled[id]) {
            filled[id] = {
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
          }
        }
        return filled;
      });
      setNote("판정이 오래 걸려 끝내지 못했습니다. 다시 눌러 주세요.");
    } finally {
      clearTimeout(timer);
      setJudging(false);
    }
  }

  return (
    <>
      {/* 이 화면의 유일한 채움 버튼이다 (DESIGN.md §5.1) — 다음에 할 일이 하나뿐임을 색으로 말한다 */}
      <div className="flex flex-wrap items-center gap-2">
        {hasProfile ? (
          <button type="button" onClick={judge} disabled={judging || !hasSession} className="btn btn-primary">
            {judging ? "판정 중…" : `이 페이지 ${rows.length}건 판정하기`}
          </button>
        ) : (
          // 프로필이 없으면 판정 버튼 대신 안내 (F-15). **버튼이 아니라 글이다** —
          // 조건 입력으로 가는 문은 마스트헤드의 채움 버튼 하나뿐이어야 한다 (§5.1).
          <p className="text-small text-muted">
            오른쪽 위 <strong className="text-[var(--ink)]">내 조건 입력하기</strong>로 조건을 넣으면
            이 목록을 판정할 수 있습니다.
          </p>
        )}

        {!hasSession ? (
          <span className="text-micro text-muted">
            세션을 만들지 못해 판정을 쓸 수 없습니다. 목록은 그대로 보입니다.
          </span>
        ) : note ? (
          <span className="text-micro text-muted">{note}</span>
        ) : null}
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
