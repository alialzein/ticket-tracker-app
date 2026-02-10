-- ============================================================
-- Phase 2b: RLS for tables missed in phase2_rls_policies.sql
--
-- Tables covered here:
--   badge_notifications  → per-user (no team_id needed, user_id filter sufficient)
--   milestone_notifications → team-scoped (team-wide announcements)
--
-- Run AFTER phase2_rls_policies.sql
-- ============================================================


-- ============================================================
-- TABLE: badge_notifications
-- Already filtered by user_id in all app queries.
-- Simple per-user RLS is enough — no team_id column needed.
-- ============================================================

ALTER TABLE badge_notifications ENABLE ROW LEVEL SECURITY;

-- Each user can only see their own badge notifications
CREATE POLICY "badge_notifications: own rows only"
ON badge_notifications
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- Each user can insert/update their own badge notifications
-- (edge function uses service role, so inserts bypass RLS)
CREATE POLICY "badge_notifications: own rows write"
ON badge_notifications
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Super admin can access all
CREATE POLICY "badge_notifications: super admin full access"
ON badge_notifications
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());


-- ============================================================
-- TABLE: milestone_notifications
-- These are team-wide announcements (e.g. "Ali hit 10 tickets today!")
-- Add team_id column so each team only sees their own milestones.
-- ============================================================

-- Step 1: Add team_id column
ALTER TABLE milestone_notifications
    ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_milestone_notifications_team_id
    ON milestone_notifications(team_id);

-- Step 2: Backfill existing rows — assign to the oldest/default team
UPDATE milestone_notifications
SET team_id = (SELECT id FROM teams ORDER BY created_at ASC LIMIT 1)
WHERE team_id IS NULL;

-- Step 3: Enable RLS
ALTER TABLE milestone_notifications ENABLE ROW LEVEL SECURITY;

-- Super admin sees all
CREATE POLICY "milestone_notifications: super admin full access"
ON milestone_notifications
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());

-- Each team only sees their own milestone notifications
CREATE POLICY "milestone_notifications: team isolation"
ON milestone_notifications
FOR ALL
TO authenticated
USING (team_id = my_team_id())
WITH CHECK (team_id = my_team_id());


-- ============================================================
-- Verification
-- ============================================================
SELECT
    tablename,
    rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('badge_notifications', 'milestone_notifications')
ORDER BY tablename;
