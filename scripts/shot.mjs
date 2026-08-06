/**
 * 화면 스크린샷 — 눈으로 확인하고 제출물에도 쓴다.
 *
 *   npm run dev
 *   node scripts/shot.mjs <출력폴더> <경로>...
 *   node scripts/shot.mjs shots "/" "/?cat=none"
 *
 * 텍스트만 긁어서는 레이아웃이 깨졌는지, 다크모드에서 글자가 안 보이는지 알 수 없다.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [outDir = "shots", ...paths] = process.argv.slice(2);
const targets = paths.length > 0 ? paths : ["/"];
const base = process.env.BASE_URL ?? "http://localhost:3000";

fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });

for (const target of targets) {
  const url = base + target;
  const res = await page.goto(url, { waitUntil: "networkidle" });
  const name = (target.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "home") + ".png";
  const file = path.join(outDir, name);
  await page.screenshot({ path: file, fullPage: true });

  const cards = await page.locator("article").count();
  console.log(`${String(res?.status()).padEnd(4)} ${target.padEnd(26)} 카드 ${String(cards).padStart(2)}  → ${file}`);
}

await browser.close();
