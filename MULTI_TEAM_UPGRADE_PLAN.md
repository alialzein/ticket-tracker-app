# Multi-Team Upgrade Plan
**B-Pal Ticket Tracker — Team Isolation & Multi-Team Support**

---

## CURRENT STATE SUMMARY

The database already has `teams`, `team_members` tables, and `user_settings` already has `team_id`, `is_team_leader`, and `team_leader_for_team_id` columns. The `verify-admin` and `admin-create-user` edge functions already have team-awareness logic.

**What is MISSING is data isolation** — all operational tables (tickets, points, badges, attendance, etc.) have no `team_id`, so every user sees every other user's data regardless of team.

### Admin Panel — What Already Exists vs What's Missing

| Feature | Status | Location |
|---------|--------|----------|
| Create user with team assignment | ✅ Done | `user-management.js → handleCreateUser()` |
| Edit user — change team, color, display name | ✅ Done | `user-management.js → handleEditUser()` |
| Set team leader flag on user | ✅ Done | `user-management.js → handleEditUser()` |
| Filter users by team dropdown | ✅ Done | `user-management.js → applyFilters()` |
| Block / unblock user | ✅ Done | `user-management.js → handleBlockUser/unblockUser()` |
| Delete user (via edge function) | ✅ Done | `user-management.js → handleDeleteUser()` |
| Team leader scope (sees only own team's users) | ✅ Done | `user-management.js:151` |
| **Teams section in admin panel** | ❌ Missing | `admin-main.js:414` — placeholder only |
| Create a new team | ❌ Missing | Needs new `admin-teams.js` module |
| View all teams with member counts | ❌ Missing | Needs new Teams section UI |
| Rename / deactivate a team | ❌ Missing | Needs new Teams section UI |
| Assign / change team leader from Teams section | ❌ Missing | Needs new Teams section UI |
| View team members from Teams section | ❌ Missing | Needs new Teams section UI |
| Cross-team analytics (per-team stats) | ❌ Missing | Needs Phase 8 work |

---

## GOAL

- Each team operates in a fully isolated environment (their own tickets, points, badges, attendance, leaderboard)
- Teams get the same dashboard as the main dashboard, but filtered to their own data
- Team leaders manage their own team (no cross-team visibility)
- Super Admin (`ali.elzein`) continues to see and manage ALL teams from the existing admin panel
- **Zero impact on the currently working system** — the existing team (Team A) keeps working as-is throughout the migration

---

## PHASE OVERVIEW

| Phase | Scope | Risk | Est. Effort |
|-------|-------|------|-------------|
| 1 | DB: Add team_id to all data tables | Low (additive only) | Medium |
| 2 | DB: Row Level Security (RLS) policies | Medium | Medium |
| 3 | DB: Seed existing data with default team | Low | Low |
| 4 | Edge Functions: Add team_id to award-points | Medium | Medium |
| 5 | Edge Functions: Update verify-admin & user management | Low | Low |
| 6 | Frontend: Team-scoped queries on main app | Medium | High |
| 7 | Frontend: Team Leader Panel (scaled-down admin) | Medium | High |
| 8 | Frontend: Super Admin — all-teams visibility | Low | Medium |
| 9 | Testing & Validation | — | Medium |

---

## PHASE 1 — DATABASE: Add `team_id` to Operational Tables

### Goal
Add `team_id (uuid, nullable, FK → teams.id)` to every table that holds team-specific data. Nullable so existing rows are not broken.

### Tables to alter

| Table | Column to Add | Notes |
|-------|---------------|-------|
| `tickets` | `team_id uuid REFERENCES teams(id)` | Core — every ticket belongs to a team |
| `user_points` | `team_id uuid REFERENCES teams(id)` | Points are team-scoped |
| `user_badges` | `team_id uuid REFERENCES teams(id)` | Badges are team-scoped |
| `badge_stats` | `team_id uuid REFERENCES teams(id)` | Badge tracking per team |
| `badge_notifications` | `team_id uuid REFERENCES teams(id)` | Notifications per team |
| `attendance` | `team_id uuid REFERENCES teams(id)` | Shifts per team |
| `schedules` | `team_id uuid REFERENCES teams(id)` | Schedules per team |
| `default_schedules` | `team_id uuid REFERENCES teams(id)` | Default schedules per team |
| `weekly_leaderboard` | `team_id uuid REFERENCES teams(id)` | Leaderboard per team |
| `milestone_notifications` | `team_id uuid REFERENCES teams(id)` | Milestones per team |
| `user_pings` | `team_id uuid REFERENCES teams(id)` | Pings stay global (skip or add) |
| `deployment_notes` | `team_id uuid REFERENCES teams(id)` | Optional: global or per-team |

### SQL Migrations

```sql
-- Run each ALTER TABLE safely with IF NOT EXISTS equivalent pattern

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE user_points
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE user_badges
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE badge_stats
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE badge_notifications
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE schedules
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE default_schedules
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE weekly_leaderboard
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

ALTER TABLE milestone_notifications
  ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_tickets_team_id ON tickets(team_id);
CREATE INDEX IF NOT EXISTS idx_user_points_team_id ON user_points(team_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_team_id ON user_badges(team_id);
CREATE INDEX IF NOT EXISTS idx_badge_stats_team_id ON badge_stats(team_id);
CREATE INDEX IF NOT EXISTS idx_attendance_team_id ON attendance(team_id);
CREATE INDEX IF NOT EXISTS idx_weekly_leaderboard_team_id ON weekly_leaderboard(team_id);
```

---

## PHASE 2 — DATABASE: Row Level Security (RLS) Policies

### Goal
Enforce data isolation at the database level so even if frontend code has a bug, data cannot leak across teams.

### Strategy
- **Super Admin** (ali.elzein / ali.alzein): bypasses all RLS — sees everything
- **Team Leader**: sees only rows where `team_id = their team`
- **Regular User**: sees only rows where `team_id = their team`
- **Service Role** (used by edge functions): bypasses RLS

### RLS Policy Pattern

```sql
-- Enable RLS on each table
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE badge_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_leaderboard ENABLE ROW LEVEL SECURITY;

-- Helper function to get the calling user's team_id
CREATE OR REPLACE FUNCTION auth.user_team_id()
RETURNS uuid AS $$
  SELECT team_id FROM user_settings WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper function to check if calling user is super admin
CREATE OR REPLACE FUNCTION auth.is_super_admin()
RETURNS boolean AS $$
  SELECT system_username IN ('ali.elzein', 'ali.alzein')
  FROM user_settings WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Example RLS policy for tickets (replicate for all tables)
CREATE POLICY "team_isolation_select" ON tickets
  FOR SELECT USING (
    auth.is_super_admin()
    OR team_id = auth.user_team_id()
    OR team_id IS NULL  -- legacy rows before migration
  );

CREATE POLICY "team_isolation_insert" ON tickets
  FOR INSERT WITH CHECK (
    auth.is_super_admin()
    OR team_id = auth.user_team_id()
  );

CREATE POLICY "team_isolation_update" ON tickets
  FOR UPDATE USING (
    auth.is_super_admin()
    OR team_id = auth.user_team_id()
  );

CREATE POLICY "team_isolation_delete" ON tickets
  FOR DELETE USING (
    auth.is_super_admin()
    OR team_id = auth.user_team_id()
  );
```

> **Note**: `team_id IS NULL` clause in SELECT is the safety net for Phase 3 (legacy data). Remove this after Phase 3 seed is complete and verified.

---

## PHASE 3 — DATABASE: Seed Existing Data with Default Team

### Goal
Assign all existing rows (tickets, points, badges, etc.) to the original/default team so they remain visible and functional after RLS is applied.

### Steps

1. **Identify the default team** — The existing team in `teams` table (create one if it doesn't exist)

```sql
-- Create default team if not exists
INSERT INTO teams (id, name, description, is_active, created_at)
VALUES (
  gen_random_uuid(),  -- or use a fixed UUID for predictability
  'Main Team',
  'Original team — migrated from pre-multi-team system',
  true,
  now()
)
ON CONFLICT (name) DO NOTHING;
```

2. **Store the default team ID** (run once, note the UUID)

```sql
SELECT id FROM teams WHERE name = 'Main Team';
-- Note this UUID as: <DEFAULT_TEAM_ID>
```

3. **Backfill all operational tables**

```sql
-- Replace <DEFAULT_TEAM_ID> with the actual UUID from step 2

UPDATE tickets SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
UPDATE user_points SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
UPDATE user_badges SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
UPDATE badge_stats SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
UPDATE badge_notifications SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
UPDATE attendance SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
UPDATE schedules SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
UPDATE default_schedules SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
UPDATE weekly_leaderboard SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
UPDATE milestone_notifications SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
```

4. **Assign existing users to the default team** (if not already assigned)

```sql
UPDATE user_settings
SET team_id = '<DEFAULT_TEAM_ID>'
WHERE team_id IS NULL;
```

5. **After verification**, remove the `OR team_id IS NULL` clause from all RLS SELECT policies.

---

## PHASE 4 — EDGE FUNCTIONS: Update `award-points`

### Goal
The `award-points` edge function must:
1. Accept and store `team_id` when awarding points
2. Apply badge logic scoped to the team
3. Update weekly leaderboard with `team_id`
4. All queries inside the function must filter by `team_id`

### Changes to `supabase/functions/award-points/index.js`

#### a) Accept team_id in request payload
```javascript
// In the request body destructuring, add:
const { user_id, username, event_type, team_id, ...rest } = body;

// If team_id is not passed, look it up from user_settings
let resolvedTeamId = team_id;
if (!resolvedTeamId) {
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('team_id')
    .eq('user_id', user_id)
    .single();
  resolvedTeamId = userSettings?.team_id;
}
```

#### b) Pass team_id to all INSERT operations
```javascript
// Every insert into user_points must include team_id:
await supabase.from('user_points').insert({
  user_id,
  username,
  points_awarded,
  event_type,
  team_id: resolvedTeamId,  // ADD THIS
  ...
});

// Every insert/update into user_badges must include team_id:
await supabase.from('user_badges').upsert({
  user_id,
  username,
  badge_id,
  team_id: resolvedTeamId,  // ADD THIS
  ...
});
```

#### c) Scope badge queries to team
```javascript
// When checking badge_stats, filter by team_id:
const { data: stats } = await supabase
  .from('badge_stats')
  .select('*')
  .eq('user_id', user_id)
  .eq('team_id', resolvedTeamId)  // ADD THIS
  .eq('stat_date', today)
  .single();
```

#### d) Update weekly leaderboard with team_id
```javascript
await supabase.from('weekly_leaderboard').upsert({
  week_start_date,
  username,
  total_score,
  team_id: resolvedTeamId,  // ADD THIS
  ...
});
```

#### e) Client Hero badge (top scorer) — scope to team
The nightly Client Hero logic must find the top scorer **within the same team**, not globally:
```javascript
// Filter leaderboard query by team_id for Client Hero award
const { data: topScorer } = await supabase
  .from('user_points')
  .select('username, sum(points_awarded)')
  .eq('team_id', resolvedTeamId)  // ADD THIS
  ...
```

---

## PHASE 5 — EDGE FUNCTIONS: Minor Updates to Other Functions

### `verify-admin/index.ts`
- Already checks `is_team_leader` — **no change needed**
- Optionally return `team_id` in the response for frontend use

### `admin-create-user/index.ts`
- Already handles `team_id` assignment — **no change needed**
- Verify it inserts into `team_members` table correctly

### `check-and-send-reminders-edge-function.js`
- Currently broadcasts to ALL users
- Decision point: should deployment reminders be team-scoped or global?
- **Recommendation**: Keep global (affects all teams), or add optional `team_id` filter
- If team-scoped: filter `deployment_notes` by `team_id` and broadcast only to that team's channel

---

## PHASE 6 — FRONTEND: Team-Scoped Queries on Main App

### Goal
Every Supabase query on the main app (`index.html` and its JS modules) must be filtered by the logged-in user's `team_id`. The user's `team_id` is available from `user_settings`.

### Where to get team_id on the frontend

In `js/state.js` or `js/userSettings.js`, when the user logs in, store their `team_id`:
```javascript
// After login, fetch user settings:
const { data: settings } = await supabase
  .from('user_settings')
  .select('team_id, is_team_leader, ...')
  .eq('user_id', user.id)
  .single();

// Store in app state:
state.currentTeamId = settings.team_id;
```

### Files to update

#### `js/tickets.js`
```javascript
// All ticket queries must add: .eq('team_id', state.currentTeamId)
// Example:
const { data: tickets } = await supabase
  .from('tickets')
  .select('*')
  .eq('team_id', state.currentTeamId)  // ADD THIS
  .order('created_at', { ascending: false });

// New ticket creation must set team_id:
await supabase.from('tickets').insert({
  ...ticketData,
  team_id: state.currentTeamId,  // ADD THIS
});
```

#### `js/main.js`
```javascript
// KPI queries, badge queries, user list queries — add team_id filter
// Leaderboard query:
const { data: leaderboard } = await supabase
  .from('weekly_leaderboard')
  .select('*')
  .eq('team_id', state.currentTeamId)  // ADD THIS
  .order('total_score', { ascending: false });
```

#### `js/badges.js` and `js/badges-ui.js`
```javascript
// Badge stats queries:
const { data: stats } = await supabase
  .from('badge_stats')
  .select('*')
  .eq('user_id', userId)
  .eq('team_id', state.currentTeamId);  // ADD THIS

// Badge notifications:
const { data: notifications } = await supabase
  .from('badge_notifications')
  .select('*')
  .eq('team_id', state.currentTeamId);  // ADD THIS
```

#### `js/schedule.js`
```javascript
// Attendance insert:
await supabase.from('attendance').insert({
  ...attendanceData,
  team_id: state.currentTeamId,  // ADD THIS
});

// Attendance queries:
const { data: attendance } = await supabase
  .from('attendance')
  .select('*')
  .eq('team_id', state.currentTeamId);  // ADD THIS
```

#### `js/userSettings.js`
```javascript
// When loading users for color/display, filter to same team:
const { data: users } = await supabase
  .from('user_settings')
  .select('*')
  .eq('team_id', state.currentTeamId);  // ADD THIS (for team member lists)
```

#### `js/presence.js`
- User presence: team-scoped channel subscriptions
- Change Supabase Realtime channel name to include team_id:
```javascript
const channel = supabase.channel(`presence:team:${state.currentTeamId}`);
```

### Award-points calls from frontend
```javascript
// Any fetch() call to award-points edge function must pass team_id:
await fetch('/functions/v1/award-points', {
  method: 'POST',
  body: JSON.stringify({
    user_id,
    username,
    event_type,
    team_id: state.currentTeamId,  // ADD THIS
    ...
  })
});
```

---

## PHASE 7 — FRONTEND: Team Leader Panel

### Goal
Create a scaled-down admin panel for team leaders (`team-leader/index.html`) that lets them:
- View their team's tickets and users
- Manage user colors/display names for their team
- View their team's KPIs, leaderboard, attendance
- Block/unblock their team members (if desired)
- Cannot create/delete users (super admin only)
- Cannot see other teams' data

### New files to create

```
team-leader/
├── index.html          # Team leader dashboard
├── js/
│   ├── tl-main.js      # Initialization, auth check, redirect if not TL
│   ├── tl-users.js     # View/manage team members
│   ├── tl-tickets.js   # Team ticket overview
│   ├── tl-analytics.js # Team KPIs and leaderboard
│   └── tl-schedule.js  # Team attendance/schedule view
└── css/
    └── tl-style.css    # Styles (can reuse main style.css)
```

### Auth check in `tl-main.js`
```javascript
// On load, verify user is a team leader
const response = await fetch('/functions/v1/verify-admin', {
  headers: { Authorization: `Bearer ${session.access_token}` }
});
const { is_team_leader, team_id } = await response.json();

if (!is_team_leader) {
  window.location.href = '/index.html';  // redirect non-leaders
}
state.currentTeamId = team_id;
```

### Features to include
- **Users tab**: List team members, their display name, color, points, status (online/offline), blocked status
- **Tickets tab**: Team ticket list — same as main app view but view-only or with limited editing
- **Leaderboard tab**: Team weekly leaderboard
- **Attendance tab**: Team attendance records and shifts
- **Analytics tab**: KPI summary for the team

### Navigation link
Add a "Team Management" link in the main `index.html` header that is only visible to `is_team_leader` users (and hidden from super admin who has the full admin panel).

---

## PHASE 8 — FRONTEND: Admin Panel — Teams Section + All-Teams Visibility

### Goal
The existing admin panel needs two things:
1. A fully functional **Teams section** (currently a placeholder in `admin-main.js:414`)
2. Super Admin continues to see ALL data — no changes needed to queries (RLS bypasses for super admin automatically)

---

### 8a — New File: `admin/js/admin-teams.js`

This new module handles all team CRUD from the admin panel.

#### Functions to implement

```javascript
// Load and render all teams
async function loadAllTeams()

// Render the teams table/grid
function renderTeamsTable(teams)

// Open modal to create a new team
function openCreateTeamModal()

// Handle create team form submit
async function handleCreateTeam(e)
  // INSERT into teams: { name, description, is_active: true, created_by: adminId }
  // Optionally assign a team leader on creation
  // Reload teams list

// Open modal to edit/rename a team
function openEditTeamModal(teamId)

// Handle edit team form submit
async function handleEditTeam(e)
  // UPDATE teams SET name, description WHERE id = teamId

// Deactivate a team (soft delete — sets is_active = false)
async function deactivateTeam(teamId)
  // UPDATE teams SET is_active = false WHERE id = teamId
  // Show confirmation first

// Reactivate a team
async function reactivateTeam(teamId)
  // UPDATE teams SET is_active = true WHERE id = teamId

// Open modal to view team members
async function openTeamMembersModal(teamId)
  // SELECT user_settings WHERE team_id = teamId
  // Show list of members with their display names and roles

// Assign a team leader to a team from within the Teams section
async function assignTeamLeader(teamId, userId)
  // UPDATE teams SET team_lead_id = userId WHERE id = teamId
  // UPDATE user_settings SET is_team_leader = true, team_leader_for_team_id = teamId WHERE user_id = userId
  // Clear previous team leader for this team if one existed

// Remove team leader from a team
async function removeTeamLeader(teamId)
  // UPDATE teams SET team_lead_id = null WHERE id = teamId
  // UPDATE user_settings SET is_team_leader = false, team_leader_for_team_id = null
  //   WHERE team_leader_for_team_id = teamId

// Move a user to a different team
async function moveUserToTeam(userId, newTeamId)
  // UPDATE user_settings SET team_id = newTeamId WHERE user_id = userId
  // INSERT INTO team_members (team_id, user_id) ON CONFLICT DO UPDATE
  // DELETE from team_members WHERE user_id = userId AND team_id != newTeamId
```

---

### 8b — Teams Section UI (in `admin/index.html`)

The Teams section HTML (inside `<div id="section-teams">`) should include:

#### Teams List View
```
┌─────────────────────────────────────────────────────┐
│  Teams                              [+ Create Team]  │
│  ─────────────────────────────────────────────────  │
│  Search teams...          [Active ▼] [All ▼]        │
│                                                     │
│  ┌──────────────────────────────────────────────┐  │
│  │ Team Name   │ Leader      │ Members │ Status  │  │
│  │─────────────│─────────────│─────────│─────────│  │
│  │ Main Team   │ ali.elzein  │  8      │ Active  │  │
│  │ Team B      │ No leader   │  3      │ Active  │  │
│  └──────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

Each row has action buttons:
- **View Members** — opens members modal
- **Edit** — opens edit modal (rename/description)
- **Assign Leader** — dropdown to select a user as leader
- **Deactivate** — soft-disable the team (confirm dialog)

#### Create Team Modal fields:
- Team Name (required, unique)
- Description (optional)
- Team Leader (optional dropdown — populated from users with no current leader role)

#### Edit Team Modal fields:
- Team Name
- Description

#### Team Members Modal:
- Table of members: Avatar | Display Name | Username | Role (Leader/Member) | Status (Active/Blocked)
- "Remove from team" button per member (moves them to "No Team")
- "Move to another team" dropdown per member

---

### 8c — Wire `loadTeams()` in `admin-main.js`

Replace the placeholder:
```javascript
// BEFORE (admin-main.js:414):
async function loadTeams() {
    console.log('[Admin] Teams section - coming soon');
}

// AFTER:
async function loadTeams() {
    const { loadAllTeams } = await import('./admin-teams.js');
    await loadAllTeams();
}
```

Also import and initialize `admin-teams.js` in the `init()` function alongside the other modules:
```javascript
// In init(), after initUserManagement():
const { initTeamManagement } = await import('./admin-teams.js');
await initTeamManagement();
```

---

### 8d — Dashboard Stats (already partially working)

`admin-main.js:loadDashboard()` already fetches:
- `stat-users` — user count (team-scoped for team leaders)
- `stat-teams` — team count
- `stat-tickets` — ticket count (team-scoped for team leaders)
- `stat-active-users` — total user count

No changes needed for super admin. After Phase 1-3, team-leader counts will automatically be scoped via RLS.

---

## PHASE 9 — TESTING & VALIDATION

### Test Checklist

#### Data Isolation Tests
- [ ] Create a test user in Team B
- [ ] Verify Team B user cannot see Team A tickets
- [ ] Verify Team B user's points don't appear in Team A leaderboard
- [ ] Verify Team A users cannot see Team B's attendance

#### Team Leader Tests
- [ ] Team leader can view their team's data
- [ ] Team leader cannot access other teams' data
- [ ] Team leader cannot create/delete users
- [ ] Team leader panel redirects non-leaders

#### Super Admin Tests
- [ ] Super admin sees ALL teams' tickets
- [ ] Super admin can filter by team
- [ ] Super admin can create teams and assign leaders
- [ ] Audit log captures all admin actions

#### Points/Badges Tests
- [ ] Creating a ticket in Team B awards points scoped to Team B
- [ ] Team B's leaderboard is separate from Team A
- [ ] Badge stats are team-specific
- [ ] Client Hero badge is team-scoped

#### Legacy Data Tests
- [ ] Team A data (migrated in Phase 3) is still fully visible to Team A members
- [ ] Team A scores and badges unchanged after migration
- [ ] No data loss during migration

#### Realtime Tests
- [ ] Team A ticket update doesn't trigger Team B's UI
- [ ] Presence channels are team-scoped

---

## DECISIONS TO MAKE BEFORE STARTING

1. **Deployment Notes**: Should be global (all teams see same reminders) or per-team?
   - Recommendation: **Global** — keep as-is
2. **User Pings**: Should pings be team-scoped?
   - Recommendation: **Global** — pings are direct messages, not team data
3. **Knowledge Base**: Should each team have their own KB?
   - Recommendation: **Shared global KB** or **per-team** depending on business need
4. **Client Guides**: Same as Knowledge Base question
5. **Team leader can block users**: Yes or No?
   - Current code only allows super admin. Decide if team leaders need this.
6. **Ticket ID numbering**: Per-team sequential IDs or global IDs?
   - Recommendation: **Global** — simpler, no breaking change

---

## MIGRATION SAFETY RULES

1. **Always add columns as NULLABLE first** — never break existing inserts
2. **Apply RLS policies after** data is seeded — never before
3. **Test on a staging/copy of the DB** before touching production
4. **Run Phase 3 backfill** in a single transaction so it's atomic
5. **Deploy edge function changes** before enabling RLS on `user_points` / `user_badges`
6. **Keep the `team_id IS NULL` RLS escape hatch** until Phase 3 is verified complete

---

## FILE CHANGE SUMMARY

### New Files
- `team-leader/index.html`
- `team-leader/js/tl-main.js`
- `team-leader/js/tl-users.js`
- `team-leader/js/tl-tickets.js`
- `team-leader/js/tl-analytics.js`
- `team-leader/js/tl-schedule.js`
- `team-leader/css/tl-style.css`

### Modified Files
- `js/state.js` — add `currentTeamId` to state
- `js/userSettings.js` — store/expose `team_id` after login
- `js/tickets.js` — add `team_id` filter to all queries + insert
- `js/main.js` — add `team_id` filter to leaderboard, KPI, user queries
- `js/badges.js` — add `team_id` filter to badge queries
- `js/badges-ui.js` — minor
- `js/schedule.js` — add `team_id` to attendance insert/query
- `js/presence.js` — scope realtime channel to team
- `admin/js/user-management.js` — team management CRUD
- `admin/index.html` — add Teams section and team filter dropdown
- `supabase/functions/award-points/index.js` — add team_id to all inserts/queries

### Database Migrations (Supabase SQL Editor)
1. Phase 1 migrations (ALTER TABLE)
2. Phase 2 RLS policies
3. Phase 3 data seed/backfill

---

*Plan created: 2026-02-10*
*Status: Ready for Phase-by-Phase Implementation*
