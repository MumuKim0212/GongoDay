"use client";

import { useRouter } from "next/navigation";

import { startTelegramLink } from "@/app/profile/actions";

/**
 * "텔레그램으로 연결" 버튼.
 *
 * 딥링크를 새 탭으로 연다 — 서버 액션의 리다이렉트를 그대로 쓰면 현재 탭이 t.me로 넘어가
 * 프로필로 돌아오기가 번거롭다.
 */
export function TelegramLinkButton() {
  const router = useRouter();

  async function connect() {
    const result = await startTelegramLink();
    if ("url" in result) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    } else {
      router.push(result.redirect);
    }
  }

  return (
    <button type="button" onClick={connect} className="btn btn-primary">
      텔레그램으로 연결
    </button>
  );
}
