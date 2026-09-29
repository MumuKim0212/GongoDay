/**
 * 텔레그램 봇 웹훅을 등록한다. 배포 URL이 정해진 뒤 운영자가 한 번 실행한다.
 *
 *   node scripts/telegram-set-webhook.mjs
 *
 * `.env.local`의 TELEGRAM_BOT_TOKEN·TELEGRAM_WEBHOOK_SECRET을 읽어
 * `https://<SYNC_URL>/api/telegram/webhook`을 setWebhook으로 등록한다.
 * 시크릿을 같이 등록해야 웹훅 라우트가 `X-Telegram-Bot-Api-Secret-Token` 헤더로 검증할 수 있다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const env = Object.fromEntries(
  fs
    .readFileSync(path.join(repoRoot, ".env.local"), "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);

const siteUrl = process.env.SYNC_URL ?? "https://gongoday.vercel.app";
const webhookUrl = `${siteUrl}/api/telegram/webhook`;

const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
  }),
});

const body = await res.json();
console.log(JSON.stringify(body, null, 2));
if (!body.ok) process.exit(1);
