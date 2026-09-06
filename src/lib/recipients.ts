import type { Assignee } from "./assignees";

export type DeliveryChannel = "email" | "telegram" | "both";
export type HandleKind = "username" | "phone";

export interface TelegramRecipient {
  assignee: string;
  handle: string | null;
  handle_kind: HandleKind | null;
  handle_digits: string | null;
  chat_id: string | null;
  tg_username: string | null;
  tg_name: string | null;
  link_code: string | null;
  linked_at: number | null;
  channel: DeliveryChannel;
  updated_at: number;
}

export const DELIVERY_CHANNELS: DeliveryChannel[] = ["email", "telegram", "both"];

function randomCode(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  // Deep-link payloads allow only A-Z a-z 0-9 _ - and max 64 chars.
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Digits only, so '+46 70-123 45 67' and '0046701234567' compare equal. */
export function phoneDigits(value: string): string {
  return value.replace(/\D/g, "").replace(/^00/, "");
}

export interface ParsedHandle {
  handle: string;
  kind: HandleKind;
  digits: string | null;
}

/**
 * Accepts either a Telegram @username or a phone number and normalizes it.
 * Returns null for anything that is neither — better to reject at the form
 * than to store a handle that can never match a real account.
 */
export function parseHandle(raw: string): ParsedHandle | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^[+0-9][0-9\s().-]*$/.test(value)) {
    const digits = phoneDigits(value);
    // Country code + subscriber number; shorter than 8 is a typo, longer
    // than 15 exceeds E.164.
    if (digits.length < 8 || digits.length > 15) return null;
    return { handle: `+${digits}`, kind: "phone", digits };
  }

  const username = value.replace(/^@/, "").replace(/^(?:https?:\/\/)?t\.me\//, "");
  if (/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(username)) {
    return { handle: `@${username}`, kind: "username", digits: null };
  }

  return null;
}

export async function getRecipients(db: D1Database): Promise<TelegramRecipient[]> {
  const { results } = await db.prepare("SELECT * FROM telegram_recipients").all<TelegramRecipient>();
  return results;
}

export async function getRecipient(db: D1Database, assignee: string): Promise<TelegramRecipient | null> {
  const row = await db
    .prepare("SELECT * FROM telegram_recipients WHERE assignee = ?")
    .bind(assignee)
    .first<TelegramRecipient>();
  return row ?? null;
}

export async function getRecipientByChatId(db: D1Database, chatId: string): Promise<TelegramRecipient | null> {
  const row = await db
    .prepare("SELECT * FROM telegram_recipients WHERE chat_id = ?")
    .bind(chatId)
    .first<TelegramRecipient>();
  return row ?? null;
}

/**
 * Stores (or replaces) the handle for an assignee and issues a fresh
 * one-time link code. Changing the handle deliberately clears any existing
 * chat_id: if you point the slot at a different person, the old chat must
 * stop receiving that person's tasks immediately.
 */
export async function setHandle(db: D1Database, assignee: string, parsed: ParsedHandle): Promise<TelegramRecipient> {
  const now = Date.now();
  const existing = await getRecipient(db, assignee);
  const keepLink = existing?.chat_id && existing.handle === parsed.handle;

  await db
    .prepare(
      `INSERT INTO telegram_recipients
         (assignee, handle, handle_kind, handle_digits, chat_id, tg_username, tg_name, link_code, linked_at, channel, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT channel FROM telegram_recipients WHERE assignee = ?), 'email'), ?)
       ON CONFLICT(assignee) DO UPDATE SET
         handle = excluded.handle,
         handle_kind = excluded.handle_kind,
         handle_digits = excluded.handle_digits,
         chat_id = excluded.chat_id,
         tg_username = excluded.tg_username,
         tg_name = excluded.tg_name,
         link_code = excluded.link_code,
         linked_at = excluded.linked_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      assignee,
      parsed.handle,
      parsed.kind,
      parsed.digits,
      keepLink ? existing!.chat_id : null,
      keepLink ? existing!.tg_username : null,
      keepLink ? existing!.tg_name : null,
      randomCode(),
      keepLink ? existing!.linked_at : null,
      assignee,
      now,
    )
    .run();

  return (await getRecipient(db, assignee))!;
}

/** Drops the handle and the binding — that person goes back to email only. */
export async function clearRecipient(db: D1Database, assignee: string): Promise<void> {
  await db
    .prepare(
      `UPDATE telegram_recipients
       SET handle = NULL, handle_kind = NULL, handle_digits = NULL, chat_id = NULL,
           tg_username = NULL, tg_name = NULL, link_code = NULL, linked_at = NULL,
           channel = 'email', updated_at = ?
       WHERE assignee = ?`,
    )
    .bind(Date.now(), assignee)
    .run();
}

export async function setChannel(db: D1Database, assignee: string, channel: DeliveryChannel): Promise<void> {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO telegram_recipients (assignee, channel, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(assignee) DO UPDATE SET channel = excluded.channel, updated_at = excluded.updated_at`,
    )
    .bind(assignee, channel, now)
    .run();
}

/**
 * Binds a live chat to an assignee slot. Called from the webhook once we
 * know which slot a /start belongs to. The chat_id index is unique, so a
 * chat already bound elsewhere is moved rather than duplicated.
 */
export async function bindChat(
  db: D1Database,
  assignee: string,
  chatId: string,
  tgUsername: string | null,
  tgName: string | null,
): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.prepare("UPDATE telegram_recipients SET chat_id = NULL WHERE chat_id = ?").bind(chatId),
    db
      .prepare(
        `UPDATE telegram_recipients
         SET chat_id = ?, tg_username = ?, tg_name = ?, link_code = NULL, linked_at = ?,
             channel = CASE WHEN channel = 'email' THEN 'telegram' ELSE channel END,
             updated_at = ?
         WHERE assignee = ?`,
      )
      .bind(chatId, tgUsername, tgName, now, now, assignee),
  ]);
}

export async function unlinkChat(db: D1Database, assignee: string): Promise<void> {
  await db
    .prepare(
      `UPDATE telegram_recipients
       SET chat_id = NULL, tg_username = NULL, tg_name = NULL, link_code = NULL,
           linked_at = NULL, channel = 'email', updated_at = ?
       WHERE assignee = ?`,
    )
    .bind(Date.now(), assignee)
    .run();
}

/**
 * Which slot an inbound /start belongs to, in order of confidence: the
 * one-time code from the deep link, then an exact @username match against
 * a configured handle. (Phone matching happens separately — it needs the
 * person to actively share their contact card.)
 */
export async function findSlotForStart(
  db: D1Database,
  code: string | null,
  tgUsername: string | null,
): Promise<TelegramRecipient | null> {
  if (code) {
    const byCode = await db
      .prepare("SELECT * FROM telegram_recipients WHERE link_code = ?")
      .bind(code)
      .first<TelegramRecipient>();
    if (byCode) return byCode;
  }

  if (tgUsername) {
    const byName = await db
      .prepare("SELECT * FROM telegram_recipients WHERE handle_kind = 'username' AND LOWER(handle) = ?")
      .bind(`@${tgUsername.toLowerCase()}`)
      .first<TelegramRecipient>();
    if (byName) return byName;
  }

  return null;
}

export async function findSlotForPhone(db: D1Database, digits: string): Promise<TelegramRecipient | null> {
  const row = await db
    .prepare("SELECT * FROM telegram_recipients WHERE handle_kind = 'phone' AND handle_digits = ?")
    .bind(digits)
    .first<TelegramRecipient>();
  return row ?? null;
}

export interface AssigneeDelivery extends Assignee {
  telegram: TelegramRecipient | null;
}

/** Merges the static assignee list with whatever Telegram state exists. */
export async function getDeliveryTargets(db: D1Database, assignees: Assignee[]): Promise<AssigneeDelivery[]> {
  const recipients = await getRecipients(db);
  const byAssignee = new Map(recipients.map((r) => [r.assignee, r]));
  return assignees.map((a) => ({ ...a, telegram: byAssignee.get(a.key) ?? null }));
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .bind(key, value, Date.now())
    .run();
}
