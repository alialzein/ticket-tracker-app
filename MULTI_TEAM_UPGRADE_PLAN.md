# Multi-Team Upgrade Plan
**B-Pal Ticket Tracker — Team Isolation & Multi-Team Support**

---

## CURRENT STATE SUMMARY

The database already has `teams`, `team_members` tables, and `user_settings` already has `team_id`, `is_team_leader`, and `team_leader_for_team_id` columns. The `verify-admin` and `admin-create-user` edge functions already have team-awareness logic.

**What is MISSING is data isolation** — all operational tables (tickets, points, badges, attendance, etc.) have no `team_id`, so every user sees every other user's data regardless of team.

### Access Control Model (Confirmed)

| Role | Who | Admin Panel Access | Data Scope |
|------|-----|--------------------|------------|
| **Super Admin** | ali.elzein / ali.alzein (hardcoded in `verify-admin:84`) | Full access — all sections, all teams | Sees ALL teams' data |
| **Team Leader** | `is_team_leader = true` in `user_settings` | Limited — enters admin panel but only sees their team's data | Only their `team_leader_for_team_id` |
| **Regular User** | Everyone else | No admin panel access — redirected to main app | Only their team's data (after Phase 6) |

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
| Teams section — full UI + Create Team modal | ✅ Done | `admin/js/admin-teams.js` (Phase 8 complete) |
| Create a new team | ✅ Done | `admin-teams.js → handleCreateTeam()` |
| View all teams with member counts | ✅ Done | `admin-teams.js → renderTeamsTable()` |
| Edit / rename a team | ✅ Done | `admin-teams.js → handleEditTeam()` |
| Deactivate / reactivate a team | ✅ Done | `admin-teams.js → deactivateTeam/reactivateTeam()` |
| Assign / change team leader from Teams section | ✅ Done | `admin-teams.js → handleEditTeam()` |
| View team members from Teams section | ✅ Done | `admin-teams.js → openViewMembersModal()` |
| **Hide Teams tab from team leaders** | ❌ Pending | `admin-main.js → setupUI()` — needs one line |
| Cross-team analytics (per-team stats) | ❌ Pending | Future phase |

---

## GOAL

- Each team operates in a fully isolated environment (their own tickets, points, badges, attendance, leaderboard)
- Teams get the same dashboard as the main dashboard, but filtered to their own data
- Team leaders enter the admin panel but can only see/manage data belonging to their team
- Super Admin (`ali.elzein` / `ali.alzein`) sees and manages ALL teams from the existing admin panel
- **Zero impact on the currently working system** — the existing team keeps working as-is throughout the migration

---

## PHASE OVERVIEW

| Phase | Scope | Status |
|-------|-------|--------|
| 8 | Admin Panel — Teams Section | ✅ Complete |
| 8.1 | Admin Panel — Hide Teams tab from team leaders | ❌ Pending (1 line) |
| 1 | DB: Add team_id to all data tables | ❌ Pending |
| 2 | DB: Row Level Security (RLS) policies | ❌ Pending |
| 3 | DB: Seed existing data with default team | ❌ Pending |
| 4 | Edge Functions: Add team_id to award-points | ❌ Pending |
| 5 | Edge Functions: Minor updates | ❌ Pending |
| 6 | Frontend: Team-scoped queries on main app | ❌ Pending |
| 7 | Frontend: Team Leader Panel (scaled-down admin) | ❌ Pending |
| 9 | Testing & Validation | ❌ Pending |

> **Recommended order**: 8.1 → 1 → 3 → 2 → 4 → 5 → 6 → 7 → 9

---

## PHASE 8 — ADMIN PANEL: Teams Section ✅ COMPLETE

### What was built

**New file `admin/js/admin-teams.js`** — full team CRUD module:
- `loadAllTeams()` — fetches teams + users in parallel, computes member counts and leader names
- `renderTeamsTable()` — renders table with search/filter/action buttons
- `handleCreateTeam()` — INSERT into `teams`, grants leader access to selected user
- `handleEditTeam()` — UPDATE name/description/leader, swaps leader permissions atomically
- `deactivateTeam()` / `reactivateTeam()` — soft toggle `is_active`
- `openViewMembersModal()` — shows all team members with Leader/Member badge

**Updated `admin/index.html`**:
- Replaced "coming soon" placeholder with full Teams UI (table + search + filters + Create button)
- Added 3 modals: Create Team, Edit Team, View Members
- Added `<script type="module" src="js/admin-teams.js">`

**Updated `admin/js/admin-main.js`**:
- `loadTeams()` dynamically imports and calls `loadAllTeams()`
- `init()` calls `initTeamManagement()` to register event listeners on startup

---

## PHASE 8.1 — Hide Teams Tab from Team Leaders ❌ PENDING

### Goal
Team leaders should NOT see the Teams section — that is super admin only.
The sidebar nav link for Teams must be hidden when `adminState.isSuperAdmin === false`.

### Change needed in `admin/js/admin-main.js → setupUI()`

```javascript
// In setupUI(), add after setting the display name:
if (!adminState.isSuperAdmin) {
    // Hide Teams nav link — team management is super admin only
    const teamsNavLink = document.querySelector('[data-section="teams"]');
    if (teamsNavLink) teamsNavLink.closest('a').style.display = 'none';
}
```

> Note: `setupUI()` runs after `verifyAdminAccess()`, so `adminState.isSuperAdmin` is already populated.

---

## PHASE 1 — DATABASE: Add `team_id` to Operational Tables ❌ PENDING

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

### SQL Migrations (run in Supabase SQL Editor)

```sql
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

## PHASE 3 — DATABASE: Seed Existing Data with Default Team ❌ PENDING

> **Run Phase 1 first, then Phase 3, then Phase 2 (RLS last)**

### Goal
Assign all existing rows to the original team so they remain visible after RLS is applied.

### Steps

```sql
-- Step 1: Create the default team (if it doesn't already exist)
INSERT INTO teams (id, name, description, is_active, created_at)
VALUES (
  gen_random_uuid(),
  'Main Team',
  'Original team — migrated from pre-multi-team system',
  true,
  now()
)
ON CONFLICT (name) DO NOTHING;

-- Step 2: Get the team ID (note this UUID)
SELECT id FROM teams WHERE name = 'Main Team';
-- Use the result as <DEFAULT_TEAM_ID> in the queries below

-- Step 3: Backfill all operational tables
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

-- Step 4: Assign existing users to the default team
UPDATE user_settings SET team_id = '<DEFAULT_TEAM_ID>' WHERE team_id IS NULL;
```

---

## PHASE 2 — DATABASE: Row Level Security (RLS) Policies ❌ PENDING

> **Run AFTER Phase 3 backfill is complete and verified**

### Strategy
- **Super Admin** (ali.elzein / ali.alzein): bypasses all RLS — sees everything
- **Team Leader**: sees only rows where `team_id = their team`
- **Regular User**: sees only rows where `team_id = their team`
- **Service Role** (edge functions): bypasses RLS entirely

### SQL

```sql
-- Helper functions
CREATE OR REPLACE FUNCTION auth.user_team_id()
RETURNS uuid AS $$
  SELECT team_id FROM user_settings WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION auth.is_super_admin()
RETURNS boolean AS $$
  SELECT system_username IN ('ali.elzein', 'ali.alzein')
  FROM user_settings WHERE user_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Enable RLS
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_badges ENABLE ROW LEVEL SECURITY;
ALTER TABLE badge_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_leaderboard ENABLE ROW LEVEL SECURITY;

-- RLS policies for tickets (repeat same pattern for all tables above)
CREATE POLICY "team_isolation_select" ON tickets
  FOR SELECT USING (
    auth.is_super_admin()
    OR team_id = auth.user_team_id()
    OR team_id IS NULL  -- safety net: remove after Phase 3 verified
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
-- Repeat CREATE POLICY blocks for: user_points, user_badges, badge_stats, attendance, weekly_leaderboard
```

> Once Phase 3 backfill is verified complete, remove `OR team_id IS NULL` from all SELECT policies.

---

## PHASE 4 — EDGE FUNCTIONS: Update `award-points` ❌ PENDING

### Changes to `supabase/functions/award-points/index.js`

#### a) Accept team_id — resolve from user_settings if not passed
```javascript
const { user_id, username, event_type, team_id, ...rest } = body;

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

#### b) Add team_id to every INSERT
```javascript
// user_points inserts:
await supabase.from('user_points').insert({
  user_id, username, points_awarded, event_type,
  team_id: resolvedTeamId,  // ADD
});

// user_badges upserts:
await supabase.from('user_badges').upsert({
  user_id, username, badge_id,
  team_id: resolvedTeamId,  // ADD
});

// weekly_leaderboard upserts:
await supabase.from('weekly_leaderboard').upsert({
  week_start_date, username, total_score,
  team_id: resolvedTeamId,  // ADD
});
```

#### c) Scope badge_stats queries to team
```javascript
const { data: stats } = await supabase
  .from('badge_stats')
  .select('*')
  .eq('user_id', user_id)
  .eq('team_id', resolvedTeamId)  // ADD
  .eq('stat_date', today)
  .single();
```

#### d) Scope Client Hero (top scorer) to team
```javascript
const { data: topScorer } = await supabase
  .from('user_points')
  .select('username, sum(points_awarded)')
  .eq('team_id', resolvedTeamId)  // ADD — hero is top scorer within same team only
  ...
```

---

## PHASE 5 — EDGE FUNCTIONS: Minor Updates ❌ PENDING

### `verify-admin/index.ts`
- Already checks `is_team_leader` — **no structural change needed**
- Already returns `teamLeaderForTeamId` — frontend uses this correctly

### `admin-create-user/index.ts`
- Already handles `team_id` assignment and `team_members` insert — **no change needed**

### `check-and-send-reminders-edge-function.js`
- Currently broadcasts to ALL users
- **Decision**: Keep global (recommended) — deployment reminders apply to all teams

---

## PHASE 6 — FRONTEND: Team-Scoped Queries on Main App ❌ PENDING

### Goal
Every Supabase query on the main app must be filtered by the logged-in user's `team_id`.

### Step 1 — Store team_id in app state at login

In `js/state.js` or `js/userSettings.js`:
```javascript
const { data: settings } = await supabase
  .from('user_settings')
  .select('team_id, is_team_leader, ...')
  .eq('user_id', user.id)
  .single();

state.currentTeamId = settings.team_id;
```

### Files to update

| File | Changes |
|------|---------|
| `js/state.js` | Add `currentTeamId` field to state |
| `js/userSettings.js` | Fetch and store `team_id` after login |
| `js/tickets.js` | Add `.eq('team_id', state.currentTeamId)` to all queries; add `team_id` to ticket inserts |
| `js/main.js` | Add team filter to leaderboard, KPI, and user list queries |
| `js/badges.js` | Add team filter to badge_stats and badge_notifications queries |
| `js/schedule.js` | Add `team_id` to attendance inserts; filter attendance queries by team |
| `js/presence.js` | Change channel name: `presence:team:${state.currentTeamId}` |

### All award-points fetch calls must pass team_id
```javascript
await fetch('.../award-points', {
  method: 'POST',
  body: JSON.stringify({
    user_id, username, event_type,
    team_id: state.currentTeamId,  // ADD TO EVERY CALL
  })
});
```

---

## PHASE 7 — FRONTEND: Team Leader Panel ❌ PENDING

### Goal
Team leaders currently enter the admin panel (`admin/index.html`) with restricted data scope.
This phase makes the admin panel fully aware of team leader context for each section.

### What already works for team leaders in admin panel
- Users section: already scoped to their team (`user-management.js:151`)
- Dashboard counts: already scoped (`admin-main.js:309, 357, 385`)
- Create user / delete user buttons: already hidden
- Team leader checkbox: already hidden from non-super-admins

### What still needs team-leader scoping (when those sections are built)
- **Tickets section**: filter ticket search results to `team_id = teamLeaderForTeamId`
- **Analytics section**: scope activity logs, weekly history, KPI reports to their team
- **Attendance section**: scope attendance report user dropdown to their team only

### Navigation — link from main app to admin panel
Add a link in `index.html` main app header visible only to team leaders:
```html
<!-- Show only if user is_team_leader -->
<a href="/admin/index.html" id="team-leader-panel-link" class="hidden">
  Team Panel
</a>
```
In main app JS, after login:
```javascript
if (userSettings.is_team_leader) {
  document.getElementById('team-leader-panel-link').classList.remove('hidden');
}
```

---

## PHASE 9 — TESTING & VALIDATION ❌ PENDING

### Test Checklist

#### Data Isolation Tests
- [ ] Create a test user in Team B
- [ ] Verify Team B user cannot see Team A tickets
- [ ] Verify Team B user's points don't appear in Team A leaderboard
- [ ] Verify Team A users cannot see Team B's attendance

#### Team Leader Tests
- [ ] Team leader enters admin panel and sees only their team's users
- [ ] Team leader cannot see the Teams nav section
- [ ] Team leader cannot create/delete users
- [ ] Non-team-leader is redirected away from admin panel

#### Super Admin Tests
- [ ] Super admin sees ALL teams' tickets, users, data
- [ ] Super admin can create teams and assign leaders
- [ ] Super admin Teams section works: create, edit, deactivate, view members
- [ ] Audit log captures all admin actions

#### Points/Badges Tests
- [ ] Creating a ticket in Team B awards points scoped to Team B
- [ ] Team B's leaderboard is separate from Team A
- [ ] Badge stats are team-specific
- [ ] Client Hero badge is scoped to the team (Team B hero != Team A hero)

#### Legacy Data Tests
- [ ] Main Team data (migrated in Phase 3) is still fully visible to Main Team members
- [ ] Main Team scores and badges unchanged after migration
- [ ] No data loss during migration

#### Realtime Tests
- [ ] Team A ticket update doesn't trigger Team B's UI
- [ ] Presence channels are team-scoped (Team A online users not shown to Team B)

---

## DECISIONS MADE

1. **Deployment Notes** — Global (all teams see same reminders) ✅
2. **User Pings** — Global (direct messages, not team-scoped) ✅
3. **Knowledge Base** — To be decided (shared global KB recommended)
4. **Client Guides** — To be decided
5. **Team leader can block users** — No (super admin only) ✅
6. **Ticket ID numbering** — Global sequential IDs (no breaking change) ✅

---

## MIGRATION SAFETY RULES

1. **Always add columns as NULLABLE first** — never break existing inserts
2. **Run Phase 1 → Phase 3 → Phase 2** in that order (RLS always last)
3. **Deploy edge function changes (Phase 4)** before enabling RLS on `user_points` / `user_badges`
4. **Keep `OR team_id IS NULL` escape hatch** in RLS SELECT policies until Phase 3 backfill is verified
5. **Test on a staging/copy of the DB** before touching production

---

## FILE CHANGE SUMMARY

### Completed ✅
- `admin/js/admin-teams.js` — **new file** — full Teams CRUD module
- `admin/index.html` — Teams section UI + 3 modals + script tag
- `admin/js/admin-main.js` — wired `loadTeams()` + `initTeamManagement()`

### Pending ❌
- `admin/js/admin-main.js` — hide Teams nav link from team leaders (Phase 8.1)
- `js/state.js` — add `currentTeamId` field (Phase 6)
- `js/userSettings.js` — fetch and store `team_id` at login (Phase 6)
- `js/tickets.js` — team_id filter on all queries + insert (Phase 6)
- `js/main.js` — team_id filter on leaderboard, KPI, users (Phase 6)
- `js/badges.js` — team_id filter on badge queries (Phase 6)
- `js/schedule.js` — team_id on attendance insert/query (Phase 6)
- `js/presence.js` — team-scoped realtime channel (Phase 6)
- `index.html` — Team Panel link for team leaders (Phase 7)
- `supabase/functions/award-points/index.js` — team_id on all inserts/queries (Phase 4)

### Database Migrations (Supabase SQL Editor)
1. Phase 1 — ALTER TABLE migrations
2. Phase 3 — seed/backfill existing data
3. Phase 2 — RLS policies (run last)

---

*Plan created: 2026-02-10*
*Last updated: 2026-02-10*
*Phase 8 (Admin Teams Section): COMPLETE*
*Next: Phase 8.1 — hide Teams tab from team leaders (1 line change)*
