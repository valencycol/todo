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
import { deliverList, deliveryFailed } from "../lib/notify";
import { broadcast } from "../lib/hub";
import { getAssignees, resolveAssignee } from "../lib/assignees";
import { getRecipients, type DeliveryChannel } from "../lib/recipients";

export const listsRoutes = new Hono<{ Bindings: Env }>();

function stripTaskSecrets(task: TaskRow) {
  const { token, token_expires_at, ...rest } = task;
  return rest;
}

/**
 * How a given assignee's lists actually go out right now. Telegram only
 * counts once they're linked — a configured-but-unlinked person still
 * falls back to email, and the dashboard's Resend button should say so.
 */
type ChannelMap = Map<string, DeliveryChannel>;

async function getChannelMap(db: D1Database): Promise<ChannelMap> {
  const recipients = await getRecipients(db);
  return new Map(recipients.map((r) => [r.assignee, r.chat_id ? r.channel : "email"]));
}

function serializeList(env: Env, list: ListWithTasks, channels: ChannelMap) {
  const assignee = getAssignees(env).find((a) => a.key === list.assignee);
  return {
    ...list,
    assigneeName: assignee?.name ?? list.assignee,
    deliveryChannel: channels.get(list.assignee) ?? "email",
    tasks: list.tasks.map(stripTaskSecrets),
  };
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
  const delivery = await deliverList(c.env, c.env.DB, assignee, tasks);
  await broadcast(c.env, { type: "list_created" });

  if (deliveryFailed(delivery)) {
    // The list is already in D1 and visible on the dashboard — say so
    // plainly rather than reporting a clean send that never happened.
    return c.json({ error: `Saved, but nothing could be delivered. ${delivery.problems.join(" ")}`.trim() }, 502);
  }

  return c.json({
    ok: true,
    taskCount: tasks.length,
    channel: delivery.telegram ? (delivery.email ? "both" : "telegram") : "email",
    problems: delivery.problems,
  });
});

listsRoutes.post("/api/lists/:id/resend", async (c) => {
  const listId = c.req.param("id");
  const list = await getListById(c.env.DB, listId);
  const tasks = await resendListTasks(c.env.DB, listId);
  if (!list || !tasks) {
    return c.json({ error: "Nothing left to resend for this list." }, 404);
  }

  const assignee = resolveAssignee(c.env, list.assignee);
  const delivery = await deliverList(c.env, c.env.DB, assignee, tasks, { reminder: true });

  if (deliveryFailed(delivery)) {
    return c.json({ error: `Couldn't resend. ${delivery.problems.join(" ")}`.trim() }, 502);
  }

  return c.json({
    ok: true,
    taskCount: tasks.length,
    channel: delivery.telegram ? (delivery.email ? "both" : "telegram") : "email",
    problems: delivery.problems,
  });
});

listsRoutes.get("/api/lists/active", async (c) => {
  const [active, channels] = await Promise.all([getActiveLists(c.env.DB), getChannelMap(c.env.DB)]);
  return c.json({ active: active.map((l) => serializeList(c.env, l, channels)) });
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

  const channels = await getChannelMap(c.env.DB);
  return c.json({ completed: lists.map((l) => serializeList(c.env, l, channels)), hasMore });
});
