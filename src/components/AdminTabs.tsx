"use client";

import { useState } from "react";

/**
 * 운영 화면 섹션을 탭으로 나눈다. 데이터는 서버가 한 번에 다 읽어 각 탭의 `content`로 넘기고,
 * 여기서는 어떤 탭을 보여줄지만 클라이언트 상태로 고른다 — 탭을 눌러도 서버를 다시 부르지 않는다.
 */
export function AdminTabs({ tabs }: { tabs: { key: string; label: string; content: React.ReactNode }[] }) {
  const [active, setActive] = useState(tabs[0]?.key);

  return (
    <div className="mt-6">
      <nav aria-label="운영 화면 메뉴" className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-800">
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              aria-current={on ? "true" : undefined}
              className={`-mb-px rounded-t px-3 py-2 text-sm font-medium ${
                on
                  ? "border-x border-t border-gray-200 border-b-white text-gray-900 dark:border-gray-800 dark:border-b-gray-950 dark:text-white"
                  : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tabs.map((t) => (
        <div key={t.key} hidden={t.key !== active}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
