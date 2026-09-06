import type { TaskPriority, TaskRow } from "./db";
import { getTaskById, setTaskTelegramMessage } from "./db";
import { formatDate } from "./date";
import { describeThreshold, formatOverdue, getPolicy, type EscalationPolicy } from "./escalation";
import { editMessage, sendMessage, tgEscape, type InlineButton } from "./telegram";

const PRIORITY_DOT: Record<TaskPriority, string> = { high: "🔴", medium: "🟡", low: "🟢" };
const PRIORITY_WORD: Record<TaskPriority, string> = { high: "High", medium: "Medium", low: "Low" };

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };

/** Same ordering rule as the email: most urgent first, then alphabetical. */
function sortByPriority(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.label.localeCompare(b.label),
  );
}

/**
 * Button payloads are capped at 64 bytes by Telegram. A task id is a UUID,
 * so "d:" + 36 chars fits with room to spare — and because the chat_id
 * itself proves who pressed the button, the payload doesn't need to carry
 * the unguessable task token the email links rely on.
 */
export type CallbackAction = "done" | "reject" | "note" | "cancel";

const ACTION_PREFIX: Record<CallbackAction, string> = { done: "d", reject: "r", note: "n", cancel: "c" };

export function callbackData(action: CallbackAction, taskId: string): string {
  return `${ACTION_PREFIX[action]}:${taskId}`;
}

export function parseCallbackData(data: string): { action: CallbackAction; taskId: string } | null {
  const [prefix, taskId] = data.split(":");
  if (!prefix || !taskId) return null;
  const entry = (Object.entries(ACTION_PREFIX) as [CallbackAction, string][]).find(([, p]) => p === prefix);
  return entry ? { action: entry[0], taskId } : null;
}

function pendingButtons(task: TaskRow): InlineButton[][] {
  return [
    [
      { text: "✅ Done", callback_data: callbackData("done", task.id) },
      { text: "✖️ Reject", callback_data: callbackData("reject", task.id) },
    ],
    [{ text: "📝 Add a note", callback_data: callbackData("note", task.id) }],
  ];
}

/**
 * Renders a task in whatever state it's currently in. Used both for the
 * first send and for every in-place edit afterwards, so a message can
 * never disagree with D1 no matter which surface changed the task.
 */
export function renderTask(task: TaskRow, policy: EscalationPolicy): { text: string; buttons: InlineButton[][] } {
  const label = tgEscape(task.label);

  if (task.status !== "pending") {
    const icon = task.status === "done" ? "✅" : "✖️";
    const word = task.status === "done" ? "Done" : "Rejected";
    const when = task.completed_at ? formatDate(task.completed_at) : formatDate(Date.now());
    const lines = [`${icon} <s>${label}</s>`, `<i>${word} · ${tgEscape(when)}</i>`];
    if (task.remarks) lines.push("", `📝 ${tgEscape(task.remarks)}`);
    return { text: lines.join("\n"), buttons: [] };
  }

  const lines = [
    `${PRIORITY_DOT[task.priority]} <b>${label}</b>`,
    `<i>${PRIORITY_WORD[task.priority]} priority · sent ${tgEscape(formatDate(task.created_at))}</i>`,
  ];
  if (task.remarks) lines.push("", `📝 ${tgEscape(task.remarks)}`);
  lines.push("", `<i>Nudges after ${describeThreshold(policy, task.priority)} if it's still open.</i>`);

  return { text: lines.join("\n"), buttons: pendingButtons(task) };
}

function listHeader(tasks: TaskRow[], reminder: boolean): string {
  const count = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;
  const counts = { high: 0, medium: 0, low: 0 } as Record<TaskPriority, number>;
  for (const task of tasks) counts[task.priority]++;

  const breakdown = (["high", "medium", "low"] as TaskPriority[])
    .filter((p) => counts[p] > 0)
    .map((p) => `${PRIORITY_DOT[p]} ${counts[p]}`)
    .join("  ");

  return reminder
    ? [`🔔 <b>Reminder — ${count} still open</b>`, breakdown, "", "<i>Tap the buttons below each one.</i>"]
        .filter(Boolean)
        .join("\n")
    : [`🏠 <b>New to-do list — ${count}</b>`, breakdown, "", "<i>Tap the buttons below each one.</i>"]
        .filter(Boolean)
        .join("\n");
}

/**
 * Posts a list to a chat: one header, then one message per task so each
 * can be independently resolved and edited in place. The header is the
 * only one that buzzes — the task messages arrive silently underneath it,
 * which keeps a five-task list to a single notification.
 */
export async function sendListToTelegram(
  env: Env,
  db: D1Database,
  chatId: string,
  tasks: TaskRow[],
  opts: { reminder?: boolean } = {},
): Promise<{ sent: number }> {
  const policy = getPolicy(env);
  const sorted = sortByPriority(tasks);

  await sendMessage(env, chatId, listHeader(sorted, Boolean(opts.reminder)));

  let sent = 0;
  for (const task of sorted) {
    // A reminder supersedes the previous copy of this task: strip its
    // buttons so the chat only ever offers one live control per task.
    if (opts.reminder && task.tg_chat_id && task.tg_message_id) {
      await editMessage(
        env,
        task.tg_chat_id,
        task.tg_message_id,
        `${PRIORITY_DOT[task.priority]} <s>${tgEscape(task.label)}</s>\n<i>Superseded by the reminder below.</i>`,
        [],
      );
    }

    const { text, buttons } = renderTask(task, policy);
    const message = await sendMessage(env, chatId, text, { buttons, silent: true });
    if (message) {
      await setTaskTelegramMessage(db, task.id, chatId, message.message_id);
      sent++;
    }
  }

  return { sent };
}

/**
 * Re-renders a task's Telegram message from its current DB state. Safe to
 * call for tasks that were never sent over Telegram (it no-ops), which is
 * what lets the web page and the superuser editor call it unconditionally.
 */
export async function syncTaskMessage(env: Env, db: D1Database, taskId: string): Promise<void> {
  const task = await getTaskById(db, taskId);
  if (!task || !task.tg_chat_id || !task.tg_message_id) return;

  const { text, buttons } = renderTask(task, getPolicy(env));
  await editMessage(env, task.tg_chat_id, task.tg_message_id, text, buttons);
}

/**
 * The overdue chase. Posts as a reply to the task's own message so the
 * chat keeps the thread together, and escalates its wording each time.
 */
export async function sendNudge(env: Env, task: TaskRow, nudgeNumber: number, now: number): Promise<boolean> {
  if (!task.tg_chat_id || !task.tg_message_id) return false;

  const overdue = formatOverdue(now - task.created_at);
  const heading =
    nudgeNumber === 1
      ? `⏰ <b>Still open</b> — ${tgEscape(overdue)} since this was sent.`
      : nudgeNumber === 2
        ? `⚠️ <b>Still not done</b> — ${tgEscape(overdue)} and counting.`
        : `🚨 <b>Last reminder</b> — open for ${tgEscape(overdue)}.`;

  const text = [
    heading,
    `${PRIORITY_DOT[task.priority]} ${tgEscape(task.label)}`,
    "",
    "<i>Use the buttons on the original message above.</i>",
  ].join("\n");

  const message = await sendMessage(env, task.tg_chat_id, text, {
    replyToMessageId: task.tg_message_id,
    buttons: [
      [
        { text: "✅ Done", callback_data: callbackData("done", task.id) },
        { text: "✖️ Reject", callback_data: callbackData("reject", task.id) },
      ],
    ],
  });

  return message !== null;
}
