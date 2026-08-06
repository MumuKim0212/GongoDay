import type { Metadata } from "next";
import { Noto_Sans_KR, Source_Sans_3 } from "next/font/google";
import "./globals.css";

/**
 * 산세리프 페어링 (docs/DESIGN.md §2.3)
 *
 * **서체는 하나의 산세리프 페어링이다** (§1 원칙 2). Source Sans 3은 Source Serif 4의
 * 산세리프 형제라 자폭·리듬이 같은 계열이고, 한글은 Noto Sans KR이 받는다.
 *
 * Source Sans 3에는 한글 글리프가 없다. 라틴·숫자를 Source Sans 3이 잡고, 한글은 스택의
 * 다음 자리인 Noto Sans KR로 넘어간다 — 순서는 `globals.css`의 `--sans`가 정한다.
 *
 * `subsets`는 **프리로드 대상만** 정한다. `next/font`는 구글이 준 CSS의 모든 `@font-face`를
 * 자체 호스팅하므로(`find-font-files-in-css.js`), 한글 청크는 `korean`을 적지 않아도 내려온다.
 * 다만 프리로드는 안 되므로 첫 화면에서 한글이 잠깐 대체 서체로 보일 수 있다 (`display: swap`).
 *
 * **이탤릭 페이스를 싣지 않는다.** 세리프 때는 인용·강조를 진짜 이탤릭으로 했지만, 강조할
 * 구절이 대부분 한글이고 한글 산세리프에 이탤릭 페이스는 없다 — 실을 이유가 없다. 강조는 굵기다.
 */
const sourceSans = Source_Sans_3({
  variable: "--font-source-sans",
  subsets: ["latin"],
  display: "swap",
});

const notoSansKr = Noto_Sans_KR({
  variable: "--font-noto-sans-kr",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "오늘공고",
  description: "오늘, 내가 신청할 수 있는 공고",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${sourceSans.variable} ${notoSansKr.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
