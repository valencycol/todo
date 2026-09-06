// Secrets set via `wrangler secret put` — not present in wrangler.jsonc,
// so `wrangler types` can't see them. Declared here to extend the
// generated global `Env` interface from worker-configuration.d.ts.
interface Env {
  APP_PATTERN: string;
  SESSION_SECRET: string;
  SUPERUSER_PASSWORD: string;

  // Telegram bot credentials. TELEGRAM_BOT_TOKEN comes from @BotFather;
  // TELEGRAM_WEBHOOK_SECRET is ours — Telegram echoes it back in the
  // X-Telegram-Bot-Api-Secret-Token header on every webhook call, which is
  // what proves an inbound update actually came from Telegram.
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}
