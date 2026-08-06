"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { PolicyListRow } from "@/lib/policies/query";
import type { DecidedVerdict, Verdict } from "@/lib/verdict/validate";

import { PolicyCard } from "./PolicyCard";

/**
 * 판정 버튼 + 목록 (ARCHITECTURE §6.1)
 *
 * 판정 결과를 클라이언트 상태로 들고 있어야 하는 이유는 **실패 경로 때문이다.** 라우트 타임아웃분은
 * 저장하지 않으므로(§5.2) `router.refresh()`로 서버에서 다시 읽으면 화면에 아무것도 안 나타난다.
 * 저장된 판정은 서버가 목록과 함께 읽어 `initialVerdicts`로 내려준다 — 다시 눌러도 호출이 0건이다.
 */

/** 라우트 상한(60초)보다 짧게 잡는다. 넘기면 요청분을 '애매'로 끝내고 화면을 돌려준다 (§7) */
const CLIENT_TIMEOUT_MS = 45_000;

/** 판정 후 **현재 페이지 안에서만** 다시 정렬한다 (§6.1). 미판정은 '아님'보다 앞이다. */
const RANK: Record<Verdict, number> = { eligible: 0, unclear: 1, ineligible: 3 };
const UNJUDGED_RANK = 2;

const VERDICT_NAME: Record<Verdict, string> = {
  eligible: "해당",
  unclear: "애매",
  ineligible: "아님",
};

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
  const [verdicts, setVerdicts] = useState<VerdictMap>(initialVerdicts);
  const [judging, setJudging] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // 정렬은 판정이 하나라도 있을 때만. 정렬 자체는 안정 정렬이라 동률은 최신순(서버 정렬) 그대로다.
  const ordered = useMemo(() => {
    const rank = (id: string) => {
      const v = verdicts[id];
      return v ? RANK[v.verdict] : UNJUDGED_RANK;
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
      <div className="flex flex-wrap items-center gap-2">
        {hasProfile ? (
          <button
            type="button"
            onClick={judge}
            disabled={judging || !hasSession}
            className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50 dark:bg-white dark:text-gray-900"
          >
            {judging ? "판정 중…" : `이 페이지 ${rows.length}건 판정하기`}
          </button>
        ) : (
          // 프로필이 없으면 판정 버튼 대신 안내 (F-15)
          <Link
            href="/profile"
            className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white hover:opacity-90 dark:bg-white dark:text-gray-900"
          >
            내 조건 입력하고 판정받기
          </Link>
        )}

        {!hasSession ? (
          <span className="text-xs text-gray-600 dark:text-gray-400">
            세션을 만들지 못해 판정을 쓸 수 없습니다. 목록은 그대로 보입니다.
          </span>
        ) : note ? (
          <span className="text-xs text-gray-600 dark:text-gray-400">{note}</span>
        ) : null}
      </div>

      <div className="mt-3 border-t border-gray-200 dark:border-gray-800">
        {ordered.map((p) => (
          <PolicyCard
            key={p.id}
            policy={p}
            verdict={verdicts[p.id] ?? null}
            judging={judging && !verdicts[p.id]}
          />
        ))}
      </div>
    </>
  );
}

function summarize(verdicts: VerdictMap): string {
  const counts = { eligible: 0, unclear: 0, ineligible: 0 };
  for (const v of Object.values(verdicts)) counts[v.verdict]++;
  return (Object.keys(counts) as Verdict[])
    .filter((k) => counts[k] > 0)
    .map((k) => `${VERDICT_NAME[k]} ${counts[k]}`)
    .join(" · ");
}
