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

    // Remove Tailwind h-screen (height:100vh) from body and app-container.
    // On Chrome mobile 100vh includes the browser URL bar which is TALLER
    // than the actual visible viewport, pushing the bottom nav off-screen.
    // Our CSS uses position:fixed + inset:0 + height:100% instead.
    document.body.classList.remove('h-screen');
    const appContainer = document.getElementById('app-container');
    if (appContainer) appContainer.classList.remove('h-screen');

    // Also remove the inline padding-bottom on <main> — CSS handles it
    const mainEl = document.querySelector('main.flex-grow');
    if (mainEl) mainEl.style.removeProperty('padding-bottom');

    _contentEl = document.querySelector('main.flex-grow');

    // Force scroll containment on the entire flex chain via JS.
    // Deferred to next frame so the layout is already painted — avoids
    // a white-flash where wrappers collapse to 0px before content renders.
    requestAnimationFrame(() => {
        try { _lockFlexChain(appContainer); } catch (e) { console.error('[MobileNav] _lockFlexChain error:', e); }
    });

    // CRITICAL: Block all touch-scroll that doesn't originate inside <main>
    // or a .mobile-sheet. This prevents the header, bottom nav, filter bar,
    // and subtabs from scrolling the whole layout when dragged.
    try { _blockNonMainScroll(); } catch (e) { console.error('[MobileNav] _blockNonMainScroll error:', e); }

    // Set --vh custom property = 1% of the real inner height.
    // body is position:fixed;inset:0 on mobile so window.innerHeight
    // is always the true visible area (Chrome toolbar excluded).
    const _setVH = () => {
        document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    };
    _setVH();
    window.addEventListener('resize', _setVH, { passive: true });

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
    _observeTicketLists();

    console.log('[MobileNav] Initialized');
}

// ── Block Non-Main Scroll ─────────────────────────────────────────────────
// Prevent touchmove on anything except <main> and .mobile-sheet from
// causing a scroll. This is the definitive fix for "whole page scrolls
// when touching the header / bottom nav / filter bar".
function _blockNonMainScroll() {
    document.addEventListener('touchmove', (e) => {
        // Allow scrolling inside <main>
        let el = e.target;
        while (el && el !== document.body) {
            if (el.tagName === 'MAIN') return;
            if (el.classList && el.classList.contains('mobile-sheet')) return;
            if (el.id === 'mobile-subtabs') return;
            if (el.closest && el.closest('#tickets-filter-bar .max-w-7xl')) return;
            el = el.parentElement;
        }
        e.preventDefault();
    }, { passive: false });
}

// ── Lock Flex Chain ──────────────────────────────────────────────────────
// Walk from #app-container down to <main> and force every intermediate
// wrapper to: overflow:hidden, flex:1 1 0%, min-height:0, display:flex.
// This guarantees scroll is ONLY possible inside <main>.
function _lockFlexChain(container) {
    if (!container) return;
    const main = container.querySelector('main');
    if (!main) return;

    // Walk up from main to container, collecting intermediate wrappers
    const chain = [];
    let el = main.parentElement;
    while (el && el !== container) {
        chain.push(el);
        el = el.parentElement;
    }

    // Apply constraints to each wrapper
    chain.forEach(wrapper => {
        wrapper.style.overflow = 'hidden';
        wrapper.style.flex = '1 1 0%';
        wrapper.style.minHeight = '0';
        // Preserve existing flex-direction if it's a column
        if (getComputedStyle(wrapper).flexDirection === 'column') {
            wrapper.style.display = 'flex';
            wrapper.style.flexDirection = 'column';
        } else {
            wrapper.style.display = 'flex';
        }
    });

    // Make sure <main> itself is the scroll container
    main.style.flex = '1 1 0%';
    main.style.minHeight = '0';
    main.style.overflowY = 'auto';
    main.style.overflowX = 'hidden';
    main.style.overscrollBehaviorY = 'contain';
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
    const dest = document.getElementById('mobile-team-stats-clone');
    if (!src || !dest) return;

    const sync = () => { dest.innerHTML = src.innerHTML; };
    sync();
    new MutationObserver(sync).observe(src, { childList: true, subtree: true });
}

// ── Private: Team sheet content ────────────────────────────────────────────
function _observeTeamPanel() {}

function _refreshTeamSheet() {
    // Sync team stats
    const desktopPeriod = document.getElementById('stats-period');
    const mobilePeriod = document.getElementById('mobile-team-stats-period');
    if (desktopPeriod && mobilePeriod) {
        mobilePeriod.value = desktopPeriod.value;
    }
    const statsSrc = document.getElementById('stats-container');
    const statsDest = document.getElementById('mobile-team-stats-clone');
    if (statsSrc && statsDest) statsDest.innerHTML = statsSrc.innerHTML;

    // Sync absences / schedule adjustments
    const dest = document.getElementById('mobile-team-clone');
    if (!dest) return;

    const onLeave = document.getElementById('on-leave-notes-container');
    const schedAdj = document.getElementById('schedule-adjustments-container');

    let html = '';
    if (onLeave && onLeave.innerHTML.trim()) html += `<div style="margin-bottom:12px"><div style="font-size:12px;color:#9ca3af;font-weight:600;margin-bottom:6px;">Upcoming Absences</div>${onLeave.innerHTML}</div>`;
    if (schedAdj && schedAdj.innerHTML.trim()) html += `<div style="margin-bottom:12px"><div style="font-size:12px;color:#9ca3af;font-weight:600;margin-bottom:6px;">Schedule Adjustments</div>${schedAdj.innerHTML}</div>`;

    dest.innerHTML = html || '<p style="color:#6b7280;text-align:center;padding:16px">No updates</p>';
}

function _refreshScoresSheet() {
    // Scores sheet now only shows leaderboard — no stats sync needed
    const src = document.getElementById('leaderboard-container');
    const dest = document.getElementById('mobile-leaderboard-clone');
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

// ── Mobile Ticket Card Post-Processor ────────────────────────────────
// After tickets render, inject mobile-specific rows into each card:
//   Row 1: (already has avatar + #ID + user → assignee from desktop HTML)
//   Row 2: source letter (O/T), priority dot, status badge
//   Row 3: smart date + action buttons (cloned from hidden desktop footer)

const PRIORITY_COLORS = {
    'High': '#ef4444',
    'Medium': '#f59e0b',
    'Low': '#22c55e',
    'Urgent': '#dc2626',
};

function _smartDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const now = new Date();
    const isToday = d.getFullYear() === now.getFullYear() &&
                    d.getMonth() === now.getMonth() &&
                    d.getDate() === now.getDate();
    if (isToday) {
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const day = d.getDate();
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const yr = String(d.getFullYear()).slice(-2);
    return `${day} ${months[d.getMonth()]} ${yr}`;
}

function _processTicketCard(card) {
    if (card.dataset.mobileProcessed) return;
    card.dataset.mobileProcessed = '1';

    const ticketId = card.dataset.ticketId || card.id;
    console.log('[MobileCard] Processing:', ticketId);

    const header = card.querySelector('.ticket-header');
    if (!header) { console.warn('[MobileCard] No .ticket-header found in', ticketId); return; }

    const spaceY = header.querySelector('.space-y-1\\.5');
    if (!spaceY) { console.warn('[MobileCard] No .space-y-1.5 found in', ticketId); return; }

    // ── Extract data from the hidden right-side badges ──
    const rightBadges = header.querySelector('.flex.items-center.gap-1\\.5.flex-shrink-0');
    console.log('[MobileCard] rightBadges:', !!rightBadges);
    let sourceLetter = '';
    let sourceClass = '';
    let priorityText = '';
    let priorityColor = '#f59e0b';
    let statusEl = null;

    if (rightBadges) {
        const srcBadge = rightBadges.querySelector('[class*="bg-blue-500"], [class*="bg-purple-500"]');
        console.log('[MobileCard] srcBadge:', !!srcBadge, srcBadge?.textContent?.trim());
        if (srcBadge) {
            const txt = srcBadge.textContent.trim().toLowerCase();
            if (txt.includes('outlook')) { sourceLetter = 'O'; sourceClass = 'm-src-o'; }
            else { sourceLetter = 'T'; sourceClass = 'm-src-t'; }
        }

        const priBadge = rightBadges.querySelector('.priority-badge');
        console.log('[MobileCard] priBadge:', !!priBadge, priBadge?.textContent?.trim());
        if (priBadge) {
            priorityText = priBadge.textContent.trim();
            priorityColor = PRIORITY_COLORS[priorityText] || '#f59e0b';
        }

        const statusDiv = rightBadges.querySelector('[onclick*="toggleTicketStatus"]');
        console.log('[MobileCard] statusDiv:', !!statusDiv, statusDiv?.textContent?.trim());
        if (statusDiv) {
            statusEl = statusDiv.cloneNode(true);
            statusEl.className = 'm-status';
            const isDone = statusDiv.textContent.trim() === 'Done';
            statusEl.style.background = isDone ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)';
            statusEl.style.color = isDone ? '#4ade80' : '#fbbf24';
            statusEl.style.border = `1px solid ${isDone ? 'rgba(34,197,94,0.4)' : 'rgba(245,158,11,0.4)'}`;
            statusEl.style.cursor = 'pointer';
        }
    }

    // ── Row 2: source(O/T) + priority dot + status ──
    const row2 = document.createElement('div');
    row2.className = 'm-ticket-row2';

    if (sourceLetter) {
        const srcSpan = document.createElement('span');
        srcSpan.className = `m-src ${sourceClass}`;
        srcSpan.textContent = sourceLetter;
        row2.appendChild(srcSpan);
    }

    const dot = document.createElement('span');
    dot.className = 'm-priority-dot';
    dot.style.background = priorityColor;
    dot.title = priorityText;
    row2.appendChild(dot);

    if (statusEl) row2.appendChild(statusEl);

    // ── Row 3: smart date + action buttons ──
    const row3 = document.createElement('div');
    row3.className = 'm-ticket-row3';

    // DEBUG: Log all direct children of card
    const directChildren = card.children;
    console.log('[MobileCard] Direct children count:', directChildren.length);
    for (let i = 0; i < directChildren.length; i++) {
        console.log('[MobileCard] Child', i, ':', directChildren[i].className.substring(0, 80));
    }

    // Try multiple strategies to find the footer
    let footer = card.querySelector(':scope > .mt-2.pt-3.border-t');
    console.log('[MobileCard] Footer via :scope > .mt-2:', !!footer);
    if (!footer) {
        footer = card.querySelector(':scope > .mt-3.pt-3.border-t');
        console.log('[MobileCard] Footer via :scope > .mt-3:', !!footer);
    }
    if (!footer) {
        // Fallback: find last direct child div that has border-t class
        const children = Array.from(card.children);
        footer = children.reverse().find(el => el.classList.contains('border-t') && el.classList.contains('pt-3'));
        console.log('[MobileCard] Footer via fallback (last border-t child):', !!footer);
    }
    if (!footer) {
        // Last resort: find any element containing "Created:"
        card.querySelectorAll('p').forEach(p => {
            if (p.textContent.includes('Created:')) {
                footer = p.closest('.border-t');
                console.log('[MobileCard] Footer via Created: text search:', !!footer);
            }
        });
    }

    let createdAt = '';
    let updatedAt = '';

    if (footer) {
        console.log('[MobileCard] Footer class:', footer.className.substring(0, 100));
        footer.querySelectorAll('p').forEach(p => {
            const text = p.textContent || '';
            console.log('[MobileCard] Footer <p>:', text.substring(0, 60));
            if (text.includes('Created:')) createdAt = text.replace('Created:', '').trim();
            else if (text.includes('Updated:')) updatedAt = text.replace('Updated:', '').trim();
        });
        console.log('[MobileCard] createdAt:', createdAt, '| updatedAt:', updatedAt);
    } else {
        console.warn('[MobileCard] NO FOOTER FOUND for', ticketId);
    }

    const dateSpan = document.createElement('span');
    dateSpan.className = 'm-date';
    const parts = [];
    if (createdAt) parts.push(_smartDate(createdAt));
    if (updatedAt) {
        const u = _smartDate(updatedAt);
        if (u && u !== parts[0]) parts.push('· ' + u);
    }
    dateSpan.textContent = parts.join(' ') || '';
    console.log('[MobileCard] Date text:', dateSpan.textContent);
    row3.appendChild(dateSpan);

    // Clone action buttons from the hidden footer
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'm-actions';

    if (footer) {
        // Try multiple selectors for actions container
        let footerActions = footer.querySelector('.flex.justify-end.items-center');
        console.log('[MobileCard] footerActions via .flex.justify-end.items-center:', !!footerActions);
        if (!footerActions) {
            footerActions = footer.querySelector('.flex.justify-end');
            console.log('[MobileCard] footerActions via .flex.justify-end:', !!footerActions);
        }
        if (!footerActions) {
            // Last resort: find div containing buttons
            footerActions = footer.querySelector('div:last-child');
            console.log('[MobileCard] footerActions via div:last-child:', !!footerActions);
        }
        if (footerActions) {
            const btns = footerActions.querySelectorAll('button, label');
            console.log('[MobileCard] Action buttons found:', btns.length);
            btns.forEach(el => {
                actionsDiv.appendChild(el.cloneNode(true));
            });
            footerActions.querySelectorAll('input[type="file"]').forEach(inp => {
                actionsDiv.appendChild(inp.cloneNode(true));
            });
        }
    }
    row3.appendChild(actionsDiv);
    console.log('[MobileCard] Row3 actions children:', actionsDiv.children.length);

    // ── Inject into DOM ──
    spaceY.appendChild(row2);
    spaceY.appendChild(row3);
    console.log('[MobileCard] Done processing', ticketId);
}

function _processAllTicketCards() {
    if (!_isMobile) return;
    document.querySelectorAll('.ticket-card:not([data-mobile-processed])').forEach(_processTicketCard);
}

function _observeTicketLists() {
    if (!_isMobile) return;

    const listIds = ['ticket-list', 'done-ticket-list', 'follow-up-ticket-list'];
    listIds.forEach(id => {
        const list = document.getElementById(id);
        if (!list) return;
        new MutationObserver(() => {
            clearTimeout(list._mobileProcessTimer);
            list._mobileProcessTimer = setTimeout(_processAllTicketCards, 50);
        }).observe(list, { childList: true, subtree: false });
    });

    // Process any cards already rendered
    _processAllTicketCards();
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
