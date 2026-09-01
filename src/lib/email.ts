import type { TaskRow } from "./db";
import { html, raw } from "./html";
import { formatDate } from "./date";

export async function sendListEmail(
  env: Env,
  tasks: TaskRow[],
  opts: { reminder?: boolean; to: string },
): Promise<void> {
  const rows = tasks
    .map((task) => {
      const link = `${env.SITE_URL}/t/${task.token}`;
      return html`
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e5e5;">
            <div style="font-size:15px;color:#1a1a1a;">${task.label}</div>
            <div style="margin-top:6px;">
              <a href="${link}" style="display:inline-block;background:#9a3412;color:#fff;text-decoration:none;padding:8px 14px;border-radius:6px;font-size:13px;">Mark complete</a>
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
    ...tasks.map((task) => `- ${task.label}\n  Mark complete: ${env.SITE_URL}/t/${task.token}`),
  ].join("\n");

  await env.EMAIL.send({
    to: opts.to,
    from: { email: env.FROM_EMAIL, name: env.FROM_NAME },
    subject,
    html: htmlBody,
    text: textBody,
  });
}
