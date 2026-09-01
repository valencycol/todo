-- Which household member a list's email goes to. Existing rows default to
-- 'valency' since she was the only recipient before this feature existed.
ALTER TABLE lists ADD COLUMN assignee TEXT NOT NULL DEFAULT 'valency';
