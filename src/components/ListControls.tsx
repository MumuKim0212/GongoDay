"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { CATEGORIES, CATEGORY_LABELS, type Category } from "@/lib/sources/category";

/**
 * 목록 필터 (ARCHITECTURE §6.1)
 *
 * 상태를 URL에 둔다 — 서버 컴포넌트가 1차 필터를 걸어야 하고(§1.1), 새로고침·뒤로가기·공유가 그냥 된다.
 */
export function ListControls({
  categories,
  q,
  source,
  showAll,
  scrapsOnly,
}: {
  categories: Category[];
  q: string | null;
  source: string | null;
  showAll: boolean;
  scrapsOnly: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(q ?? "");

  function push(mutate: (p: URLSearchParams) => void) {
    const next = new URLSearchParams(params.toString());
    mutate(next);
    next.delete("page"); // 조건이 바뀌면 1페이지로 — 안 그러면 빈 페이지가 뜬다
    startTransition(() => router.push(next.toString() ? `/?${next}` : "/"));
  }

  function toggleCategory(c: Category) {
    const on = new Set(categories);
    if (on.has(c)) on.delete(c);
    else on.add(c);
    push((p) => (on.size > 0 ? p.set("cat", [...on].join(",")) : p.set("cat", "none")));
  }

  return (
    <div className={pending ? "opacity-60 transition-opacity" : "transition-opacity"}>
      <div className="flex flex-wrap gap-1.5">
        {CATEGORIES.filter((c) => c !== "etc").map((c) => {
          const on = categories.includes(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => toggleCategory(c)}
              aria-pressed={on}
              className={`rounded-full px-3 py-1 text-sm ring-1 ring-inset transition-colors ${
                on
                  ? "bg-gray-900 text-white ring-gray-900 dark:bg-white dark:text-gray-900 dark:ring-white"
                  : "bg-transparent text-gray-600 ring-gray-300 hover:bg-gray-50 dark:text-gray-400 dark:ring-gray-700 dark:hover:bg-gray-900"
              }`}
            >
              {on ? "✓ " : ""}
              {CATEGORY_LABELS[c]}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            push((p) => (text.trim() ? p.set("q", text.trim()) : p.delete("q")));
          }}
          className="flex gap-1"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="정책명 검색"
            aria-label="정책명 검색"
            className="w-44 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
          />
          <button
            type="submit"
            className="rounded border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-900"
          >
            검색
          </button>
        </form>

        <select
          value={source ?? ""}
          onChange={(e) => push((p) => (e.target.value ? p.set("source", e.target.value) : p.delete("source")))}
          aria-label="출처 필터"
          className="rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-700 dark:bg-gray-900"
        >
          <option value="">출처 전체</option>
          <option value="youth">온통청년</option>
          <option value="gov24">정부24</option>
        </select>

        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={showAll}
            onChange={(e) => push((p) => (e.target.checked ? p.set("all", "1") : p.delete("all")))}
          />
          전체 보기
        </label>

        <label className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={scrapsOnly}
            onChange={(e) => push((p) => (e.target.checked ? p.set("scrap", "1") : p.delete("scrap")))}
          />
          스크랩만 보기
        </label>
      </div>
    </div>
  );
}
