"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { setLoginRequiredAction } from "@/app/admin/[[...slug]]/actions";

/**
 * 로그인 요구 ON/OFF (PRD §9.5) — 조건 입력·판정에만 적용된다. 목록 열람은 항상 열려 있다.
 *
 * 서버는 1분 TTL로 캐시해 읽으므로(`lib/settings.ts`) 이 화면 밖의 반영에는 최대 1분이 걸릴 수 있다.
 */
export function LoginRequiredToggle({
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
    const result = await setLoginRequiredAction(slug, next);
    if (result.error) {
      setError(result.error);
    } else {
      setChecked(next);
      router.refresh();
    }
    setPending(false);
  }

  return (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          role="switch"
          aria-checked={checked}
          checked={checked}
          disabled={pending}
          onChange={toggle}
        />
        <span className="text-sm">조건 입력·판정에 로그인 요구</span>
      </label>
      <span
        className={`rounded px-2 py-0.5 text-xs ${
          checked
            ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
        }`}
      >
        {checked ? "ON — 로그인 필요" : "OFF — 익명 허용"}
      </span>
      {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
      <span className="text-xs text-gray-400">반영까지 최대 1분 걸릴 수 있습니다.</span>
    </div>
  );
}
