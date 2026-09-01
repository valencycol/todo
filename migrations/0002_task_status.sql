ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
UPDATE tasks SET status = 'done' WHERE completed_at IS NOT NULL;
CREATE INDEX idx_tasks_status ON tasks(status);
