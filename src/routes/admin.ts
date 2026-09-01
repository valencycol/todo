import { Hono } from "hono";
import { updateTask, deleteTask, type TaskStatus } from "../lib/db";
import { broadcast } from "../lib/hub";
import { isSuperuserRequest } from "./superuser";

export const adminRoutes = new Hono<{ Bindings: Env }>();

const VALID_STATUSES: TaskStatus[] = ["pending", "done", "rejected"];

adminRoutes.patch("/api/tasks/:id", async (c) => {
  if (!(await isSuperuserRequest(c))) {
    return c.json({ error: "Superuser mode required." }, 403);
  }

  const body = await c.req
    .json<{ label?: string; remarks?: string | null; status?: string }>()
    .catch(() => ({}) as Record<string, never>);

  const update: { label?: string; remarks?: string | null; status?: TaskStatus } = {};

  if (typeof body.label === "string") {
    const label = body.label.trim().slice(0, 500);
    if (!label) return c.json({ error: "Label can't be empty." }, 400);
    update.label = label;
  }
  if (body.remarks !== undefined) {
    update.remarks = body.remarks === null ? null : String(body.remarks).trim().slice(0, 1000) || null;
  }
  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status as TaskStatus)) {
      return c.json({ error: "Invalid status." }, 400);
    }
    update.status = body.status as TaskStatus;
  }

  const ok = await updateTask(c.env.DB, c.req.param("id"), update);
  if (!ok) return c.json({ error: "Task not found." }, 404);

  await broadcast(c.env, { type: "task_edited" });
  return c.json({ ok: true });
});

adminRoutes.delete("/api/tasks/:id", async (c) => {
  if (!(await isSuperuserRequest(c))) {
    return c.json({ error: "Superuser mode required." }, 403);
  }

  const result = await deleteTask(c.env.DB, c.req.param("id"));
  if (!result) return c.json({ error: "Task not found." }, 404);

  await broadcast(c.env, { type: "task_deleted" });
  return c.json({ ok: true, listDeleted: result.listDeleted });
});
