-- Rejecting from Telegram now asks for a reason first, so the bot has to
-- remember which prompt belongs to which task while it waits for the
-- reply. NULL means no rejection is pending on that task.
ALTER TABLE tasks ADD COLUMN tg_reject_prompt_id INTEGER;
