-- ============================================================
-- Phase 5: Allow team leaders to update user_settings for
--          members of their own team.
--
-- This enables the admin panel's "Edit User" modal to save
-- name_color and display_name changes when logged in as a
-- team leader (who is not a super admin).
--
-- Run AFTER phase2_rls_policies.sql
-- ============================================================

CREATE POLICY "user_settings: team leader can update their team"
ON user_settings
FOR UPDATE
TO authenticated
USING (
    -- The row being updated must belong to the editor's team
    team_id = my_team_id()
    AND
    -- The editor must be a team leader
    EXISTS (
        SELECT 1 FROM user_settings tl
        WHERE tl.user_id = auth.uid()
          AND tl.is_team_leader = true
    )
)
WITH CHECK (
    team_id = my_team_id()
    AND
    EXISTS (
        SELECT 1 FROM user_settings tl
        WHERE tl.user_id = auth.uid()
          AND tl.is_team_leader = true
    )
);
