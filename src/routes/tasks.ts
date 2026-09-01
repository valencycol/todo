import { Hono } from "hono";
import { getTaskByToken, isTaskLinkValid, resolveTask } from "../lib/db";
import { taskLinkPage, taskLinkInvalidPage } from "../views/task-link";
import { broadcast } from "../lib/hub";

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

  await resolveTask(c.env.DB, task.id, outcome, remarks);
  await broadcast(c.env, { type: "task_resolved" });

  return c.json({ ok: true, outcome });
});
