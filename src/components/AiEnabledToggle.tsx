"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { setAiEnabledAction } from "@/app/admin/[[...slug]]/actions";

/**
 * AI 판정 ON/OFF — 텔레그램 필터링(`/api/notify`)과 적합도 체크(`/api/verdicts`) 양쪽에 적용된다.
 * 코드 게이트로 답이 나오는 건은 이 토글과 무관하게 그대로 처리된다.
 *
 * 서버는 1분 TTL로 캐시해 읽으므로(`lib/settings.ts`) 이 화면 밖의 반영에는 최대 1분이 걸릴 수 있다.
 */
export function AiEnabledToggle({
  slug,
  initial,
}: {
  slug: string[] | undefined;
  initial: boolean;
}) {
  const router = useRouter();
  const [checked, setChecked] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const next = !checked;
    setPending(true);
    setError(null);
    const result = await setAiEnabledAction(slug, next);
    if (result.error) {
      setError(result.error);
    } else {
      setChecked(next);
      router.refresh();
    }
    setPending(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={pending}
          onChange={toggle}
        />
        <span className="text-sm">AI 판정 사용</span>
      </label>
      <span
        className={`rounded px-2 py-0.5 text-xs ${
          checked
            ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
            : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
        }`}
      >
        {checked ? "ON — AI 호출" : "OFF — 코드 게이트만 사용"}
      </span>
      {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
      <span className="text-xs text-gray-400">반영까지 최대 1분 걸릴 수 있습니다.</span>
    </div>
  );
}
