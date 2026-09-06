import { getPendingTelegramTasks, recordNudge } from "./db";
import { getPolicy, isNudgeDue, isQuietHour } from "./escalation";
import { sendNudge } from "./telegram-tasks";
import { isTelegramConfigured } from "./telegram";

export interface SweepResult {
  scanned: number;
  nudged: number;
  heldForQuietHours: number;
}

/**
 * The overdue sweep, run on a cron. Walks every pending task that was
 * delivered over Telegram and chases the ones past their priority's
 * threshold.
 *
 * Held-for-quiet-hours tasks are left completely untouched — no counter
 * bump, no timestamp — so they simply come due again on the first run
 * after the window closes, rather than silently burning a nudge overnight.
 */
export async function runNudgeSweep(env: Env, db: D1Database, now = Date.now()): Promise<SweepResult> {
  const result: SweepResult = { scanned: 0, nudged: 0, heldForQuietHours: 0 };
  if (!isTelegramConfigured(env)) return result;

  const policy = getPolicy(env);
  const tasks = await getPendingTelegramTasks(db);
  result.scanned = tasks.length;

  const quiet = isQuietHour(policy, now);

  for (const task of tasks) {
    if (!isNudgeDue(policy, task, now)) continue;

    if (quiet) {
      result.heldForQuietHours++;
      continue;
    }

    const nudgeNumber = task.nudge_count + 1;
    const sent = await sendNudge(env, task, nudgeNumber, now);

    // Only count a nudge that Telegram actually accepted. A failed send
    // (bot blocked, message deleted) is retried on the next run instead of
    // silently consuming one of the task's allotted reminders.
    if (sent) {
      await recordNudge(db, task.id, now);
      result.nudged++;
    }
  }

  return result;
}
