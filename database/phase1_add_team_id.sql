-- ============================================================
-- Phase 1: Add team_id to all operational data tables
-- Run this FIRST (before Phase 3 seed and Phase 2 RLS)
--
-- Tables getting team_id:
--   tickets, user_points, weekly_leaderboard,
--   attendance, user_badges, badge_stats
--
-- NOTE: team_id is nullable here intentionally.
--   After running this, run phase3_seed_default_team.sql
--   to fill in the default team, then enable NOT NULL.
-- ============================================================


-- 1. tickets
ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_team_id ON tickets(team_id);


-- 2. user_points
ALTER TABLE user_points
    ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_points_team_id ON user_points(team_id);


-- 3. weekly_leaderboard
ALTER TABLE weekly_leaderboard
    ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_weekly_leaderboard_team_id ON weekly_leaderboard(team_id);


-- 4. attendance
ALTER TABLE attendance
    ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_team_id ON attendance(team_id);


-- 5. user_badges
ALTER TABLE user_badges
    ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_badges_team_id ON user_badges(team_id);


-- 6. badge_stats
ALTER TABLE badge_stats
    ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_badge_stats_team_id ON badge_stats(team_id);


-- ============================================================
-- NEXT STEP: Run phase3_seed_default_team.sql
-- ============================================================
