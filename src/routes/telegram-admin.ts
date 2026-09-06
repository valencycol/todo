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
import {
  getBotInfo,
  getWebhookInfo,
  isTelegramConfigured,
  sendMessage,
  setWebhook,
  tgEscape,
} from "../lib/telegram";
import { sendTestEmail } from "../lib/email";
import { getAssignees as listAssignees } from "../lib/assignees";

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

/**
 * Telegram's own view of the webhook, reduced to what Settings renders.
 * `matches` is the important one: a webhook pointing at a stale URL (an
 * old SITE_URL, or another environment's) looks "registered" but delivers
 * nothing here.
 */
async function webhookHealth(env: Env, expectedUrl: string) {
  if (!isTelegramConfigured(env)) return null;

  const info = await getWebhookInfo(env);
  if (!info) return null;

  return {
    url: info.url || null,
    registered: Boolean(info.url),
    matches: info.url === expectedUrl,
    pending: info.pending_update_count ?? 0,
    lastError: info.last_error_message ?? null,
    lastErrorAt: info.last_error_date ? info.last_error_date * 1000 : null,
  };
}

async function statusPayload(env: Env, db: D1Database) {
  const bot = await botUsername(env, db);

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

  const webhookUrl = `${env.SITE_URL}/telegram/webhook`;

  return {
    configured: isTelegramConfigured(env),
    botUsername: bot,
    webhookUrl,
    webhook: await webhookHealth(env, webhookUrl),
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

/**
 * Sends a test through whatever channels this person is actually set to
 * receive on — not just Telegram. A test that always used Telegram made
 * the channel picker look broken: switching to "Email only" still made a
 * Telegram message appear.
 */
telegramAdminRoutes.post("/api/telegram/test", async (c) => {
  const body = await c.req.json<{ assignee?: unknown }>().catch(() => ({}) as { assignee?: unknown });
  const key = knownAssignee(c.env, body.assignee);
  if (!key) return c.json({ error: "Unknown person." }, 400);

  const person = listAssignees(c.env).find((a) => a.key === key)!;
  const recipient = await getRecipient(c.env.DB, key);
  const channel = recipient?.chat_id ? recipient.channel : "email";

  const sentVia: string[] = [];
  const problems: string[] = [];

  if (channel === "telegram" || channel === "both") {
    const sent = await sendMessage(
      c.env,
      recipient!.chat_id!,
      `🔔 Test message from <b>${tgEscape(c.env.FROM_NAME)}</b>. If you can read this, Telegram delivery works.`,
    );
    if (sent) sentVia.push("Telegram");
    else problems.push("Telegram didn't accept the message.");
  }

  if (channel === "email" || channel === "both") {
    try {
      await sendTestEmail(c.env, person.email);
      sentVia.push("email");
    } catch (err) {
      console.warn("telegram: test email failed", err);
      problems.push(`Email to ${person.email} failed — check it's a verified destination address.`);
    }
  }

  if (sentVia.length === 0) {
    return c.json({ error: problems.join(" ") || "Nothing could be sent." }, 502);
  }

  return c.json({ ok: true, sentVia, problems });
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

  // Only clear the backlog on a genuine first registration — re-clicking
  // the button must not discard a button press someone just made.
  const existing = await getWebhookInfo(c.env);
  const isFirstRegistration = !existing?.url;

  const result = await setWebhook(c.env, url, c.env.TELEGRAM_WEBHOOK_SECRET, isFirstRegistration);
  if (!result.ok) return c.json({ error: result.error ?? "Webhook registration failed." }, 502);

  return c.json({
    ok: true,
    registered: true,
    firstRegistration: isFirstRegistration,
    ...(await statusPayload(c.env, c.env.DB)),
  });
});
