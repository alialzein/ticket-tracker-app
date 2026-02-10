-- ============================================================
-- Phase 2: Row Level Security (RLS) Policies
-- Run this AFTER phase3_seed_default_team.sql
--
-- Strategy:
--   Each user can only SELECT/INSERT/UPDATE rows where
--   team_id matches their own team_id from user_settings.
--
--   Super admin (verified via is_super_admin() RPC or email)
--   can see all rows across all teams.
--
--   The is_super_admin() function must already exist.
--   The user_settings.team_id column must be populated (Phase 3).
-- ============================================================


-- ============================================================
-- HELPER: A fast inline function to get the current user's team_id
-- Called in every RLS policy — must be STABLE for caching
-- ============================================================

CREATE OR REPLACE FUNCTION my_team_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT team_id FROM user_settings WHERE user_id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION my_team_id() TO authenticated;


-- ============================================================
-- HELPER: Super admin bypass — checks is_super_admin RPC + email
-- ============================================================

CREATE OR REPLACE FUNCTION is_super_admin_check()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = auth.uid()
          AND (
              email ILIKE '%ali.elzein%'
           OR email ILIKE '%ali.alzein%'
           OR EXISTS (
               SELECT 1 FROM user_settings
               WHERE user_id = auth.uid()
                 AND is_team_leader IS FALSE  -- placeholder; real check via is_super_admin() if it exists
           )
          )
    )
    OR
    -- Also check the is_super_admin() function if it exists
    (SELECT COALESCE(
        (SELECT is_super_admin(auth.uid())),
        false
    ));
$$;

-- Simpler, more reliable super admin check using just email pattern
-- (mirrors the verify-admin edge function logic exactly)
CREATE OR REPLACE FUNCTION is_super_admin_check()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM auth.users
        WHERE id = auth.uid()
          AND (
              email ILIKE '%ali.elzein%'
           OR email ILIKE '%ali.alzein%'
          )
    );
$$;

GRANT EXECUTE ON FUNCTION is_super_admin_check() TO authenticated;


-- ============================================================
-- TABLE: tickets
-- ============================================================

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- Super admin sees all
CREATE POLICY "tickets: super admin full access"
ON tickets
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());

-- Regular users and team leaders see only their team
CREATE POLICY "tickets: team isolation"
ON tickets
FOR ALL
TO authenticated
USING (team_id = my_team_id())
WITH CHECK (team_id = my_team_id());


-- ============================================================
-- TABLE: user_points
-- ============================================================

ALTER TABLE user_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_points: super admin full access"
ON user_points
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());

CREATE POLICY "user_points: team isolation"
ON user_points
FOR ALL
TO authenticated
USING (team_id = my_team_id())
WITH CHECK (team_id = my_team_id());


-- ============================================================
-- TABLE: weekly_leaderboard
-- ============================================================

ALTER TABLE weekly_leaderboard ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weekly_leaderboard: super admin full access"
ON weekly_leaderboard
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());

CREATE POLICY "weekly_leaderboard: team isolation"
ON weekly_leaderboard
FOR ALL
TO authenticated
USING (team_id = my_team_id())
WITH CHECK (team_id = my_team_id());


-- ============================================================
-- TABLE: attendance
-- ============================================================

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attendance: super admin full access"
ON attendance
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());

CREATE POLICY "attendance: team isolation"
ON attendance
FOR ALL
TO authenticated
USING (team_id = my_team_id())
WITH CHECK (team_id = my_team_id());


-- ============================================================
-- TABLE: user_badges
-- ============================================================

ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_badges: super admin full access"
ON user_badges
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());

CREATE POLICY "user_badges: team isolation"
ON user_badges
FOR ALL
TO authenticated
USING (team_id = my_team_id())
WITH CHECK (team_id = my_team_id());


-- ============================================================
-- TABLE: badge_stats
-- ============================================================

ALTER TABLE badge_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "badge_stats: super admin full access"
ON badge_stats
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());

CREATE POLICY "badge_stats: team isolation"
ON badge_stats
FOR ALL
TO authenticated
USING (team_id = my_team_id())
WITH CHECK (team_id = my_team_id());


-- ============================================================
-- TABLE: user_settings
-- READ:  all authenticated users can read all rows
--        (required for getUserColor(), display names, team dropdowns)
-- WRITE: each user can only modify their own row
--        super admin can modify all rows
-- ============================================================

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can READ all user_settings rows
-- This is intentional: name_color, display_name, system_username are
-- public profile info needed by ui.js → getUserColor() and similar functions.
CREATE POLICY "user_settings: all authenticated can read"
ON user_settings
FOR SELECT
TO authenticated
USING (true);

-- Each user can INSERT/UPDATE/DELETE only their own row
CREATE POLICY "user_settings: own row write"
ON user_settings
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- Super admin can INSERT/UPDATE/DELETE any row
-- (SELECT already covered by the open read policy above)
CREATE POLICY "user_settings: super admin write"
ON user_settings
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());


-- ============================================================
-- TABLE: teams
-- All authenticated users can read active teams (for dropdowns)
-- Only super admin can insert/update/delete
-- ============================================================

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams: super admin full access"
ON teams
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());

-- All authenticated users can read active teams (needed for team dropdowns)
CREATE POLICY "teams: everyone can read active teams"
ON teams
FOR SELECT
TO authenticated
USING (is_active = true);


-- ============================================================
-- TABLE: user_pings (notifications — team-scoped)
-- ============================================================

-- NOTE: user_pings may not have team_id yet — skip RLS for now
-- and add it in a future phase once team_id is added to that table.
-- For now just ensure each user can only see their own pings.

ALTER TABLE user_pings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_pings: own pings only"
ON user_pings
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "user_pings: super admin full access"
ON user_pings
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());


-- ============================================================
-- TABLE: broadcast_messages (system-wide — all can read)
-- ============================================================

ALTER TABLE broadcast_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "broadcast_messages: all authenticated can read"
ON broadcast_messages
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "broadcast_messages: super admin can write"
ON broadcast_messages
FOR ALL
TO authenticated
USING (is_super_admin_check())
WITH CHECK (is_super_admin_check());


-- ============================================================
-- Verification — check RLS is enabled on all tables
-- ============================================================
SELECT
    tablename,
    rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
      'tickets', 'user_points', 'weekly_leaderboard',
      'attendance', 'user_badges', 'badge_stats',
      'user_settings', 'teams', 'user_pings', 'broadcast_messages'
  )
ORDER BY tablename;

-- ============================================================
-- NEXT STEP: Run phase4_edge_functions.md for guidance on
-- updating the award-points edge function to pass team_id
-- ============================================================
