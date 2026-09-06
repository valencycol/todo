import type { Assignee } from "./assignees";
import type { TaskRow } from "./db";
import { sendListEmail } from "./email";
import { getRecipient } from "./recipients";
import { sendListToTelegram } from "./telegram-tasks";
import { isTelegramConfigured } from "./telegram";

export interface DeliveryResult {
  email: boolean;
  telegram: boolean;
  /** Human-readable reasons a channel didn't deliver, for the UI toast. */
  problems: string[];
}

/**
 * Sends a list to whichever channels an assignee is configured for.
 *
 * Delivery is best-effort per channel but never silently total: if nothing
 * at all got through, the caller is told so it can surface a real error
 * rather than a cheerful "sent". Telegram configured-but-unlinked falls
 * back to email on purpose — a chore that reaches nobody is worse than one
 * that arrives on the old channel.
 */
export async function deliverList(
  env: Env,
  db: D1Database,
  assignee: Assignee,
  tasks: TaskRow[],
  opts: { reminder?: boolean } = {},
): Promise<DeliveryResult> {
  const recipient = await getRecipient(db, assignee.key);
  const channel = recipient?.channel ?? "email";

  const wantsTelegram = channel === "telegram" || channel === "both";
  const canTelegram = wantsTelegram && isTelegramConfigured(env) && Boolean(recipient?.chat_id);

  const result: DeliveryResult = { email: false, telegram: false, problems: [] };

  if (canTelegram) {
    try {
      const { sent } = await sendListToTelegram(env, db, recipient!.chat_id!, tasks, opts);
      result.telegram = sent > 0;
      if (sent > 0 && sent < tasks.length) {
        result.problems.push(`Only ${sent} of ${tasks.length} tasks reached Telegram.`);
      } else if (sent === 0) {
        result.problems.push("Telegram accepted nothing — check the bot token in Settings.");
      }
    } catch (err) {
      console.warn("notify: telegram delivery failed", err);
      result.problems.push("Telegram delivery failed.");
    }
  } else if (wantsTelegram) {
    result.problems.push(
      isTelegramConfigured(env)
        ? `${assignee.name} isn't linked to Telegram yet — sent by email instead.`
        : "Telegram isn't set up yet — sent by email instead.",
    );
  }

  // Email runs when it's the chosen channel, or as the fallback whenever
  // Telegram was wanted but couldn't deliver.
  const wantsEmail = channel === "email" || channel === "both" || (wantsTelegram && !result.telegram);

  if (wantsEmail) {
    try {
      await sendListEmail(env, tasks, { reminder: opts.reminder, to: assignee.email });
      result.email = true;
    } catch (err) {
      console.warn("notify: email delivery failed", err);
      result.problems.push("Email delivery failed.");
    }
  }

  return result;
}

export function deliveryFailed(result: DeliveryResult): boolean {
  return !result.email && !result.telegram;
}
