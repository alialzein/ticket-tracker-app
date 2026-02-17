-- ============================================================
-- Migration: notify_team_badge RPC
-- Run in Supabase SQL Editor
--
-- When a badge is awarded to a user, this function inserts
-- a badge_notification row for EVERY active (non-blocked)
-- member of the same team so the whole team sees the event.
--
-- The recipient gets: "You earned the X badge!"
-- All others get:     "<username> earned the X badge!"
--
-- SECURITY DEFINER lets it write rows for other users,
-- bypassing the per-user RLS on badge_notifications.
-- ============================================================

CREATE OR REPLACE FUNCTION notify_team_badge(
    p_recipient_user_id uuid,
    p_recipient_username text,
    p_badge_id           text,
    p_badge_name         text,
    p_badge_emoji        text,
    p_team_id            uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO badge_notifications (
        user_id,
        username,
        badge_id,
        badge_name,
        badge_emoji,
        message,
        is_read,
        created_at
    )
    SELECT
        us.user_id,
        p_recipient_username,
        p_badge_id,
        p_badge_name,
        p_badge_emoji,
        CASE
            WHEN us.user_id = p_recipient_user_id
            THEN 'You earned the ' || p_badge_name || ' badge! ' || p_badge_emoji
            ELSE p_recipient_username || ' earned the ' || p_badge_name || ' badge! ' || p_badge_emoji
        END,
        false,
        NOW()
    FROM user_settings us
    WHERE us.team_id = p_team_id
      AND (us.is_blocked IS NULL OR us.is_blocked = FALSE);
END;
$$;

GRANT EXECUTE ON FUNCTION notify_team_badge(uuid, text, text, text, text, uuid) TO authenticated;

-- Verify
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_name = 'notify_team_badge';
