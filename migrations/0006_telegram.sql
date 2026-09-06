-- Telegram as a delivery channel alongside email.
--
-- A bot can't message someone by username or phone number — Telegram only
-- lets a bot reply to people who have started a chat with it first. So the
-- handle typed in Settings is stored as the *expected* identity, and
-- `chat_id` stays NULL until that person taps Start (matched by deep-link
-- code, by username, or by a shared contact). Only once chat_id is bound
-- can anything actually be sent.
CREATE TABLE telegram_recipients (
  assignee TEXT PRIMARY KEY,
  handle TEXT,                  -- as typed: '@alvita' or '+46701234567'
  handle_kind TEXT,             -- 'username' | 'phone' | NULL
  handle_digits TEXT,           -- phone reduced to digits, for matching shared contacts
  chat_id TEXT,                 -- bound on /start; NULL = not linked yet
  tg_username TEXT,             -- what Telegram actually reported at link time
  tg_name TEXT,
  link_code TEXT,               -- one-time deep-link payload, cleared once used
  linked_at INTEGER,
  channel TEXT NOT NULL DEFAULT 'email',  -- 'email' | 'telegram' | 'both'
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX idx_telegram_recipients_link_code ON telegram_recipients(link_code);
CREATE UNIQUE INDEX idx_telegram_recipients_chat_id ON telegram_recipients(chat_id);

-- Which Telegram message carries this task, so it can be edited in place
-- when the task is resolved (from anywhere: the buttons, the web page, or
-- a superuser edit) and so nudges can reply to the right message.
ALTER TABLE tasks ADD COLUMN tg_chat_id TEXT;
ALTER TABLE tasks ADD COLUMN tg_message_id INTEGER;

-- Overdue escalation bookkeeping. nudge_count caps the pestering;
-- nudge_last_at spaces repeats out and survives a cron run being skipped.
ALTER TABLE tasks ADD COLUMN nudge_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN nudge_last_at INTEGER;

-- The nudge sweep asks for pending tasks that have a Telegram message,
-- oldest first — this keeps that bounded by open work, not by history.
CREATE INDEX idx_tasks_nudge ON tasks(status, tg_chat_id, created_at);

-- Small key/value store for things discovered at runtime rather than
-- configured. Right now: the bot's own @username (read back from getMe at
-- setup time, so the deep link shown in Settings can never drift from the
-- token actually in use).
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
