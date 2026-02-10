# Database Schema Reference

## Key Tables for Admin Panel

### user_settings
- `user_id` (uuid) - FK to auth.users
- `system_username` (text) - Username from email (e.g., "ali.alzein")
- `display_name` (text) - User's display name
- `name_color` (text) - User's display name color (hex, e.g. `#00D9FF`) — admin-only setting
- `theme_preference` (text) - Dark/Light theme
- `team_id` (uuid) - FK to teams table (added in migration)
- `is_blocked` (boolean) - Whether user is blocked (added in migration)
- `blocked_at` (timestamp) - When user was blocked
- `blocked_by` (uuid) - Admin who blocked
- `blocked_reason` (text) - Reason for blocking

**Note:** Email addresses are stored in `auth.users` table, not in `user_settings`.

### teams
- `id` (uuid, PK)
- `name` (text, unique)
- `description` (text)
- `team_lead_id` (uuid) - FK to auth.users
- `created_at` (timestamp)
- `created_by` (uuid)
- `is_active` (boolean)

### team_members
- `id` (uuid, PK)
- `team_id` (uuid) - FK to teams
- `user_id` (uuid) - FK to auth.users
- `joined_at` (timestamp)
- `added_by` (uuid)
- UNIQUE constraint on (team_id, user_id)

### admin_audit_log
- `id` (uuid, PK)
- `admin_user_id` (uuid) - FK to auth.users
- `admin_username` (text)
- `action` (text) - Action type
- `target_user_id` (uuid)
- `target_username` (text)
- `details` (jsonb)
- `created_at` (timestamp)

### Other Important Tables

#### tickets
- `id` (integer, PK)
- `subject` (text)
- `username` (text) - Creator
- `status` (text) - 'In Progress', 'Done'
- `source` (text)
- `priority` (text)
- `assigned_to_name` (text)
- `completed_by_name` (text)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `completed_at` (timestamp)
- `assigned_at` (timestamp)
- `needs_followup` (boolean)
- `handled_by` (text)
- `notes` (text)
- `tags` (jsonb)
- `created_by` (text)

#### user_points
- `id` (integer, PK)
- `user_id` (uuid) - FK to auth.users
- `username` (text) - **Use this for queries, NOT user_id!**
- `points_awarded` (integer) - **NOT 'points'!**
- `event_type` (text) - **NOT 'reason'!**
- `created_at` (timestamp) - **NOT 'awarded_at'!**
- `details` (text)
- `related_ticket_id` (integer)

#### weekly_leaderboard (NOT 'weekly_scores')
- `id` (integer, PK)
- `week_start_date` (date)
- `username` (text) - **Use this for queries, NOT user_id!**
- `total_score` (integer)
- `created_at` (timestamp)

#### attendance
- `id` (uuid, PK)
- `user_id` (uuid) - FK to auth.users
- `username` (text) - **Use this for queries!**
- `shift_start` (timestamp) - **NOT 'clock_in' or 'date'!**
- `shift_end` (timestamp) - **NOT 'clock_out'!**
- `on_lunch` (boolean)
- `lunch_start_time` (timestamp)
- `break_type` (text)
- `break_reason` (text)
- `expected_duration` (integer)
- `is_blocked` (boolean)
- `blocked_reason` (text)
- `blocked_at` (timestamp)
- `total_break_time_minutes` (integer)
- `device_type` (text)
- `created_at` (timestamp)

#### user_pings (NOT 'pings')
- `id` (uuid, PK)
- `user_id` (uuid) - FK to auth.users
- `message` (text)
- `created_at` (timestamp)
- `is_read` (boolean)

#### badge_stats
- Badge statistics

#### user_badges
- User badge awards

## Admin Panel Data Loading Strategy

Since we cannot access `auth.users` from the client-side admin API, we use this approach:
1. Load all users from `user_settings` table
2. Construct email as `{system_username}@b-pal.net` (pattern matching)
3. For password resets, use the constructed email pattern

This works because all B-Pal users follow the email pattern: `username@b-pal.net`
