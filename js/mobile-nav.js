/**
 * mobile-nav.js — TeamsOps Mobile Navigation Controller
 *
 * Handles: bottom nav tabs, bottom sheets, FAB, sub-tabs,
 * pull-to-refresh, sidebar content cloning, shift sync,
 * swipe-to-close sheets.
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
let _contentEl = null;           // main scrollable content area

// ── Init ───────────────────────────────────────────────────────────────────
export function initMobileNav() {
    const deviceType = detectDeviceType();
    _isMobile = deviceType === 'mobile';

    if (!_isMobile) return; // desktop — do nothing

    document.body.setAttribute('data-device', 'mobile');
    document.documentElement.removeAttribute('data-predetect'); // no longer needed

    _contentEl = document.querySelector('main.flex-grow');

    // Fix Chrome Android viewport height bug:
    // 100vh includes browser UI (address bar + bottom nav), which makes the
    // app taller than the visible area and hides the bottom nav behind Chrome's bar.
    // We set --vh to the actual inner height so CSS can use calc(var(--vh) * 100).
    // In fullscreen PWA mode (display: fullscreen in manifest), the app fills the
    // entire screen including behind the status bar — visualViewport gives the
    // exact available height without the status bar.
    const _setVH = () => {
        // visualViewport.height is the most accurate — excludes keyboard, browser UI
        const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
        document.documentElement.style.setProperty('--vh', `${h * 0.01}px`);
    };
    _setVH();
    window.addEventListener('resize', _setVH, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', _setVH, { passive: true });
        window.visualViewport.addEventListener('scroll', _setVH, { passive: true });
    }

    _syncAssignDropdown();
    _syncNotificationDots();
    _syncShiftButton();
    _initPullToRefresh();
    _initSwipeGestures();
    _initSheetSwipeToClose();
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
        document.getElementById('mobile-subtabs').style.display = 'flex';
    } else if (tab === 'scores') {
        _refreshScoresSheet();
        openSheet('scores');
    } else if (tab === 'team') {
        _refreshTeamSheet();
        openSheet('team');
    } else if (tab === 'more') {
        _syncShiftButton();
        openSheet('more');
    }
}

// ── Sub-tab Switching (ticket views) ──────────────────────────────────────
export function switchSubTab(view, btnEl) {
    _activeSubTab = view;

    document.querySelectorAll('.mobile-subtab-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');

    if (window.ui && window.ui.switchView) {
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
        _activeTab = 'tickets';
        document.querySelectorAll('.mobile-nav-tab').forEach(btn => {
            btn.classList.toggle('active', btn.id === 'mobile-tab-tickets');
        });
    }

    document.getElementById('mobile-fab')?.classList.remove('open');
}

// ── Source Selection ───────────────────────────────────────────────────────
export function selectSource(source) {
    _mobileSource = source;

    ['outlook', 'teams'].forEach(s => {
        document.getElementById(`mobile-src-${s.toLowerCase()}`)
            ?.classList.toggle('selected', s.toLowerCase() === source.toLowerCase());
    });

    const sourceBtns = document.querySelectorAll('.source-btn');
    sourceBtns.forEach(btn => {
        const isMatch = btn.textContent.trim().toLowerCase().includes(source.toLowerCase());
        btn.dataset.selected = isMatch ? 'true' : 'false';
    });

    if (window.appState) {
        window.appState.selectedSource = source;
    } else {
        appState.selectedSource = source;
    }
}

// ── Create Ticket from Mobile Sheet ───────────────────────────────────────
export function createTicket() {
    const mobileSubject = document.getElementById('mobile-ticket-subject');
    const mobileAssign = document.getElementById('mobile-assign-to');
    const mobilePriority = document.getElementById('mobile-priority');

    const desktopSubject = document.getElementById('ticket-subject');
    const desktopAssign = document.getElementById('assign-to');
    const desktopPriority = document.getElementById('ticket-priority');

    if (!_mobileSource) {
        if (window.showNotification) {
            window.showNotification('Missing Source', 'Please select Outlook or Teams.', 'error');
        }
        return;
    }

    if (mobileSubject && !mobileSubject.value.trim()) {
        if (window.showNotification) {
            window.showNotification('Missing Subject', 'Please enter a ticket subject.', 'error');
        }
        return;
    }

    if (mobileSubject && desktopSubject) desktopSubject.value = mobileSubject.value;
    if (mobileAssign && desktopAssign) desktopAssign.value = mobileAssign.value;
    if (mobilePriority && desktopPriority) desktopPriority.value = mobilePriority.value;

    selectSource(_mobileSource);

    if (window.tickets && window.tickets.createTicket) {
        window.tickets.createTicket().then(() => {
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

    const copyOptions = () => { mobileAssign.innerHTML = desktopAssign.innerHTML; };
    copyOptions();
    new MutationObserver(copyOptions).observe(desktopAssign, { childList: true });
}

// ── Private: Shift button sync ────────────────────────────────────────────
// Watches the desktop #shift-btn and mirrors its state to the mobile More menu
function _syncShiftButton() {
    const shiftBtn = document.getElementById('shift-btn');
    const mobileShiftItem = document.getElementById('mobile-shift-item');
    const mobileLabel = document.getElementById('mobile-shift-label');
    if (!mobileShiftItem || !mobileLabel) return;

    const sync = () => {
        // Read state from appState and desktop button
        const isOnShift = !!appState.currentShiftId;
        let text = 'Start Shift';
        let stateClass = 'shift-start';

        if (shiftBtn) {
            const btnText = shiftBtn.textContent?.trim() || shiftBtn.querySelector('span')?.textContent?.trim();
            if (btnText) text = btnText;
        }

        if (isOnShift) {
            text = 'End Shift';
            stateClass = 'shift-end';
        }

        // Check if shift is done for the day (button disabled)
        if (shiftBtn && shiftBtn.disabled) {
            text = 'Shift Ended';
            stateClass = 'shift-done';
        }

        mobileLabel.textContent = text;
        mobileShiftItem.classList.remove('shift-start', 'shift-end', 'shift-done');
        mobileShiftItem.classList.add(stateClass);
    };

    sync();

    // Re-sync when desktop shift button changes (text/class updates)
    if (shiftBtn) {
        new MutationObserver(sync).observe(shiftBtn, {
            childList: true, subtree: true,
            attributes: true, attributeFilter: ['class', 'disabled']
        });
    }

    // Also poll appState periodically for shift changes (backup)
    setInterval(sync, 3000);
}

// ── Private: Notification dots ─────────────────────────────────────────────
function _syncNotificationDots() {
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
function _observeTeamPanel() {}

function _refreshTeamSheet() {
    const dest = document.getElementById('mobile-team-clone');
    if (!dest) return;

    const onLeave = document.getElementById('on-leave-notes-container');
    const schedAdj = document.getElementById('schedule-adjustments-container');
    const deplNotes = document.getElementById('deployment-notes-list');

    let html = '';
    if (onLeave) html += `<div style="margin-bottom:12px"><div style="font-size:12px;color:#9ca3af;font-weight:600;margin-bottom:6px;">Upcoming Absences</div>${onLeave.innerHTML}</div>`;
    if (schedAdj) html += `<div style="margin-bottom:12px"><div style="font-size:12px;color:#9ca3af;font-weight:600;margin-bottom:6px;">Schedule Adjustments</div>${schedAdj.innerHTML}</div>`;
    if (deplNotes) html += `<div><div style="font-size:12px;color:#9ca3af;font-weight:600;margin-bottom:6px;">Deployments & Meetings</div>${deplNotes.innerHTML}</div>`;

    dest.innerHTML = html || '<p style="color:#6b7280;text-align:center;padding:16px">No team updates</p>';
}

function _refreshScoresSheet() {
    const desktopPeriod = document.getElementById('stats-period');
    const mobilePeriod = document.getElementById('mobile-stats-period');
    if (desktopPeriod && mobilePeriod) {
        mobilePeriod.value = desktopPeriod.value;
    }
    const src = document.getElementById('stats-container');
    const dest = document.getElementById('mobile-stats-clone');
    if (src && dest) dest.innerHTML = src.innerHTML;
}

// ── Pull-to-Refresh ────────────────────────────────────────────────────────
function _initPullToRefresh() {
    if (!_contentEl) return;

    const THRESHOLD = 160;
    const indicator = document.getElementById('mobile-ptr-indicator');

    let ptrArmed = false;
    let startY   = 0;
    let pulling  = false;

    _contentEl.addEventListener('touchstart', (e) => {
        ptrArmed = Math.max(0, _contentEl.scrollTop) === 0;
        startY   = e.touches[0].clientY;
        pulling  = false;
    }, { passive: true });

    _contentEl.addEventListener('touchmove', (e) => {
        if (!ptrArmed) return;
        if (_contentEl.scrollTop > 2) { ptrArmed = false; return; }

        const dy = e.touches[0].clientY - startY;
        if (dy <= 0) { pulling = false; return; }

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

// ── Swipe-to-Close on Bottom Sheets ────────────────────────────────────────
// Swipe down on a sheet dismisses it without triggering PTR on the main page
function _initSheetSwipeToClose() {
    const CLOSE_THRESHOLD = 80; // px of downward swipe to close

    document.querySelectorAll('.mobile-sheet').forEach(sheet => {
        let startY = 0;
        let startScrollTop = 0;
        let swiping = false;

        sheet.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            startScrollTop = sheet.scrollTop;
            swiping = false;
        }, { passive: true });

        sheet.addEventListener('touchmove', (e) => {
            const dy = e.touches[0].clientY - startY;

            // Only allow swipe-to-close when sheet is scrolled to top
            if (sheet.scrollTop > 0) return;

            // If user is pulling down from the top of the sheet
            if (dy > 10 && startScrollTop <= 0) {
                swiping = true;
                // Translate the sheet down as user drags
                const translate = Math.min(dy * 0.6, 300);
                sheet.style.transform = `translateY(${translate}px)`;
                sheet.style.transition = 'none';
            }
        }, { passive: true });

        sheet.addEventListener('touchend', (e) => {
            if (!swiping) return;

            const dy = e.changedTouches[0].clientY - startY;

            // Reset transform
            sheet.style.transition = '';
            sheet.style.transform = '';

            if (dy > CLOSE_THRESHOLD) {
                closeAllSheets();
            }

            swiping = false;
        }, { passive: true });
    });
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
