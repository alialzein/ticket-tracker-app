-- ============================================================
-- Admin Teams RPC Functions
-- Run this once in the Supabase SQL Editor
--
-- WHY: The teams.team_lead_id column has a FK to auth.users.
-- The authenticated role has no SELECT on auth.users, so any
-- INSERT/UPDATE that touches team_lead_id gets:
--   "permission denied for table users"
-- SECURITY DEFINER functions run as the postgres superuser,
-- bypassing that restriction safely.
-- ============================================================


-- 1. CREATE TEAM
CREATE OR REPLACE FUNCTION admin_create_team(
    p_name        text,
    p_description text,
    p_team_lead_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    new_team_id uuid;
BEGIN
    INSERT INTO teams (name, description, team_lead_id, is_active, created_by, created_at)
    VALUES (
        p_name,
        p_description,
        p_team_lead_id,
        true,
        auth.uid(),
        now()
    )
    RETURNING id INTO new_team_id;

    RETURN new_team_id;
END;
$$;


-- 2. UPDATE TEAM (name, description, leader)
CREATE OR REPLACE FUNCTION admin_update_team(
    p_team_id      uuid,
    p_name         text,
    p_description  text,
    p_team_lead_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE teams
    SET
        name         = p_name,
        description  = p_description,
        team_lead_id = p_team_lead_id
    WHERE id = p_team_id;
END;
$$;


-- 3. SET TEAM ACTIVE STATUS (deactivate / reactivate)
CREATE OR REPLACE FUNCTION admin_set_team_active(
    p_team_id   uuid,
    p_is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE teams
    SET is_active = p_is_active
    WHERE id = p_team_id;
END;
$$;


-- Grant execute to authenticated role so frontend can call them
GRANT EXECUTE ON FUNCTION admin_create_team(text, text, uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION admin_update_team(uuid, text, text, uuid)  TO authenticated;
GRANT EXECUTE ON FUNCTION admin_set_team_active(uuid, boolean)       TO authenticated;
