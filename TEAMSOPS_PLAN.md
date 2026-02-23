# TeamsOps — Mobile PWA Redesign + Security Hardening

## Overview

TeamsOps (formerly B-PAL Ticket Tracker) is being upgraded with:
1. **Security hardening** — fixing critical vulnerabilities in edge functions, admin checks, and XSS prevention
2. **PWA support** — manifest.json, service worker, install-to-home-screen capability
3. **Mobile-first redesign** — native-app-like experience with bottom navigation, bottom sheets, swipe gestures

---

## Phase 1: Security Fixes

| Priority | Issue | Fix | Status |
|----------|-------|-----|--------|
| CRITICAL | `award-points` edge function has no auth | Add JWT verification + cron secret for CLIENT_HERO_CHECK | Done |
| HIGH | Hardcoded admin identity by email substring in all edge functions | Removed — now uses `is_super_admin()` RPC only | Done |
| HIGH | `user_metadata` admin bypass (users can self-grant admin) | Removed `user_metadata` checks — rely on DB RPC | Done |
| HIGH | SECURITY DEFINER RPCs missing caller auth check | Added `is_super_admin(auth.uid())` guard to all 3 functions | Done |
| MEDIUM-HIGH | XSS — unsanitized DB fields in innerHTML | Add `escapeHTML()` utility, apply to all raw interpolations | Pending |
| MEDIUM | CORS wildcard on all edge functions | Restrict to allowed domains | Pending |
| MEDIUM | SMTP password in DB + request body | Move to Vercel env vars | Pending |
| MEDIUM | `check-and-send-reminders` has no auth | Add cron secret header | Pending |

### SQL to Run in Supabase Dashboard

After deploying edge function updates, run these SQL statements:

```sql
-- 1. Update is_super_admin_check() to use RPC instead of hardcoded emails
CREATE OR REPLACE FUNCTION is_super_admin_check()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(is_super_admin(auth.uid()), false);
$$;
GRANT EXECUTE ON FUNCTION is_super_admin_check() TO authenticated;

-- 2. Add auth guards to admin team RPCs (copy from database/admin_teams_rpc.sql)
-- Run the full file content from database/admin_teams_rpc.sql
```

---

## Phase 2: PWA Setup

| Component | File | Status |
|-----------|------|--------|
| manifest.json | `/manifest.json` | Pending |
| Service Worker | `/sw.js` | Pending |
| PWA Icons (192, 512) | `/assets/icon-*.png` | Pending |
| Meta tags + SW registration | `/index.html` | Pending |
| Install prompt | `/js/main.js` + banner HTML | Pending |

**App Name:** TeamsOps
**Theme Color:** `#6366f1` (indigo)
**Background:** `#0f0f23` (dark)
**Display:** `standalone` (no browser chrome)

---

## Phase 3: Mobile Redesign

### Architecture
- Detect mobile via `js/device-detection.js` (already exists)
- Set `data-device="mobile"` on `<body>`
- All mobile styles scoped under `[data-device="mobile"]` in `css/mobile.css`
- Desktop remains completely untouched

### Mobile Navigation (Bottom Nav Bar — 4 tabs)

| Tab | Icon | Action |
|-----|------|--------|
| Tickets | Clipboard | Show ticket list + sub-tabs (In Progress / Done / Follow-up / KB) |
| Scores | Bar chart | Open leaderboard bottom sheet |
| Team | People | Open team info bottom sheet |
| More | Menu | Settings, Shift, Schedule, Clients, Activity, Sign Out |

### Key Mobile Features
- **Bottom sheets** replace sidebars (slide-up panels with drag handles)
- **FAB** (floating action button) for quick ticket creation
- **Swipe gestures** between ticket sub-tabs
- **Pull-to-refresh** on ticket list
- **Compact ticket cards** with touch-friendly buttons (min 44x44px)
- **Horizontal scroll filter chips** instead of wrapping dropdowns
- **Skeleton loading** states before data arrives

### New Files
| File | Purpose |
|------|---------|
| `css/mobile.css` | Mobile-specific styles |
| `js/mobile-nav.js` | Mobile navigation controller |

---

## Phase 4: Performance

- Lazy view initialization (defer Dashboard charts, KB until navigated)
- TTL-based response caching for leaderboard/stats
- Early device detection in `<head>` to prevent desktop flash on mobile
- Skeleton loading states

---

## Phase 5: Polish

- Security headers in `vercel.json`
- iOS input zoom fix (`font-size: 16px`)
- Touch target audit (44x44px minimum)
- Fix broken image paths in `reset-password.html`

---

## Tech Stack

- **Frontend:** Vanilla HTML/JS/CSS + Tailwind (CDN) + ES Modules
- **Backend:** Supabase (Auth, DB, Edge Functions, Realtime)
- **Deployment:** Vercel
- **Rich Text:** Quill.js
- **Charts:** Chart.js
- **Sanitization:** DOMPurify
