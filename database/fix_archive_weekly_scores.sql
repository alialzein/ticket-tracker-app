-- ============================================================
-- Fix: archive_weekly_scores now populates team_id
--
-- Problem: weekly_leaderboard.team_id is NOT NULL, but the
-- old function did not include team_id in the INSERT, causing
-- a null constraint error.
--
-- Fix: join user_points with user_settings to resolve team_id
-- per user. Falls back to the oldest team (default) if a user
-- somehow has no team assigned.
--
-- Run this once in the Supabase SQL Editor.
-- ============================================================

-- Drop any existing variant (return type may differ)
DROP FUNCTION IF EXISTS archive_weekly_scores();
DROP FUNCTION IF EXISTS archive_weekly_scores(date, date);
DROP FUNCTION IF EXISTS archive_weekly_scores(date);

CREATE FUNCTION archive_weekly_scores()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_week_start      date;
    v_default_team_id uuid;
BEGIN
    -- Archive the PREVIOUS week (last Monday → last Sunday)
    v_week_start := date_trunc('week', current_date - interval '7 days')::date;

    -- Fallback default team (oldest team, same logic used in seeding)
    SELECT id INTO v_default_team_id
    FROM teams
    ORDER BY created_at ASC
    LIMIT 1;

    -- Insert one row per user into weekly_leaderboard,
    -- pulling team_id from user_settings (or default if missing)
    INSERT INTO weekly_leaderboard (
        week_start_date,
        user_id,
        username,
        total_score,
        team_id
    )
    SELECT
        v_week_start,
        up.user_id,
        up.username,
        SUM(up.points_awarded)                  AS total_score,
        COALESCE(us.team_id, v_default_team_id) AS team_id
    FROM user_points up
    LEFT JOIN user_settings us ON us.user_id = up.user_id
    WHERE up.created_at >= v_week_start
      AND up.created_at <  v_week_start + interval '7 days'
    GROUP BY up.user_id, up.username, us.team_id
    HAVING COALESCE(us.team_id, v_default_team_id) IS NOT NULL

    -- Don't re-archive the same week/user twice — just update score
    ON CONFLICT (week_start_date, user_id) DO UPDATE
        SET total_score = EXCLUDED.total_score,
            team_id     = EXCLUDED.team_id;
END;
$$;

-- Grant execute to the authenticated role so the frontend can call it
GRANT EXECUTE ON FUNCTION archive_weekly_scores() TO authenticated;
