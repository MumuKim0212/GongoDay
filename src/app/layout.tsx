import type { Metadata } from "next";
import { Noto_Serif_KR, Source_Serif_4 } from "next/font/google";
import "./globals.css";

/**
 * 세리프 페어링 (docs/DESIGN.md §2.3)
 *
 * Source Serif 4에는 한글 글리프가 없다. 라틴·숫자를 Source Serif 4가 잡고, 한글은 스택의
 * 다음 자리인 Noto Serif KR로 넘어간다 — 순서는 `globals.css`의 `--serif`가 정한다.
 *
 * `subsets`는 **프리로드 대상만** 정한다. `next/font`는 구글이 준 CSS의 모든 `@font-face`를
 * 자체 호스팅하므로(`find-font-files-in-css.js`), 한글 청크는 `korean`을 적지 않아도 내려온다.
 * 다만 프리로드는 안 되므로 첫 화면에서 한글이 잠깐 대체 서체로 보일 수 있다 (`display: swap`).
 */
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
  // 인용·강조는 진짜 이탤릭을 쓴다. 합성 기울임을 쓰지 않는다 (§2.3).
  style: ["normal", "italic"],
  display: "swap",
});

const notoSerifKr = Noto_Serif_KR({
  variable: "--font-noto-serif-kr",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "오늘공고",
  description: "오늘, 내가 신청할 수 있는 공고",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${sourceSerif.variable} ${notoSerifKr.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
