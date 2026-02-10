-- ============================================================
-- Phase 3: Seed existing data with the default team
-- Run this AFTER phase1_add_team_id.sql
-- Run this BEFORE phase2_rls_policies.sql
--
-- What this does:
--   1. Creates a "Default Team" if no teams exist yet,
--      OR lets you specify an existing team ID to use
--   2. Assigns ALL existing rows in every operational table
--      to that default team (where team_id is still NULL)
--   3. Assigns all users in user_settings to the default team
--      (where team_id is still NULL)
--
-- IMPORTANT: After running this, verify the row counts look
-- correct, then run phase2_rls_policies.sql.
-- ============================================================


-- ----------------------------------------------------------------
-- STEP 1: Ensure a default team exists
-- If your existing team already has an ID, replace the DO block
-- below with: SELECT id FROM teams WHERE name = 'YOUR TEAM NAME';
-- ----------------------------------------------------------------

DO $$
DECLARE
    v_default_team_id uuid;
BEGIN
    -- Check if any team already exists
    SELECT id INTO v_default_team_id
    FROM teams
    ORDER BY created_at ASC
    LIMIT 1;

    -- If no team exists yet, create the default one
    IF v_default_team_id IS NULL THEN
        INSERT INTO teams (name, description, is_active, created_at)
        VALUES ('Default Team', 'Original team — migrated from single-team setup', true, now())
        RETURNING id INTO v_default_team_id;

        RAISE NOTICE 'Created Default Team with ID: %', v_default_team_id;
    ELSE
        RAISE NOTICE 'Using existing team as default: %', v_default_team_id;
    END IF;

    -- ----------------------------------------------------------------
    -- STEP 2: Backfill team_id on all operational tables
    -- ----------------------------------------------------------------

    -- tickets
    UPDATE tickets
    SET team_id = v_default_team_id
    WHERE team_id IS NULL;
    RAISE NOTICE 'tickets: backfilled % rows', (SELECT COUNT(*) FROM tickets WHERE team_id = v_default_team_id);

    -- user_points
    UPDATE user_points
    SET team_id = v_default_team_id
    WHERE team_id IS NULL;
    RAISE NOTICE 'user_points: backfilled % rows', (SELECT COUNT(*) FROM user_points WHERE team_id = v_default_team_id);

    -- weekly_leaderboard
    UPDATE weekly_leaderboard
    SET team_id = v_default_team_id
    WHERE team_id IS NULL;
    RAISE NOTICE 'weekly_leaderboard: backfilled % rows', (SELECT COUNT(*) FROM weekly_leaderboard WHERE team_id = v_default_team_id);

    -- attendance
    UPDATE attendance
    SET team_id = v_default_team_id
    WHERE team_id IS NULL;
    RAISE NOTICE 'attendance: backfilled % rows', (SELECT COUNT(*) FROM attendance WHERE team_id = v_default_team_id);

    -- user_badges
    UPDATE user_badges
    SET team_id = v_default_team_id
    WHERE team_id IS NULL;
    RAISE NOTICE 'user_badges: backfilled % rows', (SELECT COUNT(*) FROM user_badges WHERE team_id = v_default_team_id);

    -- badge_stats
    UPDATE badge_stats
    SET team_id = v_default_team_id
    WHERE team_id IS NULL;
    RAISE NOTICE 'badge_stats: backfilled % rows', (SELECT COUNT(*) FROM badge_stats WHERE team_id = v_default_team_id);

    -- user_settings (assign any users not yet on a team)
    UPDATE user_settings
    SET team_id = v_default_team_id
    WHERE team_id IS NULL;
    RAISE NOTICE 'user_settings: backfilled % rows', (SELECT COUNT(*) FROM user_settings WHERE team_id = v_default_team_id);

END $$;


-- ----------------------------------------------------------------
-- STEP 3: Enforce NOT NULL now that all rows are assigned
-- ----------------------------------------------------------------

ALTER TABLE tickets           ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE user_points       ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE weekly_leaderboard ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE attendance        ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE user_badges       ALTER COLUMN team_id SET NOT NULL;
ALTER TABLE badge_stats       ALTER COLUMN team_id SET NOT NULL;


-- ----------------------------------------------------------------
-- Verification — run these SELECTs to confirm no NULLs remain
-- ----------------------------------------------------------------
SELECT 'tickets'            AS tbl, COUNT(*) AS nulls FROM tickets            WHERE team_id IS NULL
UNION ALL
SELECT 'user_points'        AS tbl, COUNT(*) AS nulls FROM user_points        WHERE team_id IS NULL
UNION ALL
SELECT 'weekly_leaderboard' AS tbl, COUNT(*) AS nulls FROM weekly_leaderboard WHERE team_id IS NULL
UNION ALL
SELECT 'attendance'         AS tbl, COUNT(*) AS nulls FROM attendance         WHERE team_id IS NULL
UNION ALL
SELECT 'user_badges'        AS tbl, COUNT(*) AS nulls FROM user_badges        WHERE team_id IS NULL
UNION ALL
SELECT 'badge_stats'        AS tbl, COUNT(*) AS nulls FROM badge_stats        WHERE team_id IS NULL;

-- All rows in the above query should show 0 nulls.
-- If all look good, proceed to phase2_rls_policies.sql


-- ============================================================
-- NEXT STEP: Run phase2_rls_policies.sql
-- ============================================================
