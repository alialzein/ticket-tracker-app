# TeamsOps — Mobile PWA Redesign + Security Hardening

## Overview

TeamsOps (formerly B-PAL Ticket Tracker) is being upgraded with:
1. **Security hardening** — fixing critical vulnerabilities in edge functions, admin checks, and XSS prevention
2. **PWA support** — manifest.json, service worker, install-to-home-screen capability
3. **Mobile-first redesign** — native-app-like experience with bottom navigation, bottom sheets, swipe gestures

**App branding:** `TeamsOps` (short name: `TeamsOps`, theme: `#6366f1`, background: `#0f0f23`)

---

## Phase 1: Security Fixes

| Priority | Issue | Fix | Status |
|----------|-------|-----|--------|
| CRITICAL | `award-points` edge function had no auth | JWT verification added + cron secret for `CLIENT_HERO_CHECK` | ✅ Done |
| HIGH | Hardcoded admin email substring in all edge functions | Removed — now uses `is_super_admin()` RPC only | ✅ Done |
| HIGH | `user_metadata` admin bypass | Removed `user_metadata?.is_admin` checks — rely on DB RPC | ✅ Done |
| HIGH | SECURITY DEFINER RPCs missing caller auth | `is_super_admin(auth.uid())` guard added to 3 team RPCs | ✅ Done |
| HIGH | `is_super_admin_check()` SQL had hardcoded emails | Updated to delegate to `is_super_admin()` RPC | ✅ Done (SQL run) |
| MEDIUM-HIGH | XSS — unsanitized DB fields in innerHTML | Add `escapeHTML()` to `js/ui.js`, apply across all files | ⬜ Next |
| MEDIUM | CORS wildcard on all edge functions | Restrict to app domains | ⬜ Pending |
| MEDIUM | SMTP password stored in DB plaintext | Move to Vercel env vars | ⬜ Pending |
| MEDIUM | `check-and-send-reminders` has no auth | Add `x-cron-secret` header check | ⬜ Pending |

### What was changed (Phase 1 details)

#### `supabase/functions/award-points/index.js`
- Parses request body first to get `eventType`
- If `CLIENT_HERO_CHECK`: allows `x-cron-secret` header OR valid JWT
- For all other events: requires `Authorization: Bearer <token>`, verifies via `supabase.auth.getUser()`, validates `userId` in body matches authenticated caller
- `_supabase.functions.invoke()` in the client already sends JWT automatically — no client changes needed

#### `supabase/functions/verify-admin/index.ts`
- Removed `user.email?.includes('ali.elzein')` and `user.email?.includes('ali.alzein')` fallback
- `isSuperAdmin = isSuperAdminResult === true` — purely RPC-based

#### `supabase/functions/admin-create-user/index.ts`
- Removed `user_metadata?.is_admin`, `user_metadata?.role`, and email substring checks
- Calls `is_super_admin()` RPC for both admin and super-admin checks
- Team leaders are also allowed to create users

#### `supabase/functions/admin-delete-user/index.ts`
- Removed all email/metadata checks
- Super admin only via `is_super_admin()` RPC

#### `supabase/functions/admin-set-password/index.ts`
- Removed all email/metadata checks
- Super admin only via `is_super_admin()` RPC

#### `supabase/functions/admin-update-user/index.ts`
- Removed all email/metadata checks
- Allows super admins OR team leaders (fetches `is_team_leader` from `user_settings`)

#### `database/admin_teams_rpc.sql`
- All 3 SECURITY DEFINER functions now start with `IF NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION`
- `admin_create_team()`, `admin_update_team()`, `admin_set_team_active()`
- **Must be re-run in Supabase SQL Editor**

#### `database/phase2_rls_policies.sql`
- `is_super_admin_check()` now: `SELECT COALESCE(is_super_admin(auth.uid()), false)`
- **SQL was already run by user**

### SQL that still needs to be run

```sql
-- Re-run to add auth guards (copy exact content from database/admin_teams_rpc.sql)
-- admin_create_team, admin_update_team, admin_set_team_active
```

---

## Phase 1.5: XSS Prevention (Next)

### Add `escapeHTML` to `js/ui.js`
```js
export function escapeHTML(str) {
    if (str == null) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
```

Import in every file that uses it:
```js
import { escapeHTML } from './ui.js';
```

### Apply to these specific locations

**`js/tickets.js`** — highest risk (29 innerHTML usages):
- `ticket.subject` in card render (line ~809, ~1177)
- `note.username` in note HTML (line ~1598)
- `parentNote.username` in reply badge (line ~1576)
- `t.subject`, `t.status`, `t.priority` in search results (lines ~1925-1937)
- `ticket.assigned_to_name`, `ticket.created_by`, `ticket.handled_by[]`

**`js/main.js`**:
- Usernames in leaderboard render (`renderLeaderboard()`)
- Usernames in stats container (`renderStats()`)
- Activity log entries

**`js/knowledge-base.js`**:
- `entry.title`, `entry.client_type`, `entry.issue_type` in list render

**`admin/js/admin-broadcast.js`**:
- `activity.admin_username` in audit log (line ~104)
- `targetUsername` in `formatAction()` (lines ~136-140)

**`admin/js/admin-functions.js`**:
- Ticket subjects, usernames in search results (line ~219)

> **Keep using `DOMPurify.sanitize()`** for Quill rich-text note bodies — already done in tickets.js. `escapeHTML` is for plain-text fields only.

---

## Phase 1.6: CORS Restriction

### Replace wildcard in all edge functions
All 6 edge functions currently use `'Access-Control-Allow-Origin': '*'`.

Replace with dynamic origin check:
```js
const ALLOWED_ORIGINS = [
    'https://YOUR-VERCEL-APP.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:5500',
];
function getCorsHeaders(req) {
    const origin = req.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowed,
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Vary': 'Origin',
    };
}
```

**`api/send-announcement.js`** (Vercel function) — also has `credentials: true` + wildcard which is invalid by CORS spec. Fix both.

---

## Phase 1.7: SMTP Security

**`api/send-announcement.js`**:
- Remove `smtp` object from request body (currently client sends full SMTP config including password)
- Read SMTP config from Vercel environment variables instead: `process.env.SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_PORT`
- Set `tls: { rejectUnauthorized: true }` (currently `false` = MitM vulnerable)
- Add auth check: validate Supabase JWT + verify caller is admin before sending

**Supabase SQL** — add RLS to `smtp_config` table:
```sql
ALTER TABLE smtp_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_only" ON smtp_config
    USING (is_super_admin_check())
    WITH CHECK (is_super_admin_check());
```

---

## Phase 1.8: Reminders Auth

**`supabase/functions/check-and-send-reminders-edge-function.js`**:
- Add `x-cron-secret` header check (same pattern as CLIENT_HERO_CHECK in award-points)
- Set `CRON_SECRET` in Supabase edge function secrets dashboard

---

## Phase 2: PWA Setup

| Component | File | Status |
|-----------|------|--------|
| `manifest.json` | `/manifest.json` | ✅ Done |
| Service Worker | `/sw.js` | ✅ Done |
| PWA Icons | `assets/icon-192.png`, `assets/icon-512.png` | ✅ Done (resized from bpal-logo.png via Python) |
| Meta tags + SW registration | `index.html` | ✅ Done |
| Install banner + prompt handler | `index.html` + `js/main.js` | ✅ Done |

### manifest.json content
```json
{
  "name": "TeamsOps",
  "short_name": "TeamsOps",
  "description": "Team ticket tracking and operations management",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0f0f23",
  "theme_color": "#6366f1",
  "lang": "en",
  "scope": "/",
  "categories": ["productivity", "business"],
  "icons": [
    { "src": "assets/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

### `index.html` `<head>` additions
```html
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#6366f1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="TeamsOps">
<link rel="apple-touch-icon" href="assets/icon-192.png">
```

### SW registration (before `</body>`)
```html
<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then(r => console.log('[SW] Registered'))
        .catch(e => console.error('[SW] Failed:', e));
    });
  }
</script>
```

### Service Worker strategy (`sw.js`)
- **Install:** pre-cache app shell (index.html, css/style.css, css/mobile.css, all js/ modules, vendor/, assets/)
- **Activate:** delete old version caches
- **Fetch:** cache-first for static assets; skip Supabase (`*.supabase.co`) and CDN requests
- Cache version name: `teamsops-v1` — bump on deploy

### Install prompt (`js/main.js`)
```js
let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById('pwa-install-banner')?.classList.remove('hidden');
});
export function triggerInstallPrompt() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(() => {
        deferredInstallPrompt = null;
        document.getElementById('pwa-install-banner')?.classList.add('hidden');
    });
}
```

Install banner HTML (added to `index.html`, shown above bottom nav on mobile):
```html
<div id="pwa-install-banner" class="hidden fixed bottom-20 left-4 right-4 z-40 md:bottom-4 md:right-4 md:left-auto md:w-72">
  <div class="glassmorphism border border-indigo-500/30 rounded-xl p-3 flex items-center gap-3 shadow-2xl">
    <img src="assets/icon-192.png" class="w-10 h-10 rounded-lg" alt="">
    <div class="flex-1 min-w-0">
      <p class="text-sm font-semibold text-white">Install TeamsOps</p>
      <p class="text-xs text-gray-400">Add to Home Screen</p>
    </div>
    <button onclick="main.triggerInstallPrompt()" class="bg-indigo-600 text-white text-xs font-bold py-1.5 px-3 rounded-lg">Install</button>
    <button onclick="document.getElementById('pwa-install-banner').classList.add('hidden')" class="text-gray-400 p-1">✕</button>
  </div>
</div>
```

---

## Phase 3: Mobile Redesign

### Strategy
- `js/device-detection.js` already exists — use `detectDeviceType()` which returns `'mobile'`, `'tablet'`, or `'desktop'`
- On `initMobileNav()`: if mobile → set `document.body.setAttribute('data-device', 'mobile')`
- Add inline pre-detect script in `<head>` so sidebars hide before JS loads (no flash)
- All mobile CSS scoped to `[data-device="mobile"]` in new `css/mobile.css`
- Desktop layout is completely untouched

### Pre-detect inline script (in `<head>` before any CSS)
```html
<script>
  (function() {
    var ua = navigator.userAgent.toLowerCase();
    var isMobile = /android|iphone|ipod/i.test(ua) && !/ipad|tablet/i.test(ua);
    var isSmall = window.innerWidth < 768 && navigator.maxTouchPoints > 0;
    if (isMobile || isSmall) document.documentElement.setAttribute('data-predetect', 'mobile');
  })();
</script>
```

### New File: `css/mobile.css`
Loaded in `index.html` `<head>`. Key rules:

**Hide desktop elements on mobile:**
- `[data-device="mobile"] #sidebar` → `display: none !important`
- `[data-device="mobile"] #on-leave-sidebar` → `display: none !important`
- `[data-device="mobile"] #sidebar-backdrop, #right-sidebar-backdrop` → `display: none !important`
- `[data-device="mobile"] footer#tickets-footer` → `display: none !important` (replaced by FAB)
- The existing 5-tab top nav bar → hidden on mobile (targeted by its CSS class/ID)

**Pre-detect flash prevention:**
- `[data-predetect="mobile"] #sidebar, [data-predetect="mobile"] #on-leave-sidebar` → `display: none !important`

**Bottom nav bar:**
- `[data-device="mobile"] #mobile-bottom-nav` → `display: flex !important; position: fixed; bottom: 0; height: 64px; padding-bottom: env(safe-area-inset-bottom)`
- Active tab: `color: #818cf8` (indigo-400); inactive: `color: #6b7280`

**FAB:**
- `[data-device="mobile"] #mobile-fab` → `display: flex !important; position: fixed; bottom: 80px; right: 16px; width: 56px; height: 56px; border-radius: 50%; background: gradient indigo→purple; box-shadow: 0 4px 20px rgba(99,102,241,0.6)`

**Bottom sheets:**
- `.mobile-bottom-sheet` → `position: fixed; bottom: 0; left: 0; right: 0; max-height: 85vh; transform: translateY(100%); transition: transform 0.3s cubic-bezier(0.32,0.72,0,1); border-radius: 20px 20px 0 0; overflow-y: auto`
- `.mobile-bottom-sheet.is-open` → `transform: translateY(0)`
- `.mobile-bottom-sheet-backdrop` → `position: fixed; inset: 0; background: rgba(0,0,0,0.6); opacity: 0; pointer-events: none; transition: opacity 0.3s`
- `.mobile-bottom-sheet-backdrop.is-open` → `opacity: 1; pointer-events: all`
- `.mobile-bottom-sheet-handle` → `width: 36px; height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; margin: 0 auto 16px`

**Compact header:**
- `[data-device="mobile"] header` → `padding: 8px 12px; padding-top: max(8px, env(safe-area-inset-top))`

**Filter bar (horizontal scroll chips):**
- `[data-device="mobile"] #tickets-filter-bar` → `overflow-x: auto; white-space: nowrap; scrollbar-width: none`
- Filter selects → `border-radius: 20px; font-size: 12px; padding: 6px 8px`

**Compact ticket cards:**
- `[data-device="mobile"] .ticket-card` → `padding: 10px 12px; border-radius: 12px`
- All buttons inside cards → `min-width: 36px; min-height: 36px` (touch targets)

**Main content padding:**
- `[data-device="mobile"] main.flex-grow` → `padding-bottom: 80px !important` (above bottom nav)

**Skeleton loading:**
```css
.skeleton {
    background: linear-gradient(90deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 100%);
    background-size: 200% 100%;
    animation: skeleton-wave 1.5s ease-in-out infinite;
    border-radius: 8px;
}
@keyframes skeleton-wave { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.skeleton-card { height: 80px; margin-bottom: 8px; }
```

**iOS input zoom prevention:**
- All mobile inputs → `font-size: 16px !important` (iOS auto-zooms if < 16px)

**Safe area insets:**
- Header top padding, bottom nav bottom padding use `env(safe-area-inset-top/bottom)`

### Bottom Nav HTML (added to `index.html` before `</body>`)
4 tabs: Tickets | Scores | Team | More
- Default `display: none` — shown by mobile CSS
- Each tab: `flex-col items-center gap-1 py-2`, SVG icon (w-6 h-6) + label text (text-[10px])
- Active state: `text-indigo-400`; inactive: `text-gray-400`

### Ticket Sub-tabs (horizontal scroll pills)
Shown only when Tickets tab is active on mobile:
- Pills: **⚡ In Progress** | **✅ Done** | **🔔 Follow-up** | **📚 KB**
- Active pill: `bg-indigo-600 text-white`; inactive: `bg-gray-700/60 text-gray-300`
- Calls existing `ui.switchView()` — no new view logic needed

### Bottom Sheets (added to `index.html`)
| Sheet ID | Content | Trigger |
|----------|---------|---------|
| `mobile-ticket-sheet` | Source buttons (Outlook/Teams), subject input, priority select, assign-to select, Create button | FAB tap |
| `mobile-scores-sheet` | Clones content from `#leaderboard-container` + `#stats-container` | Scores tab |
| `mobile-team-sheet` | Clones content from `#on-leave-sidebar` | Team tab |
| `mobile-more-sheet` | Settings link, Shift toggle, Schedule, Clients, Activity, Sign Out | More tab |

Each sheet: drag handle div + backdrop div (`#mobile-sheet-backdrop`).

### New File: `js/mobile-nav.js`
Exported functions (exposed as `window.mobileNav`):

| Function | Description |
|----------|-------------|
| `initMobileNav()` | Detects mobile, sets `data-device`, shows mobile elements, wires gestures |
| `switchTab(tab)` | Switches bottom nav active tab, opens relevant sheet or shows tickets |
| `switchSubTab(view, btnEl)` | Switches ticket sub-tab pill, delegates to `ui.switchView()` |
| `openSheet(sheetId)` | Slides up a bottom sheet + shows backdrop, locks body scroll |
| `closeAllSheets()` | Slides down all sheets, unlocks body scroll |
| `openTicketSheet()` | Syncs assign dropdown from desktop, opens ticket creation sheet |
| `createTicketFromSheet()` | Copies mobile form values → desktop inputs → calls `tickets.createTicket()` |
| `openShift()` | Closes sheets, calls `schedule.toggleShift()` |
| `openSchedule()` | Closes sheets, calls existing schedule modal |
| `triggerInstallPrompt()` | Wrapper around PWA install prompt |

**Swipe gesture handler** (on `main.flex-grow`):
- `touchstart` → record x,y
- `touchend` → if deltaX > 50 and horizontal ratio > 2:1 → switch to next/prev sub-tab
- Only active when `currentTab === 'tickets'`

**Pull-to-refresh handler** (on `main.flex-grow`):
- `touchstart` at scrollTop=0 → start tracking
- `touchmove` → translate `#pull-to-refresh-indicator` down
- `touchend` → if pulled > 80px → call `tickets.fetchTickets(true)` → animate spinner

**Content population:**
- `populateMobileLeaderboard()` → clones `#leaderboard-container` innerHTML into `#mobile-leaderboard-container`
- `populateMobileTeam()` → clones right sidebar children into `#mobile-team-content`

**Notification dot sync:**
- MutationObserver watches `#activity-dot` and `#follow-up-dot` → mirrors class to mobile equivalents

### Wire into `js/main.js`
```js
import * as mobileNav from './mobile-nav.js';
// at end of initializeApp():
await mobileNav.initMobileNav();
window.mobileNav = mobileNav;
```

---

## Phase 4: Performance

| Improvement | File | Detail |
|-------------|------|--------|
| Lazy view init | `js/ui.js` | Don't render Dashboard charts or KB until user navigates there. Track with `viewInitialized = new Set(['tickets'])` |
| TTL response cache | `js/state.js` | `appCache` object with `get(key)/set(key, data)` + TTL: leaderboard=60s, stats=30s |
| Early device detection | `index.html` `<head>` | Inline script sets `data-predetect="mobile"` before CSS loads to prevent sidebar flash |
| Skeleton states | `js/ui.js` | `showTicketSkeletons(containerId, count=5)` renders wave-animated placeholder cards; cleared after data loads |

---

## Phase 5: Polish

| Item | File | Detail |
|------|------|--------|
| Security headers | `vercel.json` | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin` |
| iOS input zoom | `css/mobile.css` | All inputs inside mobile sheets get `font-size: 16px !important` |
| Touch targets | `css/mobile.css` | All buttons inside `.ticket-card` on mobile: `min-width: 36px; min-height: 36px` |
| Broken paths | `reset-password.html` | Change `./Pics/logo.png` → `assets/bpal-logo.png`, `./Pics/fav.png` → `assets/bpal-logo.png` |

---

## Files Changed / To Change

### Phase 1 (Security) — Done
| File | Change |
|------|--------|
| `supabase/functions/award-points/index.js` | JWT auth + userId validation + cron secret |
| `supabase/functions/verify-admin/index.ts` | Removed email substring checks |
| `supabase/functions/admin-create-user/index.ts` | Removed email/metadata checks, uses RPC |
| `supabase/functions/admin-delete-user/index.ts` | Removed email/metadata checks, uses RPC |
| `supabase/functions/admin-set-password/index.ts` | Removed email/metadata checks, uses RPC |
| `supabase/functions/admin-update-user/index.ts` | Removed email/metadata checks, uses RPC |
| `database/admin_teams_rpc.sql` | Added `is_super_admin()` guard to 3 functions |
| `database/phase2_rls_policies.sql` | Updated `is_super_admin_check()` to use RPC |

### Phase 1.5–1.8 (Remaining Security) — Pending
| File | Change |
|------|--------|
| `js/ui.js` | Add `escapeHTML()` export |
| `js/tickets.js` | Apply `escapeHTML()` to subject, usernames in innerHTML |
| `js/main.js` | Apply `escapeHTML()` to leaderboard, stats, activity log |
| `js/knowledge-base.js` | Apply `escapeHTML()` to entry fields |
| `admin/js/admin-broadcast.js` | Apply `escapeHTML()` to usernames |
| `admin/js/admin-functions.js` | Apply `escapeHTML()` to search results |
| All 6 edge functions | Restrict CORS to specific domains |
| `api/send-announcement.js` | SMTP to env vars, fix TLS, add auth |
| `supabase/functions/check-and-send-reminders-edge-function.js` | Add cron secret |

### Phase 2 (PWA) — Pending
| File | Change |
|------|--------|
| `manifest.json` | New file |
| `sw.js` | New file |
| `assets/icon-192.png` | New — resize from bpal-logo.png |
| `assets/icon-512.png` | New — resize from bpal-logo.png |
| `index.html` | Manifest link, meta tags, SW registration, install banner HTML |
| `js/main.js` | `beforeinstallprompt` handler, `triggerInstallPrompt()` export |

### Phase 3 (Mobile) — Pending
| File | Change |
|------|--------|
| `css/mobile.css` | New file — all mobile styles |
| `js/mobile-nav.js` | New file — mobile nav controller |
| `index.html` | Pre-detect script, mobile.css link, bottom nav HTML, FAB, bottom sheets, sub-tabs, PTR indicator, install banner |
| `js/main.js` | Import + init mobileNav, expose window.mobileNav |

### Phase 4–5 (Performance + Polish) — Pending
| File | Change |
|------|--------|
| `js/ui.js` | Skeleton functions, lazy view init |
| `js/state.js` | TTL appCache |
| `vercel.json` | Security headers |
| `reset-password.html` | Fix broken image paths |

---

## Tech Stack

- **Frontend:** Vanilla HTML/JS/CSS + Tailwind CSS (browser CDN build, no build step) + ES Modules
- **Backend:** Supabase (Auth, PostgreSQL, Edge Functions/Deno, Realtime subscriptions)
- **Deployment:** Vercel (static + serverless API routes)
- **Rich Text:** Quill.js (local vendor copy)
- **Charts:** Chart.js (CDN)
- **Sanitization:** DOMPurify (CDN) — used for Quill HTML output only
- **Email:** Nodemailer via Vercel serverless function (`api/send-announcement.js`)
- **Presence:** Supabase Realtime channels with 30s heartbeat
- **Point system:** Supabase Edge Function (`award-points` / deployed as `smart-task`)
