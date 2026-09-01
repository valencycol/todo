-- Denormalize list completion onto `lists` itself so browsing/paginating
-- completed history is an indexed lookup instead of a full scan+aggregate
-- over every task ever created.
ALTER TABLE lists ADD COLUMN completed_at INTEGER;

UPDATE lists SET completed_at = (
  SELECT MAX(t.completed_at) FROM tasks t WHERE t.list_id = lists.id
)
WHERE id IN (
  SELECT list_id FROM tasks
  GROUP BY list_id
  HAVING SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) = 0
);

CREATE INDEX idx_lists_completed_at ON lists(completed_at);
