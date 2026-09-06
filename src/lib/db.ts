export type TaskStatus = "pending" | "done" | "rejected";
export type TaskPriority = "low" | "medium" | "high";

export interface TaskRow {
  id: string;
  list_id: string;
  type: string;
  label: string;
  place: string | null;
  token: string;
  token_expires_at: number;
  status: TaskStatus;
  completed_at: number | null; // set when status moves off "pending" (done or rejected)
  remarks: string | null;
  priority: TaskPriority;
  created_at: number;
  // Telegram delivery bookkeeping — null for tasks sent by email only.
  tg_chat_id: string | null;
  tg_message_id: number | null;
  nudge_count: number;
  nudge_last_at: number | null;
  // Set while a Telegram rejection is waiting on its reason; NULL otherwise.
  tg_reject_prompt_id: number | null;
}

export interface ListRow {
  id: string;
  created_at: number;
  completed_at: number | null;
  assignee: string;
}

export interface ListWithTasks extends ListRow {
  tasks: TaskRow[];
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface NewTaskInput {
  type: string;
  label: string;
  place: string | null;
  priority: TaskPriority;
}

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createListWithTasks(
  db: D1Database,
  items: NewTaskInput[],
  assignee: string,
): Promise<{ listId: string; tasks: TaskRow[] }> {
  const listId = crypto.randomUUID();
  const now = Date.now();

  const statements: D1PreparedStatement[] = [
    db.prepare("INSERT INTO lists (id, created_at, assignee) VALUES (?, ?, ?)").bind(listId, now, assignee),
  ];

  const tasks: TaskRow[] = items.map((item) => ({
    id: crypto.randomUUID(),
    list_id: listId,
    type: item.type,
    label: item.label,
    place: item.place,
    token: randomToken(),
    token_expires_at: now + TOKEN_TTL_MS,
    status: "pending",
    completed_at: null,
    remarks: null,
    priority: item.priority,
    created_at: now,
    tg_chat_id: null,
    tg_message_id: null,
    nudge_count: 0,
    nudge_last_at: null,
    tg_reject_prompt_id: null,
  }));

  for (const task of tasks) {
    statements.push(
      db
        .prepare(
          `INSERT INTO tasks (id, list_id, type, label, place, token, token_expires_at, status, completed_at, remarks, priority, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
        )
        .bind(
          task.id,
          task.list_id,
          task.type,
          task.label,
          task.place,
          task.token,
          task.token_expires_at,
          task.priority,
          task.created_at,
        ),
    );
  }

  await db.batch(statements);
  return { listId, tasks };
}

export async function getTaskByToken(db: D1Database, token: string): Promise<TaskRow | null> {
  const row = await db.prepare("SELECT * FROM tasks WHERE token = ?").bind(token).first<TaskRow>();
  return row ?? null;
}

export async function getListById(db: D1Database, listId: string): Promise<ListRow | null> {
  const row = await db.prepare("SELECT * FROM lists WHERE id = ?").bind(listId).first<ListRow>();
  return row ?? null;
}

export function isTaskLinkValid(task: TaskRow): boolean {
  return task.status === "pending" && task.token_expires_at > Date.now();
}

export async function resolveTask(
  db: D1Database,
  taskId: string,
  outcome: "done" | "rejected",
  remarks: string | null,
): Promise<void> {
  const now = Date.now();
  const task = await db.prepare("SELECT list_id FROM tasks WHERE id = ?").bind(taskId).first<{ list_id: string }>();
  if (!task) return;

  await db
    .prepare("UPDATE tasks SET status = ?, completed_at = ?, remarks = ? WHERE id = ? AND status = 'pending'")
    .bind(outcome, now, remarks, taskId)
    .run();

  const remaining = await db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE list_id = ? AND status = 'pending'")
    .bind(task.list_id)
    .first<{ n: number }>();

  if (remaining && remaining.n === 0) {
    await db.prepare("UPDATE lists SET completed_at = ? WHERE id = ?").bind(now, task.list_id).run();
  }
}

/**
 * Recomputes a list's `completed_at` from its tasks' current state. Used
 * after an admin edit/delete, since those can move a task's status in
 * either direction (e.g. un-reject it back to pending), unlike the normal
 * one-way `resolveTask` flow.
 */
async function syncListCompletion(db: D1Database, listId: string): Promise<void> {
  const pending = await db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE list_id = ? AND status = 'pending'")
    .bind(listId)
    .first<{ n: number }>();

  if (pending && pending.n > 0) {
    await db.prepare("UPDATE lists SET completed_at = NULL WHERE id = ?").bind(listId).run();
    return;
  }

  const latest = await db
    .prepare("SELECT MAX(completed_at) AS latest, COUNT(*) AS n FROM tasks WHERE list_id = ?")
    .bind(listId)
    .first<{ latest: number | null; n: number }>();

  if (latest && latest.n > 0) {
    await db.prepare("UPDATE lists SET completed_at = ? WHERE id = ?").bind(latest.latest, listId).run();
  }
}

export type TaskUpdate = { label?: string; remarks?: string | null; status?: TaskStatus };

/**
 * Admin-only edit of an existing task's label/remarks/status. Returns
 * false if the task doesn't exist. Changing `status` re-derives whether
 * completed_at should be set on a task (and, via syncListCompletion,
 * whether the list itself counts as active or completed).
 */
export async function updateTask(db: D1Database, taskId: string, update: TaskUpdate): Promise<boolean> {
  const task = await db.prepare("SELECT list_id FROM tasks WHERE id = ?").bind(taskId).first<{ list_id: string }>();
  if (!task) return false;

  const sets: string[] = [];
  const params: unknown[] = [];

  if (update.label !== undefined) {
    sets.push("label = ?");
    params.push(update.label);
  }
  if (update.remarks !== undefined) {
    sets.push("remarks = ?");
    params.push(update.remarks);
  }
  if (update.status !== undefined) {
    sets.push("status = ?", "completed_at = ?");
    params.push(update.status, update.status === "pending" ? null : Date.now());
  }

  if (sets.length > 0) {
    params.push(taskId);
    await db
      .prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...params)
      .run();
  }

  if (update.status !== undefined) {
    await syncListCompletion(db, task.list_id);
  }

  return true;
}

/**
 * Admin-only permanent delete of a task. If it was the list's last task,
 * the (now-empty) list is deleted too, since every list is otherwise
 * guaranteed to have at least one task. Returns null if the task doesn't
 * exist, otherwise whether the parent list was deleted along with it.
 */
export async function deleteTask(db: D1Database, taskId: string): Promise<{ listDeleted: boolean } | null> {
  const task = await db.prepare("SELECT list_id FROM tasks WHERE id = ?").bind(taskId).first<{ list_id: string }>();
  if (!task) return null;

  await db.prepare("DELETE FROM tasks WHERE id = ?").bind(taskId).run();

  const remaining = await db
    .prepare("SELECT COUNT(*) AS n FROM tasks WHERE list_id = ?")
    .bind(task.list_id)
    .first<{ n: number }>();

  if (remaining && remaining.n === 0) {
    await db.prepare("DELETE FROM lists WHERE id = ?").bind(task.list_id).run();
    return { listDeleted: true };
  }

  await syncListCompletion(db, task.list_id);
  return { listDeleted: false };
}

/**
 * Issues fresh tokens (new value + new 30-day expiry) for every still-open
 * task in a list, so an old copy of the email can no longer be used to
 * complete them. Returns the updated rows for re-sending, or null if the
 * list has nothing left to resend.
 */
export async function resendListTasks(db: D1Database, listId: string): Promise<TaskRow[] | null> {
  const { results: pending } = await db
    .prepare("SELECT * FROM tasks WHERE list_id = ? AND status = 'pending' ORDER BY created_at ASC")
    .bind(listId)
    .all<TaskRow>();

  if (pending.length === 0) return null;

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  const updated: TaskRow[] = [];

  for (const task of pending) {
    const token = randomToken();
    const token_expires_at = now + TOKEN_TTL_MS;
    statements.push(
      db.prepare("UPDATE tasks SET token = ?, token_expires_at = ? WHERE id = ?").bind(token, token_expires_at, task.id),
    );
    updated.push({ ...task, token, token_expires_at });
  }

  await db.batch(statements);
  return updated;
}

async function attachTasks(db: D1Database, lists: ListRow[]): Promise<ListWithTasks[]> {
  if (lists.length === 0) return [];

  const placeholders = lists.map(() => "?").join(",");
  const { results: tasks } = await db
    .prepare(`SELECT * FROM tasks WHERE list_id IN (${placeholders}) ORDER BY created_at ASC`)
    .bind(...lists.map((l) => l.id))
    .all<TaskRow>();

  const tasksByList = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    const bucket = tasksByList.get(task.list_id);
    if (bucket) bucket.push(task);
    else tasksByList.set(task.list_id, [task]);
  }

  return lists.map((list) => ({ ...list, tasks: tasksByList.get(list.id) ?? [] }));
}

/**
 * Active lists are, by definition, few (only currently-open work) — this
 * query is bounded by `lists.completed_at IS NULL` via an index, never by
 * total history size, so it stays cheap no matter how much has piled up in
 * Completed over the years.
 */
export async function getActiveLists(db: D1Database): Promise<ListWithTasks[]> {
  const { results: lists } = await db
    .prepare("SELECT * FROM lists WHERE completed_at IS NULL ORDER BY created_at DESC")
    .all<ListRow>();
  return attachTasks(db, lists);
}

export interface GetCompletedListsOptions {
  query?: string;
  limit?: number;
  offset?: number;
}

export interface CompletedListsPage {
  lists: ListWithTasks[];
  hasMore: boolean;
}

const DEFAULT_COMPLETED_PAGE_SIZE = 2;

/**
 * Paginated + optionally searched completed history. "Completed" here means
 * per-task, not per-list: a rejected or done task shows up immediately even
 * if sibling tasks from the same submitted list are still pending (so it
 * doesn't wait on the rest of the batch to finish) — only that list's
 * resolved tasks are shown here, its still-open ones stay on Active.
 *
 * The base browse query aggregates over `tasks.status` (indexed, and only
 * over resolved rows — never touches pending ones); a text search
 * additionally scans `tasks.label`/`tasks.remarks` with LIKE, which is a
 * scan over historical tasks — fine at household-app volumes (fires once
 * per search, not on every render), but the thing to revisit with an FTS5
 * index if this ever grows into the tens of thousands of tasks.
 */
export async function getCompletedLists(db: D1Database, opts: GetCompletedListsOptions = {}): Promise<CompletedListsPage> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_COMPLETED_PAGE_SIZE, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const query = opts.query?.trim();

  let sql = "SELECT list_id, MAX(completed_at) AS latest FROM tasks WHERE status != 'pending'";
  const params: unknown[] = [];

  if (query) {
    sql += ` AND list_id IN (SELECT DISTINCT list_id FROM tasks WHERE status != 'pending' AND (label LIKE ? OR remarks LIKE ?))`;
    const like = `%${query}%`;
    params.push(like, like);
  }

  sql += " GROUP BY list_id ORDER BY latest DESC LIMIT ? OFFSET ?";
  params.push(limit + 1, offset);

  const { results: rows } = await db
    .prepare(sql)
    .bind(...params)
    .all<{ list_id: string; latest: number }>();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  if (page.length === 0) return { lists: [], hasMore: false };

  const latestByListId = new Map(page.map((r) => [r.list_id, r.latest]));
  const placeholders = page.map(() => "?").join(",");

  const [{ results: lists }, { results: tasks }] = await Promise.all([
    db
      .prepare(`SELECT * FROM lists WHERE id IN (${placeholders})`)
      .bind(...page.map((r) => r.list_id))
      .all<ListRow>(),
    db
      .prepare(`SELECT * FROM tasks WHERE list_id IN (${placeholders}) AND status != 'pending' ORDER BY created_at ASC`)
      .bind(...page.map((r) => r.list_id))
      .all<TaskRow>(),
  ]);

  const tasksByList = new Map<string, TaskRow[]>();
  for (const task of tasks) {
    const bucket = tasksByList.get(task.list_id);
    if (bucket) bucket.push(task);
    else tasksByList.set(task.list_id, [task]);
  }
  const listById = new Map(lists.map((l) => [l.id, l]));

  const result: ListWithTasks[] = page
    .map((r) => {
      const list = listById.get(r.list_id);
      if (!list) return null;
      return { ...list, completed_at: latestByListId.get(r.list_id) ?? list.completed_at, tasks: tasksByList.get(r.list_id) ?? [] };
    })
    .filter((l): l is ListWithTasks => l !== null);

  return { lists: result, hasMore };
}

const LOGIN_MAX_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function isLoginLockedOut(db: D1Database, ip: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT count, first_attempt_at FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first<{ count: number; first_attempt_at: number }>();
  if (!row) return false;
  if (Date.now() - row.first_attempt_at > LOGIN_WINDOW_MS) return false;
  return row.count >= LOGIN_MAX_ATTEMPTS;
}

export async function recordFailedLogin(db: D1Database, ip: string): Promise<void> {
  const now = Date.now();
  const row = await db
    .prepare("SELECT count, first_attempt_at FROM login_attempts WHERE ip = ?")
    .bind(ip)
    .first<{ count: number; first_attempt_at: number }>();

  if (!row || now - row.first_attempt_at > LOGIN_WINDOW_MS) {
    await db
      .prepare(
        "INSERT INTO login_attempts (ip, count, first_attempt_at) VALUES (?, 1, ?) " +
          "ON CONFLICT(ip) DO UPDATE SET count = 1, first_attempt_at = excluded.first_attempt_at",
      )
      .bind(ip, now)
      .run();
  } else {
    await db.prepare("UPDATE login_attempts SET count = count + 1 WHERE ip = ?").bind(ip).run();
  }
}

export async function resetLoginAttempts(db: D1Database, ip: string): Promise<void> {
  await db.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}

export async function getTaskById(db: D1Database, taskId: string): Promise<TaskRow | null> {
  const row = await db.prepare("SELECT * FROM tasks WHERE id = ?").bind(taskId).first<TaskRow>();
  return row ?? null;
}

/**
 * Records which Telegram message now carries a task, so later state
 * changes can edit that exact message instead of posting a second one.
 * Re-sending a task (a reminder) points it at the new message and resets
 * the nudge counter — the clock restarts from the fresh reminder.
 */
export async function setTaskTelegramMessage(
  db: D1Database,
  taskId: string,
  chatId: string,
  messageId: number,
): Promise<void> {
  await db
    .prepare("UPDATE tasks SET tg_chat_id = ?, tg_message_id = ?, nudge_count = 0, nudge_last_at = ? WHERE id = ?")
    .bind(chatId, messageId, Date.now(), taskId)
    .run();
}

/**
 * Every still-pending task that was delivered over Telegram. Bounded by
 * open work (the same set the Active dashboard shows), so the overdue
 * sweep never scans history.
 */
export async function getPendingTelegramTasks(db: D1Database): Promise<TaskRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM tasks WHERE status = 'pending' AND tg_chat_id IS NOT NULL ORDER BY created_at ASC")
    .all<TaskRow>();
  return results;
}

export async function recordNudge(db: D1Database, taskId: string, at: number): Promise<void> {
  await db
    .prepare("UPDATE tasks SET nudge_count = nudge_count + 1, nudge_last_at = ? WHERE id = ?")
    .bind(at, taskId)
    .run();
}

/** Attaches a note to a task without touching its status. */
export async function setTaskRemarks(db: D1Database, taskId: string, remarks: string | null): Promise<boolean> {
  const result = await db.prepare("UPDATE tasks SET remarks = ? WHERE id = ?").bind(remarks, taskId).run();
  return (result.meta.changes ?? 0) > 0;
}

/** The still-open tasks a Telegram chat can act on right now, newest list first. */
export async function getOpenTasksForChat(db: D1Database, chatId: string): Promise<TaskRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM tasks WHERE status = 'pending' AND tg_chat_id = ? ORDER BY created_at ASC")
    .bind(chatId)
    .all<TaskRow>();
  return results;
}

/**
 * Marks a task as awaiting its rejection reason, storing the id of the
 * prompt message so the reply can be matched back. Pass null to clear.
 */
export async function setRejectPrompt(db: D1Database, taskId: string, messageId: number | null): Promise<void> {
  await db.prepare("UPDATE tasks SET tg_reject_prompt_id = ? WHERE id = ?").bind(messageId, taskId).run();
}

export async function getTaskByRejectPrompt(
  db: D1Database,
  chatId: string,
  messageId: number,
): Promise<TaskRow | null> {
  const row = await db
    .prepare("SELECT * FROM tasks WHERE tg_chat_id = ? AND tg_reject_prompt_id = ?")
    .bind(chatId, messageId)
    .first<TaskRow>();
  return row ?? null;
}
