import type { TaskPriority, TaskRow } from "./db";
import { html, raw } from "./html";
import { formatDate } from "./date";

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
const PRIORITY_COLOR: Record<TaskPriority, { bg: string; text: string }> = {
  high: { bg: "#fee2e2", text: "#991b1b" },
  medium: { bg: "#fef3c7", text: "#92400e" },
  low: { bg: "#d1fae5", text: "#065f46" },
};

/**
 * Most urgent first; ties (same priority) break alphabetically by label so
 * the order is stable and predictable rather than depending on submission
 * order.
 */
function sortByPriority(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort(
    (a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.label.localeCompare(b.label),
  );
}

export async function sendListEmail(
  env: Env,
  tasks: TaskRow[],
  opts: { reminder?: boolean; to: string },
): Promise<void> {
  const sorted = sortByPriority(tasks);

  const rows = sorted
    .map((task) => {
      const link = `${env.SITE_URL}/t/${task.token}`;
      const color = PRIORITY_COLOR[task.priority];
      return html`
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e5e5;">
            <div style="font-size:15px;color:#1a1a1a;">
              ${task.label}
              <span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.03em;background:${color.bg};color:${color.text};">${task.priority}</span>
            </div>
            <div style="margin-top:6px;">
              <a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-size:13px;">Mark complete</a>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  const requestedAt = formatDate(tasks[0]?.created_at ?? Date.now());
  const countLabel = `${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}`;

  const subject = opts.reminder
    ? `Reminder: Colaco House to-do list (${countLabel})`
    : `New Colaco House to-do list (${countLabel})`;

  const intro = opts.reminder
    ? `Reminder — requested ${requestedAt}, still open. Links below are freshly issued and replace any earlier copy of this email, which no longer works.`
    : `Requested ${requestedAt}. Click "Mark complete" on each item once it's done — each link works once and expires after 30 days.`;

  const htmlBody = html`
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;">
      <h2 style="color:#1a1a1a;">${opts.reminder ? "To-do list reminder" : "New to-do list"}</h2>
      <p style="color:#555;font-size:14px;">${intro}</p>
      <table style="width:100%;border-collapse:collapse;">${raw(rows)}</table>
    </div>
  `;

  const textBody = [
    `${opts.reminder ? "To-do list reminder" : "New to-do list"} — requested ${requestedAt}`,
    "",
    ...sorted.map((task) => `- [${task.priority}] ${task.label}\n  Mark complete: ${env.SITE_URL}/t/${task.token}`),
  ].join("\n");

  await env.EMAIL.send({
    to: opts.to,
    from: { email: env.FROM_EMAIL, name: env.FROM_NAME },
    subject,
    html: htmlBody,
    text: textBody,
  });
}
