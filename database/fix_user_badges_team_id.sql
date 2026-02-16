-- ============================================================
-- Fix: ensure any user_badges rows with NULL team_id get
-- assigned to the default (oldest) team, so CLIENT_HERO_CHECK
-- can always proceed without NOT NULL violations.
-- Run this once in the Supabase SQL Editor.
-- ============================================================

-- Backfill any existing rows that have NULL team_id
UPDATE user_badges
SET team_id = (
    SELECT id FROM teams ORDER BY created_at ASC LIMIT 1
)
WHERE team_id IS NULL;

-- Verify
SELECT COUNT(*) AS null_team_badges FROM user_badges WHERE team_id IS NULL;
-- Should return 0
