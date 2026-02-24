/**
 * mobile-nav.js — TeamsOps Mobile Navigation Controller
 *
 * Handles: bottom nav tabs, bottom sheets, FAB, sub-tabs,
 * pull-to-refresh, sidebar content cloning, shift sync.
 *
 * Exposed as window.mobileNav for inline HTML access.
 */

import { detectDeviceType } from './device-detection.js';
import { appState } from './state.js';

// ── State ──────────────────────────────────────────────────────────────────
let _isMobile = false;
let _activeTab = 'tickets';      // bottom nav tab
let _activeSubTab = 'tickets';   // ticket sub-tab
let _mobileSource = null;        // selected ticket source for mobile form
let _ptrActive = false;          // pull-to-refresh in progress
let _ptrStartY = 0;
let _contentEl = null;           // main scrollable content area

// ── Init ───────────────────────────────────────────────────────────────────
export function initMobileNav() {
    const deviceType = detectDeviceType();
    _isMobile = deviceType === 'mobile';

    if (!_isMobile) return; // desktop — do nothing

    document.body.setAttribute('data-device', 'mobile');
    document.documentElement.removeAttribute('data-predetect'); // no longer needed

    _contentEl = document.querySelector('main.flex-grow');

    _syncAssignDropdown();
    _syncNotificationDots();
    _syncShiftLabel();
    _initPullToRefresh();
    _initSwipeGestures();
    _observeFollowUpDot();
    _observeActivityDot();
    _observeLeaderboard();
    _observeTeamPanel();
    _observeStatsContainer();

    console.log('[MobileNav] Initialized');
}

// ── Bottom Nav Tab Switching ───────────────────────────────────────────────
export function switchTab(tab) {
    _activeTab = tab;

    // Update tab button states
    document.querySelectorAll('.mobile-nav-tab').forEach(btn => {
        btn.classList.toggle('active', btn.id === `mobile-tab-${tab}`);
    });

    if (tab === 'tickets') {
        closeAllSheets();
        // Show ticket sub-tabs and main content
        document.getElementById('mobile-subtabs').style.display = 'flex';
    } else if (tab === 'scores') {
        _refreshScoresSheet();
        openSheet('scores');
    } else if (tab === 'team') {
        _refreshTeamSheet();
        openSheet('team');
    } else if (tab === 'more') {
        _syncShiftLabel();
        openSheet('more');
    }
}

// ── Sub-tab Switching (ticket views) ──────────────────────────────────────
export function switchSubTab(view, btnEl) {
    _activeSubTab = view;

    document.querySelectorAll('.mobile-subtab-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    // Delegate to the desktop ui.switchView
    if (window.ui && window.ui.switchView) {
        // Find the corresponding desktop tab button
        const tabMap = {
            'tickets': 'tab-tickets',
            'done': 'tab-done',
            'follow-up': 'tab-follow-up',
            'knowledge-base': 'tab-knowledge-base',
            'dashboard': 'tab-dashboard',
        };
        const desktopTabBtn = document.getElementById(tabMap[view]);
        window.ui.switchView(view, desktopTabBtn);
    }
}

// ── Sheet Management ───────────────────────────────────────────────────────
export function openSheet(sheetName) {
    closeAllSheets(false); // close others without resetting tab

    const backdrop = document.getElementById('mobile-sheet-backdrop');
    const sheet = document.getElementById(`mobile-${sheetName}-sheet`);
    if (!backdrop || !sheet) return;

    backdrop.classList.add('open');
    sheet.classList.add('open');

    // Close FAB if open
    document.getElementById('mobile-fab')?.classList.remove('open');
}

export function closeAllSheets(resetTab = true) {
    document.getElementById('mobile-sheet-backdrop')?.classList.remove('open');
    document.querySelectorAll('.mobile-sheet').forEach(s => s.classList.remove('open'));

    if (resetTab && _activeTab !== 'tickets') {
        // Reset nav tab to tickets
        _activeTab = 'tickets';
        document.querySelectorAll('.mobile-nav-tab').forEach(btn => {
            btn.classList.toggle('active', btn.id === 'mobile-tab-tickets');
        });
    }

    document.getElementById('mobile-fab')?.classList.remove('open');
}

// ── FAB ────────────────────────────────────────────────────────────────────
// openSheet('create') handles the FAB tap — called from HTML onclick

// ── Source Selection ───────────────────────────────────────────────────────
export function selectSource(source) {
    _mobileSource = source;

    // Update mobile UI
    ['outlook', 'teams'].forEach(s => {
        document.getElementById(`mobile-src-${s.toLowerCase()}`)
            ?.classList.toggle('selected', s.toLowerCase() === source.toLowerCase());
    });

    // Sync to desktop hidden source buttons so appState.selectedSource is set
    const sourceBtns = document.querySelectorAll('.source-btn');
    sourceBtns.forEach(btn => {
        const isMatch = btn.textContent.trim().toLowerCase().includes(source.toLowerCase());
        btn.dataset.selected = isMatch ? 'true' : 'false';
    });

    // Update appState directly
    if (window.appState) {
        window.appState.selectedSource = source;
    } else {
        appState.selectedSource = source;
    }
}

// ── Create Ticket from Mobile Sheet ───────────────────────────────────────
export function createTicket() {
    // Sync mobile fields → desktop hidden fields
    const mobileSubject = document.getElementById('mobile-ticket-subject');
    const mobileAssign = document.getElementById('mobile-assign-to');
    const mobilePriority = document.getElementById('mobile-priority');

    const desktopSubject = document.getElementById('ticket-subject');
    const desktopAssign = document.getElementById('assign-to');
    const desktopPriority = document.getElementById('ticket-priority');

    // Validate source selected
    if (!_mobileSource) {
        if (window.showNotification) {
            window.showNotification('Missing Source', 'Please select Outlook or Teams.', 'error');
        }
        return;
    }

    // Validate subject not empty
    if (mobileSubject && !mobileSubject.value.trim()) {
        if (window.showNotification) {
            window.showNotification('Missing Subject', 'Please enter a ticket subject.', 'error');
        }
        return;
    }

    if (mobileSubject && desktopSubject) desktopSubject.value = mobileSubject.value;
    if (mobileAssign && desktopAssign) desktopAssign.value = mobileAssign.value;
    if (mobilePriority && desktopPriority) desktopPriority.value = mobilePriority.value;

    // Sync source
    selectSource(_mobileSource);

    // Delegate to desktop createTicket
    if (window.tickets && window.tickets.createTicket) {
        window.tickets.createTicket().then(() => {
            // Clear mobile form on success
            if (mobileSubject) mobileSubject.value = '';
            _mobileSource = null;
            document.querySelectorAll('.mobile-source-btn').forEach(b => b.classList.remove('selected'));
            closeAllSheets();
        }).catch(() => {
            // Error shown by tickets.createTicket notification — keep sheet open
        });
    }
}

// ── Shift toggle from More sheet ───────────────────────────────────────────
export function toggleShiftFromMore() {
    if (window.schedule && window.schedule.toggleShift) {
        window.schedule.toggleShift();
    }
    closeAllSheets();
}

// ── Stats period sync ──────────────────────────────────────────────────────
export function syncStatsPeriod(value) {
    const desktopSelect = document.getElementById('stats-period');
    if (desktopSelect) {
        desktopSelect.value = value;
        desktopSelect.dispatchEvent(new Event('change'));
    }
    if (window.main && window.main.applyFilters) {
        window.main.applyFilters();
    }
}

// ── Private: Assign dropdown sync ─────────────────────────────────────────
function _syncAssignDropdown() {
    const desktopAssign = document.getElementById('assign-to');
    const mobileAssign = document.getElementById('mobile-assign-to');
    if (!desktopAssign || !mobileAssign) return;

    // Copy options from desktop → mobile
    const copyOptions = () => {
        mobileAssign.innerHTML = desktopAssign.innerHTML;
    };

    copyOptions();

    // Re-copy whenever desktop dropdown changes (populated async by main.js)
    new MutationObserver(copyOptions).observe(desktopAssign, { childList: true });
}

// ── Private: Shift label sync ──────────────────────────────────────────────
function _syncShiftLabel() {
    const shiftBtn = document.getElementById('shift-btn');
    const mobileLabel = document.getElementById('mobile-shift-label');
    if (!shiftBtn || !mobileLabel) return;
    const text = shiftBtn.querySelector('span')?.textContent?.trim() || 'Start Shift';
    mobileLabel.textContent = text;
}

// ── Private: Notification dots ─────────────────────────────────────────────
function _syncNotificationDots() {
    // Observe follow-up dot
    _observeFollowUpDot();
    _observeActivityDot();
}

function _observeFollowUpDot() {
    const desktopDot = document.getElementById('follow-up-dot');
    const mobileDot = document.getElementById('mobile-followup-dot');
    if (!desktopDot || !mobileDot) return;

    const sync = () => {
        const hidden = desktopDot.classList.contains('hidden') || desktopDot.style.display === 'none';
        mobileDot.classList.toggle('visible', !hidden);
    };
    sync();
    new MutationObserver(sync).observe(desktopDot, { attributes: true, attributeFilter: ['class', 'style'] });
}

function _observeActivityDot() {
    const desktopDot = document.querySelector('#activity-log-btn .absolute.h-2');
    const mobileDot = document.getElementById('mobile-activity-dot');
    if (!desktopDot || !mobileDot) return;

    const sync = () => {
        const hidden = desktopDot.classList.contains('hidden');
        mobileDot.style.display = hidden ? 'none' : 'block';
    };
    sync();
    new MutationObserver(sync).observe(desktopDot, { attributes: true, attributeFilter: ['class'] });
}

// ── Private: Leaderboard + Stats clone ────────────────────────────────────
function _observeLeaderboard() {
    const src = document.getElementById('leaderboard-container');
    const dest = document.getElementById('mobile-leaderboard-clone');
    if (!src || !dest) return;

    const sync = () => { dest.innerHTML = src.innerHTML; };
    sync();
    new MutationObserver(sync).observe(src, { childList: true, subtree: true });
}

function _observeStatsContainer() {
    const src = document.getElementById('stats-container');
    const dest = document.getElementById('mobile-stats-clone');
    if (!src || !dest) return;

    const sync = () => { dest.innerHTML = src.innerHTML; };
    sync();
    new MutationObserver(sync).observe(src, { childList: true, subtree: true });
}

// ── Private: Team sheet content ────────────────────────────────────────────
function _observeTeamPanel() {
    // We'll clone the right sidebar content into the team sheet on open
}

function _refreshTeamSheet() {
    const dest = document.getElementById('mobile-team-clone');
    if (!dest) return;

    // Clone: on-leave notes, schedule adjustments, deployments
    const onLeave = document.getElementById('on-leave-notes-container');
    const schedAdj = document.getElementById('schedule-adjustments-container');
    const deplNotes = document.getElementById('deployment-notes-list');

    let html = '';
    if (onLeave) html += `<div style="margin-bottom:16px"><div style="font-size:13px;color:#9ca3af;font-weight:600;margin-bottom:8px;">🏖️ Upcoming Absences</div>${onLeave.innerHTML}</div>`;
    if (schedAdj) html += `<div style="margin-bottom:16px"><div style="font-size:13px;color:#9ca3af;font-weight:600;margin-bottom:8px;">⚠️ Schedule Adjustments</div>${schedAdj.innerHTML}</div>`;
    if (deplNotes) html += `<div><div style="font-size:13px;color:#9ca3af;font-weight:600;margin-bottom:8px;">🚀 Deployments & Meetings</div>${deplNotes.innerHTML}</div>`;

    dest.innerHTML = html || '<p style="color:#6b7280;text-align:center;padding:20px">No team updates</p>';
}

function _refreshScoresSheet() {
    // Leaderboard is handled by MutationObserver
    // Also sync stats period selector
    const desktopPeriod = document.getElementById('stats-period');
    const mobilePeriod = document.getElementById('mobile-stats-period');
    if (desktopPeriod && mobilePeriod) {
        mobilePeriod.value = desktopPeriod.value;
    }
    // Refresh stats clone
    const src = document.getElementById('stats-container');
    const dest = document.getElementById('mobile-stats-clone');
    if (src && dest) dest.innerHTML = src.innerHTML;
}

// ── Pull-to-Refresh ────────────────────────────────────────────────────────
function _initPullToRefresh() {
    if (!_contentEl) return;

    const THRESHOLD = 160;   // px of downward pull required to trigger
    const indicator = document.getElementById('mobile-ptr-indicator');

    let ptrArmed = false;    // true only when scroll is at exact top at touchstart
    let startY   = 0;
    let pulling  = false;

    _contentEl.addEventListener('touchstart', (e) => {
        // Arm PTR only when the list is scrolled exactly to the top.
        // Math.max guards against negative scrollTop on iOS rubber-band.
        ptrArmed = Math.max(0, _contentEl.scrollTop) === 0;
        startY   = e.touches[0].clientY;
        pulling  = false;
    }, { passive: true });

    _contentEl.addEventListener('touchmove', (e) => {
        if (!ptrArmed) return;

        // Disarm if the user has scrolled down even slightly (ensures we're still at top)
        if (_contentEl.scrollTop > 2) { ptrArmed = false; return; }

        const dy = e.touches[0].clientY - startY;
        if (dy <= 0) { pulling = false; return; }   // swiping upward — ignore

        pulling = true;
        const progress = Math.min(dy / THRESHOLD, 1);
        if (indicator) {
            indicator.classList.toggle('ptr-visible', progress > 0.2);
            indicator.style.opacity = progress;
            indicator.style.transform = `translateY(${Math.min(dy * 0.4, 56)}px)`;
        }
    }, { passive: true });

    _contentEl.addEventListener('touchend', () => {
        if (!ptrArmed || !pulling) {
            _resetPtrIndicator(indicator);
            return;
        }

        const dy = _contentEl.scrollTop; // already reset by scroll engine; use last move value
        // We stored progress in the indicator style — check opacity as proxy
        const triggered = indicator && parseFloat(indicator.style.opacity || 0) >= 0.98;

        if (triggered) {
            if (indicator) indicator.classList.add('ptr-loading');
            if (window.tickets && window.tickets.fetchTickets) {
                window.tickets.fetchTickets(true).finally(() => _resetPtrIndicator(indicator));
            } else {
                window.location.reload();
            }
        } else {
            _resetPtrIndicator(indicator);
        }

        ptrArmed = false;
        pulling  = false;
    }, { passive: true });
}

function _resetPtrIndicator(indicator) {
    if (!indicator) return;
    indicator.classList.remove('ptr-visible', 'ptr-loading');
    indicator.style.opacity  = '0';
    indicator.style.transform = '';
}

// ── Swipe Gestures (horizontal swipe switches sub-tabs) ────────────────────
function _initSwipeGestures() {
    if (!_contentEl) return;

    const subTabs = ['tickets', 'done', 'follow-up', 'knowledge-base', 'dashboard'];
    let touchStartX = 0;
    let touchStartY = 0;

    _contentEl.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    _contentEl.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;

        // Only register horizontal swipes (dx dominant, min 60px)
        if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;

        const currentIdx = subTabs.indexOf(_activeSubTab);
        let nextIdx = currentIdx + (dx < 0 ? 1 : -1);
        nextIdx = Math.max(0, Math.min(nextIdx, subTabs.length - 1));

        if (nextIdx !== currentIdx) {
            const targetView = subTabs[nextIdx];
            const btnEls = document.querySelectorAll('.mobile-subtab-btn');
            switchSubTab(targetView, btnEls[nextIdx]);
        }
    }, { passive: true });
}

// ── Expose to window ───────────────────────────────────────────────────────
window.mobileNav = {
    initMobileNav,
    switchTab,
    switchSubTab,
    openSheet,
    closeAllSheets,
    selectSource,
    createTicket,
    toggleShiftFromMore,
    syncStatsPeriod,
};
