import { Hono } from "hono";
import { getTaskByToken, isTaskLinkValid, resolveTask } from "../lib/db";
import { taskLinkPage, taskLinkInvalidPage } from "../views/task-link";
import { broadcast } from "../lib/hub";
import { syncTaskMessage } from "../lib/telegram-tasks";

export const taskLinkRoutes = new Hono<{ Bindings: Env }>();

taskLinkRoutes.get("/t/:token", async (c) => {
  const task = await getTaskByToken(c.env.DB, c.req.param("token"));
  if (!task || !isTaskLinkValid(task)) {
    return c.html(taskLinkInvalidPage(), 410);
  }
  return c.html(taskLinkPage(task));
});

taskLinkRoutes.post("/t/:token/resolve", async (c) => {
  const task = await getTaskByToken(c.env.DB, c.req.param("token"));
  if (!task || !isTaskLinkValid(task)) {
    return c.json({ error: "Link no longer valid." }, 410);
  }

  const body = await c.req
    .json<{ remarks?: string; outcome?: string }>()
    .catch(() => ({}) as { remarks?: string; outcome?: string });
  const outcome = body.outcome === "rejected" ? "rejected" : "done";
  const remarks = String(body.remarks ?? "").trim().slice(0, 1000) || null;

  // Rejecting is the outcome that needs explaining — "not done, no reason"
  // is the one result nobody can act on. Enforced here rather than only in
  // the form, so the Telegram path and any direct POST obey the same rule.
  if (outcome === "rejected" && !remarks) {
    return c.json({ error: "Please add a reason when rejecting a task." }, 400);
  }

  await resolveTask(c.env.DB, task.id, outcome, remarks);
  // Keep the Telegram copy honest: a task resolved from the web link must
  // stop offering live buttons in the chat.
  await syncTaskMessage(c.env, c.env.DB, task.id);
  await broadcast(c.env, { type: "task_resolved" });

  return c.json({ ok: true, outcome });
});
