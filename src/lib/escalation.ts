import type { TaskPriority, TaskRow } from "./db";

/**
 * How long a task may sit pending before Telegram starts nudging, per
 * priority. Overridable per-environment in wrangler.jsonc; the defaults are
 * the household rule: high 2h, medium 4h, low 6h.
 */
const DEFAULT_HOURS: Record<TaskPriority, number> = { high: 2, medium: 4, low: 6 };

/**
 * Nudges repeat at the same cadence as the first one (a high-priority task
 * is chased at 2h, 4h, 6h) and then stop. Without a cap, a task nobody ever
 * resolves would buzz someone's phone every two hours forever, which is how
 * people end up muting the bot entirely.
 */
const DEFAULT_MAX_NUDGES = 3;

/** Local night, Europe/Stockholm. Nudges due in here are held until morning. */
const DEFAULT_QUIET = { startHour: 22, endHour: 7 };

const TZ = "Europe/Stockholm";

export interface EscalationPolicy {
  hours: Record<TaskPriority, number>;
  maxNudges: number;
  quiet: { startHour: number; endHour: number } | null;
}

function positiveNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getPolicy(env: Env): EscalationPolicy {
  const quietRaw = String(env.NUDGE_QUIET_HOURS ?? "").trim();
  let quiet: EscalationPolicy["quiet"] = DEFAULT_QUIET;

  if (quietRaw) {
    // "off" disables quiet hours entirely; "22-7" sets a custom window.
    if (quietRaw.toLowerCase() === "off") {
      quiet = null;
    } else {
      const match = quietRaw.match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
      if (match) {
        const startHour = Number(match[1]);
        const endHour = Number(match[2]);
        if (startHour >= 0 && startHour < 24 && endHour >= 0 && endHour < 24 && startHour !== endHour) {
          quiet = { startHour, endHour };
        }
      }
    }
  }

  return {
    hours: {
      high: positiveNumber(env.NUDGE_HOURS_HIGH, DEFAULT_HOURS.high),
      medium: positiveNumber(env.NUDGE_HOURS_MEDIUM, DEFAULT_HOURS.medium),
      low: positiveNumber(env.NUDGE_HOURS_LOW, DEFAULT_HOURS.low),
    },
    maxNudges: Math.floor(positiveNumber(env.NUDGE_MAX, DEFAULT_MAX_NUDGES)),
    quiet,
  };
}

export function thresholdMs(policy: EscalationPolicy, priority: TaskPriority): number {
  return policy.hours[priority] * 60 * 60 * 1000;
}

export function describeThreshold(policy: EscalationPolicy, priority: TaskPriority): string {
  const hours = policy.hours[priority];
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

const hourFormatter = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hour12: false });

/** Local wall-clock hour in Stockholm, so quiet hours track DST correctly. */
export function localHour(at: number): number {
  return Number(hourFormatter.format(new Date(at)));
}

export function isQuietHour(policy: EscalationPolicy, at: number): boolean {
  if (!policy.quiet) return false;
  const hour = localHour(at);
  const { startHour, endHour } = policy.quiet;
  // A window that wraps past midnight (22→7) matches either side of it.
  return startHour > endHour ? hour >= startHour || hour < endHour : hour >= startHour && hour < endHour;
}

/**
 * When a task's next nudge is due: `threshold` after it was sent, then
 * `threshold` after each nudge already delivered. Returns null once the cap
 * is reached, which is what takes a task out of the sweep for good.
 */
export function nextNudgeDueAt(policy: EscalationPolicy, task: TaskRow): number | null {
  if (task.nudge_count >= policy.maxNudges) return null;
  const step = thresholdMs(policy, task.priority);
  const from = task.nudge_last_at ?? task.created_at;
  return from + step;
}

export function isNudgeDue(policy: EscalationPolicy, task: TaskRow, now: number): boolean {
  const due = nextNudgeDueAt(policy, task);
  return due !== null && due <= now;
}

/** How long the task has been open, as "2h 15m" / "45m". */
export function formatOverdue(ms: number): string {
  const totalMinutes = Math.max(1, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
