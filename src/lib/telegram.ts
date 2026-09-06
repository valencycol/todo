/**
 * Thin Telegram Bot API client.
 *
 * Every call fails soft (returns null after logging) rather than throwing:
 * a Telegram outage, a revoked bot token, or someone who blocked the bot
 * must never take down list creation or a task resolve — those are already
 * committed to D1 by the time we get here, and D1 stays the source of truth.
 */

const API_BASE = "https://api.telegram.org/bot";

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface SentMessage {
  message_id: number;
  chat: { id: number };
}

export function isTelegramConfigured(env: Env): boolean {
  return Boolean(env.TELEGRAM_BOT_TOKEN);
}

async function call<T>(env: Env, method: string, payload: Record<string, unknown>): Promise<T | null> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.warn(`telegram: ${method} skipped — TELEGRAM_BOT_TOKEN is not set`);
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { ok: boolean; result?: T; description?: string };
    if (!body.ok) {
      console.warn(`telegram: ${method} failed — ${body.description ?? res.status}`);
      return null;
    }
    return body.result ?? null;
  } catch (err) {
    console.warn(`telegram: ${method} threw`, err);
    return null;
  }
}

/** Telegram's HTML parse mode only reserves these three. */
export function tgEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface SendOptions {
  buttons?: InlineButton[][];
  replyToMessageId?: number;
  /** Silent delivery — lands in the chat without buzzing the phone. */
  silent?: boolean;
  keyboard?: Record<string, unknown>;
}

export async function sendMessage(
  env: Env,
  chatId: string,
  htmlText: string,
  opts: SendOptions = {},
): Promise<SentMessage | null> {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: htmlText,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  };
  if (opts.buttons) payload.reply_markup = { inline_keyboard: opts.buttons };
  if (opts.keyboard) payload.reply_markup = opts.keyboard;
  if (opts.replyToMessageId) {
    payload.reply_parameters = { message_id: opts.replyToMessageId, allow_sending_without_reply: true };
  }
  if (opts.silent) payload.disable_notification = true;

  return call<SentMessage>(env, "sendMessage", payload);
}

export async function editMessage(
  env: Env,
  chatId: string,
  messageId: number,
  htmlText: string,
  buttons?: InlineButton[][],
): Promise<void> {
  await call(env, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: htmlText,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: buttons ?? [] },
  });
}

/**
 * Telegram spins the button until this is called, so it has to happen on
 * every callback_query — including ones we reject.
 */
export async function answerCallback(env: Env, callbackQueryId: string, text?: string): Promise<void> {
  await call(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: false } : {}),
  });
}

export async function setWebhook(env: Env, url: string, secret: string): Promise<{ ok: boolean; error?: string }> {
  const result = await call<boolean>(env, "setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  return result === true ? { ok: true } : { ok: false, error: "Telegram rejected the webhook registration." };
}

export interface BotInfo {
  id: number;
  username: string;
  first_name: string;
}

export async function getBotInfo(env: Env): Promise<BotInfo | null> {
  return call<BotInfo>(env, "getMe", {});
}
