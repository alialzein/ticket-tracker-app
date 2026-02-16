-- ============================================================
-- Migration: Exclude blocked users from get_team_members RPC
-- Run in Supabase SQL Editor
--
-- This makes blocked users disappear automatically from:
--   - Team stats (main dashboard)
--   - Schedules / attendance
--   - User scores leaderboard username mapping
-- ============================================================

CREATE OR REPLACE FUNCTION get_team_members()
RETURNS TABLE(user_id uuid, username text, email text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id uuid;
BEGIN
  -- Always filter by the caller's own team_id
  SELECT us.team_id INTO v_team_id
  FROM public.user_settings us
  WHERE us.user_id = auth.uid();

  RETURN QUERY
    SELECT
      u.id                                          AS user_id,
      (u.raw_user_meta_data->>'display_name')::text AS username,
      u.email::text                                 AS email
    FROM auth.users u
    INNER JOIN public.user_settings us ON us.user_id = u.id
    LEFT JOIN public.user_roles ur ON ur.user_id = u.id
    WHERE (ur.role IS NULL OR ur.role != 'visitor_admin')
      AND us.team_id = v_team_id
      AND (us.is_blocked IS NULL OR us.is_blocked = FALSE);
END;
$$;

-- Verify: blocked users should NOT appear
SELECT user_id, username, email FROM get_team_members();
