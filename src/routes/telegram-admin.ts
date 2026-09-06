import { Hono } from "hono";
import { getAssignees } from "../lib/assignees";
import {
  clearRecipient,
  DELIVERY_CHANNELS,
  getRecipient,
  getSetting,
  parseHandle,
  setChannel,
  setHandle,
  setSetting,
  unlinkChat,
  type DeliveryChannel,
} from "../lib/recipients";
import { getBotInfo, isTelegramConfigured, sendMessage, setWebhook, tgEscape } from "../lib/telegram";
import { getPolicy } from "../lib/escalation";

export const telegramAdminRoutes = new Hono<{ Bindings: Env }>();

const BOT_USERNAME_KEY = "telegram_bot_username";

/**
 * The bot's @username is read back from getMe rather than configured, so
 * the invite links shown in Settings can never point at a different bot
 * than the token in use. Cached in app_settings because getMe is a network
 * round-trip we don't want on every Settings render.
 */
async function botUsername(env: Env, db: D1Database): Promise<string | null> {
  const cached = await getSetting(db, BOT_USERNAME_KEY);
  if (cached) return cached;

  const info = await getBotInfo(env);
  if (!info?.username) return null;
  await setSetting(db, BOT_USERNAME_KEY, info.username);
  return info.username;
}

function inviteLink(bot: string | null, code: string | null): string | null {
  return bot && code ? `https://t.me/${bot}?start=${code}` : null;
}

async function statusPayload(env: Env, db: D1Database) {
  const bot = await botUsername(env, db);
  const policy = getPolicy(env);

  const assignees = await Promise.all(
    getAssignees(env).map(async (assignee) => {
      const recipient = await getRecipient(db, assignee.key);
      return {
        key: assignee.key,
        name: assignee.name,
        email: assignee.email,
        emailEnabled: assignee.enabled,
        handle: recipient?.handle ?? null,
        handleKind: recipient?.handle_kind ?? null,
        channel: (recipient?.channel ?? "email") as DeliveryChannel,
        linked: Boolean(recipient?.chat_id),
        telegramName: recipient?.tg_name ?? null,
        telegramUsername: recipient?.tg_username ?? null,
        linkedAt: recipient?.linked_at ?? null,
        inviteLink: recipient?.chat_id ? null : inviteLink(bot, recipient?.link_code ?? null),
      };
    }),
  );

  return {
    configured: isTelegramConfigured(env),
    botUsername: bot,
    webhookUrl: `${env.SITE_URL}/telegram/webhook`,
    nudges: { hours: policy.hours, maxNudges: policy.maxNudges, quiet: policy.quiet },
    assignees,
  };
}

telegramAdminRoutes.get("/api/telegram", async (c) => {
  return c.json(await statusPayload(c.env, c.env.DB));
});

function knownAssignee(env: Env, key: unknown): string | null {
  const found = getAssignees(env).find((a) => a.key === key);
  return found ? found.key : null;
}

telegramAdminRoutes.post("/api/telegram/handle", async (c) => {
  const body = await c.req.json<{ assignee?: unknown; handle?: unknown }>()
    .catch(() => ({}) as { assignee?: unknown; handle?: unknown });
  const assignee = knownAssignee(c.env, body.assignee);
  if (!assignee) return c.json({ error: "Unknown person." }, 400);

  const parsed = parseHandle(String(body.handle ?? ""));
  if (!parsed) {
    return c.json({ error: "Enter a Telegram @username or a phone number with country code." }, 400);
  }

  await setHandle(c.env.DB, assignee, parsed);
  return c.json({ ok: true, ...(await statusPayload(c.env, c.env.DB)) });
});

telegramAdminRoutes.post("/api/telegram/channel", async (c) => {
  const body = await c.req.json<{ assignee?: unknown; channel?: unknown }>()
    .catch(() => ({}) as { assignee?: unknown; channel?: unknown });
  const assignee = knownAssignee(c.env, body.assignee);
  if (!assignee) return c.json({ error: "Unknown person." }, 400);

  const channel = body.channel as DeliveryChannel;
  if (!DELIVERY_CHANNELS.includes(channel)) return c.json({ error: "Unknown channel." }, 400);

  // Refusing to arm an unlinked Telegram channel here is what stops a list
  // from being silently "sent" into a chat that doesn't exist yet.
  if (channel !== "email") {
    const recipient = await getRecipient(c.env.DB, assignee);
    if (!recipient?.chat_id) {
      return c.json({ error: "They need to open the invite link and tap Start first." }, 400);
    }
  }

  await setChannel(c.env.DB, assignee, channel);
  return c.json({ ok: true, ...(await statusPayload(c.env, c.env.DB)) });
});

telegramAdminRoutes.post("/api/telegram/unlink", async (c) => {
  const body = await c.req.json<{ assignee?: unknown; forget?: unknown }>()
    .catch(() => ({}) as { assignee?: unknown; forget?: unknown });
  const assignee = knownAssignee(c.env, body.assignee);
  if (!assignee) return c.json({ error: "Unknown person." }, 400);

  if (body.forget === true) await clearRecipient(c.env.DB, assignee);
  else await unlinkChat(c.env.DB, assignee);

  return c.json({ ok: true, ...(await statusPayload(c.env, c.env.DB)) });
});

telegramAdminRoutes.post("/api/telegram/test", async (c) => {
  const body = await c.req.json<{ assignee?: unknown }>().catch(() => ({}) as { assignee?: unknown });
  const assignee = knownAssignee(c.env, body.assignee);
  if (!assignee) return c.json({ error: "Unknown person." }, 400);

  const recipient = await getRecipient(c.env.DB, assignee);
  if (!recipient?.chat_id) return c.json({ error: "Not linked yet." }, 400);

  const sent = await sendMessage(
    c.env,
    recipient.chat_id,
    `🔔 Test message from <b>${tgEscape(c.env.FROM_NAME)}</b>. If you can read this, delivery works.`,
  );
  return sent ? c.json({ ok: true }) : c.json({ error: "Telegram didn't accept the message." }, 502);
});

/**
 * Registers the webhook with Telegram and caches the bot's username.
 * Exposed as a button in Settings so the whole setup can be done from the
 * app rather than from a terminal with curl.
 */
telegramAdminRoutes.post("/api/telegram/setup", async (c) => {
  if (!isTelegramConfigured(c.env)) {
    return c.json({ error: "TELEGRAM_BOT_TOKEN isn't set. Add it with `wrangler secret put`." }, 400);
  }
  if (!c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.json({ error: "TELEGRAM_WEBHOOK_SECRET isn't set. Add it with `wrangler secret put`." }, 400);
  }

  const info = await getBotInfo(c.env);
  if (!info?.username) {
    return c.json({ error: "Telegram rejected the bot token." }, 502);
  }
  await setSetting(c.env.DB, BOT_USERNAME_KEY, info.username);

  const url = `${c.env.SITE_URL}/telegram/webhook`;
  const result = await setWebhook(c.env, url, c.env.TELEGRAM_WEBHOOK_SECRET);
  if (!result.ok) return c.json({ error: result.error ?? "Webhook registration failed." }, 502);

  return c.json({ ok: true, ...(await statusPayload(c.env, c.env.DB)) });
});
