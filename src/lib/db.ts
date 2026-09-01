export type TaskStatus = "pending" | "done" | "rejected";

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
  created_at: number;
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
    created_at: now,
  }));

  for (const task of tasks) {
    statements.push(
      db
        .prepare(
          `INSERT INTO tasks (id, list_id, type, label, place, token, token_expires_at, status, completed_at, remarks, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?)`,
        )
        .bind(task.id, task.list_id, task.type, task.label, task.place, task.token, task.token_expires_at, task.created_at),
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
