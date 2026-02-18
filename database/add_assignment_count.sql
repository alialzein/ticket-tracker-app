-- ============================================================
-- Migration: assignment_count on tickets
-- Run in Supabase SQL Editor
--
-- Tracks how many times a ticket has been assigned (to any user).
-- Used to show a "×N" flag next to the assigned name and to
-- enforce the 24-hour same-user reassignment rule client-side.
-- ============================================================

ALTER TABLE tickets
    ADD COLUMN IF NOT EXISTS assignment_count INT NOT NULL DEFAULT 0;

-- Backfill: tickets that already have an assigned_to_name get count = 1
UPDATE tickets
SET assignment_count = 1
WHERE assigned_to_name IS NOT NULL AND assignment_count = 0;
