# B-Pal Ticket Tracker — Role Permissions Summary

## Roles Overview

| Role | How Assigned | Admin Panel Access |
|------|-------------|-------------------|
| **Super Admin** | Hardcoded email match (`ali.elzein` / `ali.alzein`) OR `is_super_admin` DB flag | Full access |
| **Team Leader** | `user_settings.is_team_leader = true` + `team_leader_for_team_id` set | Scoped access (own team only) |
| **Regular User** | Default (no special flags) | None |

---

## Super Admin

**Identity:** ali.elzein / ali.alzein (verified server-side in `verify-admin` Edge Function)

### Admin Panel
- Full unrestricted access to all admin panel sections
- Can see and manage all teams simultaneously
- Dashboard stats reflect the entire system (all teams combined)

### User Management
- View all users across all teams
- Create new users and assign them to any team
- Assign / remove Team Leader role for any user
- Block / unblock any user
- Edit any user's profile, team assignment, and role

### Team Management
- Create new teams
- Edit team name, description, and team leader
- Deactivate / reactivate teams
- View members of any team
- Reassign users between teams

### Tickets & Data
- View all tickets across all teams
- Create, edit, assign, and resolve tickets for any team
- Full access to points, badges, leaderboard, and attendance for all teams

### System
- Access analytics across all teams
- Access archive across all teams
- Access all settings
- No restrictions on any operation

---

## Team Leader

**Identity:** `user_settings.is_team_leader = true` and `user_settings.team_leader_for_team_id` is set

### Admin Panel
- Can log into the admin panel
- Sees only data scoped to their assigned team (`team_leader_for_team_id`)
- **Cannot** access the Teams management section (hidden from nav)

### User Management
- View users in their team only
- **Cannot** create new users
- **Cannot** assign / remove Team Leader role
- **Cannot** block / unblock users
- Can edit basic profile info for users in their team (limited)

### Team Management
- **No access** — Teams nav tab is hidden
- Cannot create, edit, or deactivate teams
- Cannot reassign users to other teams

### Tickets & Data
- View tickets belonging to their team only
- Can manage (assign, update, resolve) tickets within their team
- Points, badges, leaderboard, and attendance scoped to their team only

### System
- Analytics scoped to their team only
- Archive scoped to their team only
- Settings — limited / read-only (TBD per phase)

---

## Regular User

**Identity:** Default — no `is_team_leader` flag, not super admin

### Admin Panel
- **No access** — redirected to login page if they attempt to visit `/admin`
- Server-side verification (`verify-admin` Edge Function) enforces this

### Main App
- Can submit and track their own tickets
- Can view team leaderboard (their team only, post-migration)
- Can view their own points, badges, and attendance
- Cannot see other teams' data

### Restrictions
- Cannot create or manage teams
- Cannot manage other users
- Cannot access any admin functionality

---

## Data Isolation Summary (Post Multi-Team Migration)

| Data Type | Super Admin | Team Leader | Regular User |
|-----------|-------------|-------------|--------------|
| Tickets | All teams | Own team only | Own tickets only |
| Points / Badges | All teams | Own team only | Own data only |
| Leaderboard | All teams | Own team only | Own team only |
| Attendance | All teams | Own team only | Own data only |
| User list | All users | Own team users | Not accessible |
| Teams list | All teams | Not accessible | Not accessible |
| Analytics | All teams | Own team only | Not accessible |
| Archive | All teams | Own team only | Not accessible |

---

## Enforcement Layers

1. **Server-side (Edge Function):** `verify-admin` checks role before granting admin panel entry
2. **Database (RLS):** Row Level Security policies on all tables enforce team_id scoping
3. **Frontend (JS):** Admin panel JS hides/shows UI elements based on `adminState.isSuperAdmin` and `adminState.isTeamLeader`
4. **SQL (SECURITY DEFINER):** Sensitive operations (team mutations with FK to `auth.users`) run via RPC functions to avoid permission errors

---

*Last updated: 2026-02-10 — Reflects Phase 8 (Admin Teams Section) complete.*
*See `MULTI_TEAM_UPGRADE_PLAN.md` for full implementation phases and migration details.*
