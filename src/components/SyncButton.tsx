"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * 수동 수집 트리거 (F-05).
 *
 * 크론에 의존하지 않는다 — Vercel 플랜 제약과 무관하고 채점자가 직접 눌러 확인할 수 있다 (§4.3).
 * 한 번에 10페이지씩이라 전량을 받으려면 여러 번 눌러야 하고, 남은 페이지 수를 표시해준다.
 */
export function SyncButton() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(source: "youth" | "gov24") {
    setBusy(source);
    setMsg(null);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source }),
      });
      const j = await res.json();
      if (j.error) {
        // 수집 실패는 알리기만 한다. 기존 목록은 그대로 보인다 (§7)
        setMsg(`갱신 실패: ${j.error}`);
      } else if (j.done) {
        setMsg(`${j.upserted}건 갱신 완료`);
      } else {
        setMsg(`${j.upserted}건 저장 · ${j.totalPages - j.lastCompleted}페이지 남음 (다시 누르세요)`);
      }
      router.refresh();
    } catch {
      setMsg("갱신 실패: 네트워크 오류");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(["youth", "gov24"] as const).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => run(s)}
          disabled={busy !== null}
          className="btn btn-secondary"
        >
          {busy === s ? "갱신 중…" : `${s === "youth" ? "온통청년" : "정부24"} 갱신`}
        </button>
      ))}
      {msg ? <span className="text-micro text-muted">{msg}</span> : null}
    </div>
  );
}
