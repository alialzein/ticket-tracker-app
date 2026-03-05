-- ============================================================
-- Migration: Iron Week state flags + get_team_members payload
-- Run in Supabase SQL Editor
-- ============================================================

-- 1) Persist "earned Iron Week last week" state on user_settings
ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS iron_week_last_week boolean NOT NULL DEFAULT false;

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS iron_week_last_week_start date;

ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS iron_week_last_week_awarded_at timestamptz;

-- 2) Expose those flags through a NEW RPC (do not modify existing get_team_members)
-- This keeps all existing callers of get_team_members() unchanged.
CREATE OR REPLACE FUNCTION get_team_members_with_iron_week()
RETURNS TABLE(
  user_id uuid,
  username text,
  email text,
  iron_week_last_week boolean,
  iron_week_last_week_start date
)
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
      u.email::text                                 AS email,
      COALESCE(us.iron_week_last_week, false)       AS iron_week_last_week,
      us.iron_week_last_week_start                  AS iron_week_last_week_start
    FROM auth.users u
    INNER JOIN public.user_settings us ON us.user_id = u.id
    LEFT JOIN public.user_roles ur ON ur.user_id = u.id
    WHERE (ur.role IS NULL OR ur.role != 'visitor_admin')
      AND us.team_id = v_team_id
      AND (us.is_blocked IS NULL OR us.is_blocked = FALSE);
END;
$$;

-- Verify shape
SELECT user_id, username, email, iron_week_last_week, iron_week_last_week_start
FROM get_team_members_with_iron_week();
