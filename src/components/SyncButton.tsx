"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { syncAction } from "@/app/admin/[[...slug]]/actions";

/**
 * 수동 수집 트리거 (F-05) — **운영 화면 전용이다.**
 *
 * 평소 수집은 매시간 크론이 하므로 사용자는 이 버튼을 누를 일이 없다. 여기 남겨둔 이유는
 * 초기 적재처럼 지금 당장 돌려야 할 때가 있어서다.
 *
 * 한 번에 10페이지씩이라 전량을 받으려면 여러 번 눌러야 하고, 남은 페이지 수를 표시해준다.
 * 그냥 두면 크론이 몇 시간에 걸쳐 같은 일을 마저 한다.
 */
export function SyncButton({ slug }: { slug: string[] | undefined }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(source: "youth" | "gov24") {
    setBusy(source);
    setMsg(null);
    try {
      const r = await syncAction(slug, source);
      if (r.error) {
        // 수집 실패는 알리기만 한다. 기존 목록은 그대로 보인다 (§7)
        setMsg(`갱신 실패: ${r.error}`);
      } else if (r.done) {
        setMsg(`${r.upserted}건 갱신 완료`);
      } else {
        setMsg(`${r.upserted}건 저장 · ${r.totalPages - r.lastCompleted}페이지 남음 (다시 누르세요)`);
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
