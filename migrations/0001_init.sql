CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL REFERENCES lists(id),
  type TEXT NOT NULL,
  label TEXT NOT NULL,
  place TEXT,
  token TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL,
  completed_at INTEGER,
  remarks TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_tasks_list_id ON tasks(list_id);
CREATE UNIQUE INDEX idx_tasks_token ON tasks(token);
CREATE INDEX idx_tasks_completed_at ON tasks(completed_at);

CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  first_attempt_at INTEGER NOT NULL
);
