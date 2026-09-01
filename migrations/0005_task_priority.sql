-- Household-assigned urgency, set when a list is submitted. Existing rows
-- default to 'medium' since priority didn't exist before this feature.
ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'medium';
