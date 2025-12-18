# Admin Panel - Implementation Plan

## 🎯 Project Overview
Create a professional, separate admin panel for managing users, teams, attendance, and system settings. Currently all users are part of "Bpal support team" - we'll migrate to a proper team management system.

---

## 📋 Current State (Updated 2025-12-18)
- ✅ **Phase 1 COMPLETED**: Foundation, structure, and basic features
- ✅ **Phase 2 COMPLETED**: Dashboard with stats and analytics features
- ✅ Dedicated admin panel at `/admin/` with professional UI
- ✅ All old admin features migrated and organized
- ✅ Database schema created with RLS policies (migration completed)
- ✅ Signup removed from main app (login-only)
- ✅ Admin panel uses correct database columns
- ✅ KPI Analysis replaced with tier-based bonus system
- ✅ Admin audit log working with SECURITY DEFINER function
- ✅ KPI view expands fully without scrolling
- **Next**: Phase 3 - Full User Management (Create, Edit, Block, Delete)

---

## 🎯 Target State
- Dedicated admin panel (separate page: `/admin/index.html`)
- Comprehensive user management (create, edit, block, delete)
- Team management system (create teams, assign members)
- Professional UI with organized sections
- Admin-only access with role checking
- Audit logging for all admin actions

---

## 📁 File Structure

```
/admin/
  ├── index.html              # Admin panel main page
  ├── css/
  │   └── admin.css          # Admin-specific styles
  └── js/
      ├── admin-main.js      # Core admin logic & routing
      ├── user-management.js # User CRUD operations
      ├── team-management.js # Team CRUD operations
      ├── settings.js        # System settings
      └── analytics.js       # Reports & analytics

/
  ├── index.html              # Main app (remove signup button)
  └── js/
      └── auth.js            # Update: disable signup
```

---

## 🗄️ Database Schema Changes

### New Tables

#### 1. `teams` table
```sql
CREATE TABLE teams (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    team_lead_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES auth.users(id),
    is_active BOOLEAN DEFAULT true
);
```

#### 2. `team_members` table
```sql
CREATE TABLE team_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    added_by UUID REFERENCES auth.users(id),
    UNIQUE(team_id, user_id)
);
```

#### 3. `admin_audit_log` table
```sql
CREATE TABLE admin_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_user_id UUID REFERENCES auth.users(id),
    admin_username TEXT,
    action TEXT NOT NULL,
    target_user_id UUID REFERENCES auth.users(id),
    target_username TEXT,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Actions: 'user_created', 'user_updated', 'user_blocked', 'user_unblocked',
--          'user_deleted', 'team_created', 'team_updated', 'team_deleted',
--          'member_added', 'member_removed', 'settings_updated'
```

#### 4. Update `user_settings` table
```sql
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT false;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS blocked_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS blocked_by UUID REFERENCES auth.users(id);
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS blocked_reason TEXT;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id);
```

### Migration Script
Create initial "Bpal support team" and assign all existing users to it.

```sql
-- Create default team
INSERT INTO teams (name, description, is_active)
VALUES ('Bpal Support Team', 'Main support team - all current members', true)
RETURNING id;

-- Assign all existing users to default team
INSERT INTO team_members (team_id, user_id)
SELECT
    (SELECT id FROM teams WHERE name = 'Bpal Support Team'),
    id
FROM auth.users;

-- Update user_settings with team_id
UPDATE user_settings
SET team_id = (SELECT id FROM teams WHERE name = 'Bpal Support Team')
WHERE team_id IS NULL;
```

---

## 🎨 UI Design & Layout

### Admin Panel Structure

```
┌─────────────────────────────────────────────────────────────┐
│  Admin Panel - Bpal Ticketing System          [User] [Logout]│
├───────────┬─────────────────────────────────────────────────┤
│           │                                                 │
│ SIDEBAR   │            MAIN CONTENT AREA                    │
│           │                                                 │
│ 🏠 Home   │  ┌─────────────────────────────────────┐       │
│ 👥 Users  │  │                                     │       │
│ 👨‍👩‍👧‍👦 Teams │  │        Dynamic Content          │       │
│ 🎫 Tickets│  │        Based on Selection          │       │
│ ⚙️ Settings│  │                                     │       │
│ 📊 Reports│  └─────────────────────────────────────┘       │
│ 🕒 Attend.│                                                 │
│ 📋 Archive│                                                 │
│           │                                                 │
└───────────┴─────────────────────────────────────────────────┘
```

### Color Scheme (Professional Dark)
- **Primary**: `#3B82F6` (Blue)
- **Secondary**: `#8B5CF6` (Purple)
- **Success**: `#10B981` (Green)
- **Warning**: `#F59E0B` (Orange)
- **Danger**: `#EF4444` (Red)
- **Background**: `#1F2937` (Dark Gray)
- **Surface**: `#374151` (Medium Gray)
- **Text**: `#F9FAFB` (Off White)

---

## 📝 Implementation Phases

## ✅ PHASE 1: Setup & Foundation (Week 1)

### ✅ 1.1 Create Admin Page Structure - COMPLETED
**Summary:** Created professional admin panel with sidebar navigation, dashboard, and section routing.
- ✅ Created `/admin/index.html` with responsive layout
- ✅ Created `/admin/css/admin.css` with dark theme styling
- ✅ Created `/admin/js/admin-main.js` with routing and authentication
- ✅ Built sidebar navigation with 8 sections (Dashboard, Users, Teams, Tickets, Settings, Analytics, Attendance, Archive)
- ✅ Built header with user info and logout button
- ✅ Added route protection (admin check on page load)
- ✅ Dashboard with quick stats (Users, Teams, Tickets, Active Users)
- ✅ Recent activity feed with audit log integration
- ✅ Mobile responsive with collapsible sidebar
**Files Created:** `admin/index.html`, `admin/css/admin.css`, `admin/js/admin-main.js`

### ✅ 1.2 Migrate Old Admin Features - COMPLETED
**Summary:** Migrated all features from old admin modal to new organized admin panel sections.
- ✅ Created `admin/js/admin-functions.js` with all admin feature logic
- ✅ **Users Section**: Password reset, Ping user functionality
- ✅ **Tickets Section**: Search and delete tickets
- ✅ **Analytics Section**: User activity log, Weekly score history, KPI analysis (placeholder)
- ✅ **Attendance Section**: Attendance reports with date range
- ✅ Populated user dropdowns automatically on load
- ✅ Export to CSV functionality for reports
- ✅ Admin audit logging for all actions
- ✅ Updated main index.html admin button to navigate to new panel
**Files Created:** `admin/js/admin-functions.js`
**Files Modified:** `admin/index.html` (added all sections), `admin/js/admin-main.js` (integrated functions), `index.html` (updated admin button link)

### ✅ 1.3 Database Setup - COMPLETED
**Summary:** Created complete database schema with tables, RLS policies, and migration script.
- ✅ Created `teams` table with indexes
- ✅ Created `team_members` table with unique constraints
- ✅ Created `admin_audit_log` table with action tracking
- ✅ Updated `user_settings` table with is_blocked, blocked_at, blocked_by, blocked_reason, team_id columns
- ✅ Created migration script that auto-creates "Bpal Support Team" and assigns all users
- ✅ Set up RLS policies for all tables with admin-only write access
- ✅ Created helper functions: `is_admin()`, `log_admin_action()`
- ✅ Added proper indexes for query performance
**Files Created:** `database/migrations/001_admin_panel_tables.sql`, `database/migrations/README.md`
**Instructions:** Run the migration SQL file in Supabase SQL Editor to create all tables

### ✅ 1.4 Remove Signup from Main App - COMPLETED
**Summary:** Disabled user signup to ensure only admin-created accounts can access the system.
- ✅ Removed signup button from `index.html`
- ✅ Updated `auth.js` to disable signup functionality
- ✅ Added "Contact admin for access" message on login page
- ✅ Removed signup event listener from `main.js`
- ✅ Fixed all admin panel database column names (attendance, user_points, weekly_scores)
**Files Modified:** `index.html`, `js/auth.js`, `js/main.js`, `admin/js/admin-functions.js`

**Deliverable**: Admin panel accessible at `/admin/`, protected, with navigation structure. Main app is now login-only.

---

## ✅ PHASE 2: Dashboard & Analytics - COMPLETED

### ✅ 2.1 Dashboard Overview - COMPLETED
- ✅ Quick stats cards (users, teams, tickets, active users)
- ✅ Recent activity feed (last 10 actions from audit log)
- ✅ RLS policy fixed with SECURITY DEFINER function for admin access
- ✅ Comprehensive error logging and fallback handling
- [ ] System health indicators (future enhancement)
- [ ] Quick action buttons (future enhancement)

### ✅ 2.2 Analytics Features - COMPLETED
- ✅ **User Activity Log**: View and export point history for any user
- ✅ **Attendance Report**: Generate shift reports with date range
- ✅ **Weekly Score History**: View and export weekly leaderboard data
- ✅ **KPI Analysis**: Tier-based bonus system (Needs Support, Developing, Proficient, Advanced, Expert)
  - ✅ Team statistics (average, median, standard deviation)
  - ✅ Individual recommendations with bonus percentages (25% for <70%, 15% for 70-90%)
  - ✅ Detailed 8-column table with tier badges
  - ✅ Fairness explanation section
  - ✅ Full view expansion without scrolling
  - ✅ CSV export with all tier data
- ✅ All reports exportable to CSV

### 2.3 Charts & Visualizations (Future Enhancement)
- [ ] User activity chart (last 7 days)
- [ ] Tickets created vs closed (line chart)
- [ ] Top performers (leaderboard widget)
- [ ] Team performance comparison

**Deliverable**: ✅ COMPLETED - Professional dashboard with comprehensive analytics and reporting

---

## 🚧 PHASE 3: User Management - IN PROGRESS

### Priority: HIGH - Core Admin Functionality

### 3.1 User List View & CRUD Operations
**Goal**: Enable admins to view, create, edit, block, and delete users through a professional interface.

#### 3.1.1 User List Table
- [ ] Create user list table (responsive design)
- [ ] Display columns: Avatar/Initial, Display Name, Email, Team, Status, Actions
- [ ] Add search functionality (by name or email)
- [ ] Add filter by status (All/Active/Blocked)
- [ ] Add filter by team (dropdown)
- [ ] Add sorting (by name, email, status)
- [ ] Show status badges (Active: green, Blocked: red)
- [ ] Show total user count
- [ ] Handle empty state (no users)

**Table Layout:**
```
┌──────────────────────────────────────────────────────────────────────┐
│  [Search: _________]  [Filter: All Users ▾]  [Team: All ▾]  [+ Add] │
├──────────────────────────────────────────────────────────────────────┤
│ Avatar │ Name         │ Email              │ Team       │ Status  │ │
├──────────────────────────────────────────────────────────────────────┤
│   AB   │ Ali Elzein   │ ali@b-pal.net     │ Support    │ ✓Active │ │
│   CD   │ Carl Davis   │ carl@b-pal.net    │ Support    │ 🚫Block │ │
└──────────────────────────────────────────────────────────────────────┘
```

#### 3.1.2 Create User (Single)
- [ ] Add "Create User" button in header
- [ ] Create modal/dialog form
- [ ] Fields:
  - [ ] Email (required, validated, pattern: username@b-pal.net)
  - [ ] Display Name (optional, auto-generated from email if empty)
  - [ ] Team Assignment (dropdown, default: Bpal Support Team)
  - [ ] Admin Role checkbox (default: unchecked)
  - [ ] Send Welcome Email checkbox (default: checked)
- [ ] Email validation (format, uniqueness)
- [ ] Create user in Supabase Auth (`auth.admin.createUser()`)
- [ ] Set user metadata (is_admin, role)
- [ ] Create user_settings record
- [ ] Add to team_members table
- [ ] Send password reset email (welcome flow)
- [ ] Log action in admin_audit_log
- [ ] Show success notification with user details
- [ ] Handle errors (duplicate email, invalid data)

#### 3.1.3 Edit User
- [ ] Add "Edit" button in user row actions
- [ ] Create edit modal with pre-filled data
- [ ] Editable fields:
  - [ ] Display Name
  - [ ] Team Assignment (dropdown)
  - [ ] Admin Role (checkbox)
  - [ ] Theme Preference (optional)
- [ ] Save changes to user_settings
- [ ] Update user metadata in auth.users (if admin role changed)
- [ ] Update team_members (if team changed)
- [ ] Log action in admin_audit_log
- [ ] Show success notification
- [ ] Handle errors

#### 3.1.4 Block/Unblock User
- [ ] Add "Block" button in user row actions
- [ ] Block dialog with:
  - [ ] Reason field (required, textarea)
  - [ ] Confirm button
  - [ ] Cancel button
- [ ] Update user_settings:
  - [ ] Set is_blocked = true
  - [ ] Set blocked_at = now()
  - [ ] Set blocked_by = admin_user_id
  - [ ] Set blocked_reason = reason
- [ ] Implement login check in auth.js (prevent blocked users from logging in)
- [ ] Log action in admin_audit_log
- [ ] Add "Unblock" button for blocked users
- [ ] Unblock logic (reset is_blocked, keep audit trail)
- [ ] Show block indicator in user list (red badge)
- [ ] Show success notification

#### 3.1.5 Delete User
- [ ] Add "Delete" button in user row actions (danger zone)
- [ ] Strong confirmation dialog:
  - [ ] Warning message about data deletion
  - [ ] "Type username to confirm" input field
  - [ ] Confirm button (disabled until username matches)
  - [ ] Cancel button
- [ ] Soft delete option:
  - [ ] Mark user as deleted in user_settings (add is_deleted column)
  - [ ] Keep all user data (tickets, points, attendance)
- [ ] Hard delete option:
  - [ ] Delete from auth.users (cascades to user_settings, team_members)
  - [ ] Option to keep or delete user data (tickets, points, attendance)
- [ ] Log action in admin_audit_log
- [ ] Show success notification
- [ ] Remove user from list

### 3.2 Bulk Operations
**Priority**: MEDIUM - After basic CRUD is complete

- [ ] Add checkbox column to user table
- [ ] Add "Select All" checkbox in header
- [ ] Show bulk action bar when users selected
- [ ] Bulk actions:
  - [ ] Assign to Team (select team, apply to all)
  - [ ] Block Users (enter reason, apply to all)
  - [ ] Unblock Users (apply to all)
  - [ ] Delete Users (strong confirmation)
  - [ ] Export to CSV (selected users)
- [ ] Show progress indicator for bulk operations
- [ ] Show success/failure summary

### 3.3 Import Users (CSV)
**Priority**: LOW - After bulk operations

- [ ] Add "Import CSV" button
- [ ] Upload CSV file dialog
- [ ] CSV format: email, display_name, team_name
- [ ] Parse CSV with Papa Parse
- [ ] Validate all rows (email format, team exists)
- [ ] Show preview table with validation status
- [ ] Confirm and import button
- [ ] Create users in batch
- [ ] Send welcome emails (optional)
- [ ] Show import report (success/failures)

### 3.4 User Detail View
**Priority**: LOW - After CRUD is complete

- [ ] Click user row to open detail modal/page
- [ ] Show sections:
  - [ ] Profile (avatar, name, email, team, role, status)
  - [ ] Statistics (total tickets, points, attendance %)
  - [ ] Recent Activity (last 10 point events)
  - [ ] Attendance Overview (last 7 days)
  - [ ] Team Memberships
- [ ] Quick action buttons (Edit, Block, Delete)
- [ ] Link to full analytics reports

**Deliverable**: Complete user management system with create, read, update, delete, and block capabilities

---

## ✅ PHASE 4: Team Management (Week 5)

### 4.1 Team List View
- [ ] Card-based layout (grid)
- [ ] Show team name, description, member count
- [ ] Show team lead
- [ ] Show member avatars (first 5)
- [ ] Actions: Edit, Delete, View Details

### 4.2 Create Team
- [ ] Create modal form
- [ ] Fields: Name, Description, Team Lead
- [ ] Select team lead from dropdown
- [ ] Add members (multi-select)
- [ ] Save team
- [ ] Log action in audit log

### 4.3 Edit Team
- [ ] Edit modal with pre-filled data
- [ ] Update name, description
- [ ] Change team lead
- [ ] Save changes
- [ ] Log action in audit log

### 4.4 Team Members Management
- [ ] View all members in table
- [ ] Add member (search & select)
- [ ] Remove member (with confirmation)
- [ ] Assign team lead
- [ ] Show member roles and status

### 4.5 Delete Team
- [ ] Delete button (danger zone)
- [ ] Confirmation dialog
- [ ] Check if team has members (warn)
- [ ] Option: Reassign members to another team
- [ ] Delete team
- [ ] Log action in audit log

### 4.6 Team Performance
- [ ] View team statistics
- [ ] Total tickets handled
- [ ] Average response time
- [ ] Team leaderboard
- [ ] Export team report

**Deliverable**: Complete team management system

---

## ✅ PHASE 5: Settings & Configuration (Week 6)

### 5.1 Points Configuration
- [ ] Edit ticket points (create, close, notes)
- [ ] Edit badge thresholds
- [ ] Edit penalty amounts
- [ ] Edit milestone bonuses
- [ ] Save configuration
- [ ] Log changes in audit log

### 5.2 Schedule Settings
- [ ] Edit default shift times
- [ ] Edit break time limits
- [ ] Edit penalty thresholds
- [ ] Set holiday calendar
- [ ] Save configuration

### 5.3 Email Templates
- [ ] Welcome email template
- [ ] Password reset template
- [ ] Weekly report template
- [ ] Badge notification template
- [ ] Edit templates (WYSIWYG editor)
- [ ] Preview templates
- [ ] Test send email

### 5.4 System Settings
- [ ] App name & logo
- [ ] Timezone settings
- [ ] Language settings
- [ ] Feature toggles (enable/disable features)
- [ ] Maintenance mode

**Deliverable**: Configurable system settings

---

## ✅ PHASE 6: Analytics & Reports (Week 7)

### 6.1 User Reports
- [ ] User performance report
- [ ] Individual user stats (tickets, points, badges)
- [ ] User activity timeline
- [ ] Export to PDF/CSV

### 6.2 Team Reports
- [ ] Team performance comparison
- [ ] Team leaderboard
- [ ] Team activity chart
- [ ] Export to PDF/CSV

### 6.3 System Reports
- [ ] Tickets overview (created, closed, pending)
- [ ] Response time analytics
- [ ] Points distribution
- [ ] Badge distribution
- [ ] Weekly/Monthly summaries
- [ ] Export to PDF/CSV

### 6.4 Custom Reports
- [ ] Date range selector
- [ ] Filter by user/team
- [ ] Filter by metric
- [ ] Generate custom report
- [ ] Schedule automated reports (email)

**Deliverable**: Comprehensive analytics dashboard

---

## ✅ PHASE 7: Attendance & Archive (Week 8)

### 7.1 Attendance Management (Move existing)
- [ ] Move attendance view to admin panel
- [ ] View all attendance records
- [ ] Filter by user/date
- [ ] Override attendance
- [ ] Manage break penalties
- [ ] Export attendance report

### 7.2 Weekly Archive (Move existing)
- [ ] Move archive functionality to admin panel
- [ ] Manual archive trigger
- [ ] View archived weeks
- [ ] Export archive data

### 7.3 Audit Log Viewer
- [ ] View all admin actions
- [ ] Filter by admin, action type, date
- [ ] Search audit log
- [ ] Export audit log

**Deliverable**: Centralized attendance and archive management

---

## ✅ PHASE 8: Polish & Testing (Week 9)

### 8.1 UI Polish
- [ ] Responsive design (mobile/tablet)
- [ ] Loading states everywhere
- [ ] Error handling & messages
- [ ] Empty states
- [ ] Tooltips and help text
- [ ] Keyboard shortcuts
- [ ] Accessibility (ARIA labels)

### 8.2 Performance
- [ ] Optimize database queries
- [ ] Add pagination everywhere
- [ ] Lazy load tables
- [ ] Cache frequently used data
- [ ] Optimize images

### 8.3 Testing
- [ ] Test all user management flows
- [ ] Test all team management flows
- [ ] Test permissions and security
- [ ] Test blocked user experience
- [ ] Test bulk operations
- [ ] Test CSV import
- [ ] Test reports generation
- [ ] Cross-browser testing

### 8.4 Documentation
- [ ] Admin user guide
- [ ] System documentation
- [ ] API documentation
- [ ] Database schema docs

**Deliverable**: Production-ready admin panel

---

## 🔒 Security Checklist

- [ ] Admin role check on every page load
- [ ] RLS policies for all tables
- [ ] Prevent SQL injection
- [ ] Sanitize all inputs
- [ ] CSRF protection
- [ ] Rate limiting on sensitive actions
- [ ] Audit log for all admin actions
- [ ] Secure password reset flow
- [ ] Session timeout
- [ ] Prevent unauthorized API access

---

## 📊 Success Metrics

- **User Management**: Admin can create, edit, block, delete users in < 30 seconds
- **Team Management**: Admin can create teams and assign members in < 1 minute
- **Performance**: All pages load in < 2 seconds
- **Usability**: New admin can navigate without documentation
- **Security**: Zero unauthorized access incidents
- **Reliability**: 99.9% uptime

---

## 🚀 Launch Plan

### Pre-Launch (Week 9)
1. Complete all phases
2. Full testing on staging
3. User acceptance testing with 1-2 admins
4. Fix critical bugs

### Launch (Week 10)
1. Database migration (create teams, assign users)
2. Deploy admin panel
3. Remove signup from main app
4. Train admins
5. Monitor for issues
6. Gather feedback

### Post-Launch (Week 11+)
1. Address feedback
2. Add requested features
3. Optimize performance
4. Plan Phase 2 features

---

## 📝 Notes & Decisions

### Key Decisions:
1. **Single Team Initially**: All users start in "Bpal Support Team"
2. **Soft Delete**: Users are marked as deleted, not removed from database
3. **Email Verification**: Required for all new users
4. **Audit Everything**: All admin actions logged
5. **Progressive Enhancement**: Start simple, add features iteratively

### Future Enhancements (Post-Launch):
- Mobile app for admins
- Advanced analytics with ML predictions
- Ticket assignment rules engine
- SLA management
- Integration with external tools (Slack, Teams)
- Custom roles and permissions
- Multi-language support

---

## 👥 Team & Resources

### Roles Needed:
- **Developer**: Ali (You) - Full implementation
- **Designer**: Optional - UI/UX refinement
- **Tester**: Optional - QA testing
- **Admin Users**: 1-2 for UAT

### Tools & Technologies:
- **Frontend**: HTML, CSS (Tailwind), JavaScript
- **Backend**: Supabase (PostgreSQL, Auth, RLS)
- **Libraries**:
  - DataTables / AG-Grid (tables)
  - Chart.js (charts)
  - Papa Parse (CSV parsing)
  - jsPDF (PDF export)

---

## 📞 Support & Questions

For questions or issues during implementation:
1. Check this plan first
2. Review Supabase docs
3. Test in staging environment
4. Ask Claude for help 😊

---

**Last Updated**: December 18, 2025
**Version**: 1.2
**Status**: Phase 1 & 2 Complete - Phase 3 (User Management) In Progress

---

## 📊 Phase Progress Summary

| Phase | Status | Completion |
|-------|--------|------------|
| Phase 1: Foundation & Structure | ✅ Complete | 100% |
| Phase 2: Dashboard & Analytics | ✅ Complete | 100% |
| Phase 3: User Management | 🚧 In Progress | 0% |
| Phase 4: Team Management | ⏳ Pending | 0% |
| Phase 5: Settings & Configuration | ⏳ Pending | 0% |
| Phase 6: Advanced Analytics | ⏳ Pending | 0% |
| Phase 7: Attendance & Archive | ⏳ Pending | 0% |
| Phase 8: Polish & Testing | ⏳ Pending | 0% |

---

## 🎯 Next Immediate Steps

### Step 1: User List Table (3.1.1)
Create the foundation for user management by building the user list display:
1. Query all users from user_settings with team info
2. Build responsive table layout with search and filters
3. Display user avatars/initials
4. Add status badges (Active/Blocked)
5. Add action buttons (Edit, Block, Delete)

### Step 2: Create User Modal (3.1.2)
Enable admins to create new user accounts:
1. Build create user modal with form
2. Implement email validation
3. Use Supabase Admin API to create user
4. Set user metadata and create user_settings
5. Send welcome email

### Step 3: Edit User (3.1.3)
Allow admins to modify user details:
1. Build edit modal with pre-populated data
2. Update user_settings and team assignments
3. Handle admin role changes

### Step 4: Block/Unblock (3.1.4)
Implement user blocking functionality:
1. Add block dialog with reason field
2. Update is_blocked flag in user_settings
3. Implement login prevention for blocked users
4. Add unblock functionality

### Step 5: Delete User (3.1.5)
Add user deletion with safeguards:
1. Build strong confirmation dialog
2. Implement soft delete (mark as deleted)
3. Add option for hard delete
4. Handle data cleanup/preservation
