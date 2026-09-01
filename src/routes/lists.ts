import { Hono } from "hono";
import { resolveSubmittedItem } from "../lib/catalog";
import {
  createListWithTasks,
  getActiveLists,
  getCompletedLists,
  getListById,
  resendListTasks,
  type ListWithTasks,
  type TaskRow,
} from "../lib/db";
import { sendListEmail } from "../lib/email";
import { broadcast } from "../lib/hub";
import { getAssignees, resolveAssignee } from "../lib/assignees";

export const listsRoutes = new Hono<{ Bindings: Env }>();

function stripTaskSecrets(task: TaskRow) {
  const { token, token_expires_at, ...rest } = task;
  return rest;
}

function serializeList(env: Env, list: ListWithTasks) {
  const assignee = getAssignees(env).find((a) => a.key === list.assignee);
  return { ...list, assigneeName: assignee?.name ?? list.assignee, tasks: list.tasks.map(stripTaskSecrets) };
}

listsRoutes.post("/api/lists", async (c) => {
  const body = await c.req.json<{ items?: unknown[]; assignee?: unknown }>().catch(() => null);
  const rawItems = Array.isArray(body?.items) ? body.items : [];
  const resolved = rawItems.map(resolveSubmittedItem).filter((item): item is NonNullable<typeof item> => item !== null);

  if (resolved.length === 0) {
    return c.json({ error: "No valid tasks submitted." }, 400);
  }

  const assignee = resolveAssignee(c.env, body?.assignee);
  const { tasks } = await createListWithTasks(c.env.DB, resolved, assignee.key);
  await sendListEmail(c.env, tasks, { to: assignee.email });
  await broadcast(c.env, { type: "list_created" });

  return c.json({ ok: true, taskCount: tasks.length });
});

listsRoutes.post("/api/lists/:id/resend", async (c) => {
  const listId = c.req.param("id");
  const list = await getListById(c.env.DB, listId);
  const tasks = await resendListTasks(c.env.DB, listId);
  if (!list || !tasks) {
    return c.json({ error: "Nothing left to resend for this list." }, 404);
  }

  const assignee = resolveAssignee(c.env, list.assignee);
  await sendListEmail(c.env, tasks, { reminder: true, to: assignee.email });
  return c.json({ ok: true, taskCount: tasks.length });
});

listsRoutes.get("/api/lists/active", async (c) => {
  const active = await getActiveLists(c.env.DB);
  return c.json({ active: active.map((l) => serializeList(c.env, l)) });
});

listsRoutes.get("/api/lists/completed", async (c) => {
  const query = c.req.query("q") ?? "";
  const limit = Number(c.req.query("limit") ?? "20");
  const offset = Number(c.req.query("offset") ?? "0");

  const { lists, hasMore } = await getCompletedLists(c.env.DB, {
    query,
    limit: Number.isFinite(limit) ? limit : undefined,
    offset: Number.isFinite(offset) ? offset : undefined,
  });

  return c.json({ completed: lists.map((l) => serializeList(c.env, l)), hasMore });
});
