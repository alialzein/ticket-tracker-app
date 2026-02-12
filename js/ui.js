import { log, logError, logWarn } from './logger.js';
// js/ui.js

import { appState } from './state.js';
import { _supabase } from './config.js';
import * as tickets from './tickets.js';


let confirmCallback = null;

// --- UTILITY FUNCTIONS ---
// User Colors - Official color palette (5 colors, cycling)
const USER_COLORS = [
    { hex: '#00D9FF', bg: 'bg-[#00D9FF]/20', text: 'text-[#00D9FF]', rgb: 'rgb(0, 217, 255)' },       // Cyan
    { hex: '#ff569c', bg: 'bg-[#ff569c]/20', text: 'text-[#ff569c]', rgb: 'rgb(255, 86, 156)' },       // Pink
    { hex: '#FFBE0B', bg: 'bg-[#FFBE0B]/20', text: 'text-[#FFBE0B]', rgb: 'rgb(255, 190, 11)' },      // Yellow
    { hex: '#c09de4', bg: 'bg-[#c09de4]/20', text: 'text-[#c09de4]', rgb: 'rgb(192, 157, 228)' },     // Purple
    { hex: '#3A86FF', bg: 'bg-[#3A86FF]/20', text: 'text-[#3A86FF]', rgb: 'rgb(58, 134, 255)' }       // Blue
];

// Cache for user colors fetched from database
const userColorCache = new Map();

// Activity log pagination state
const activityState = {
    offset: 0,
    limit: 20,
    allActivities: [],
    displayedActivities: [],
    currentFilter: ''
};

/**
 * Get user's specific color from database (user_settings.name_color)
 * Each user has a fixed, assigned color saved in database (admin-only setting)
 * Accepts ANY valid hex color from database
 * @param {string} username - The username to get a color for
 * @returns {object} Color object with bg, text, and rgb properties
 */
export async function getUserColor(username) {
    if (!username) return USER_COLORS[0];

    // Check cache first
    if (userColorCache.has(username)) {
        return userColorCache.get(username);
    }

    try {
        // Fetch user's assigned color from database
        // Note: user_settings uses 'system_username' not 'username'
        const { data, error } = await _supabase
            .from('user_settings')
            .select('name_color')
            .eq('system_username', username)
            .single();

        if (error || !data || !data.name_color) {
            // User not found or no color set, use default
            const defaultColor = USER_COLORS[0];
            userColorCache.set(username, defaultColor);
            return defaultColor;
        }

        // Accept ANY hex color from database (admin sets these)
        const colorHex = data.name_color.toLowerCase();

        // Convert hex to RGB for inline styles
        const rgb = hexToRgb(colorHex);

        // Create dynamic color object
        const colorObj = {
            hex: colorHex,
            bg: `bg-[${colorHex}]/20`,
            text: `text-[${colorHex}]`,
            rgb: rgb
        };

        userColorCache.set(username, colorObj);
        return colorObj;
    } catch (err) {
        logError('[UI] Error fetching user color for', username, ':', err);
        return USER_COLORS[0];
    }
}

/**
 * Batch fetch user colors for multiple usernames at once (performance optimization)
 * @param {string[]} usernames - Array of usernames to fetch colors for
 * @returns {Promise<Map>} Map of username to color object
 */
export async function getBatchUserColors(usernames) {
    if (!usernames || usernames.length === 0) return new Map();

    // Filter out usernames already in cache
    const uncachedUsernames = usernames.filter(username => !userColorCache.has(username));

    // If all are cached, return from cache
    if (uncachedUsernames.length === 0) {
        const result = new Map();
        usernames.forEach(username => {
            result.set(username, userColorCache.get(username));
        });
        return result;
    }

    try {
        // Fetch all uncached users — match by either system_username OR display_name
        // because different parts of the app use different identifiers
        const quoted = uncachedUsernames.map(u => `"${u.replace(/"/g, '\\"')}"`).join(',');
        const { data, error } = await _supabase
            .from('user_settings')
            .select('system_username, display_name, name_color')
            .or(`system_username.in.(${quoted}),display_name.in.(${quoted})`);

        if (error) throw error;

        // Process fetched colors — cache under BOTH system_username and display_name
        // so lookup succeeds regardless of which identifier is used
        if (data) {
            data.forEach(user => {
                const colorHex = user.name_color?.toLowerCase() || USER_COLORS[0].hex;
                const rgb = hexToRgb(colorHex);
                const colorObj = {
                    hex: colorHex,
                    bg: `bg-[${colorHex}]/20`,
                    text: `text-[${colorHex}]`,
                    rgb: rgb
                };
                if (user.system_username) userColorCache.set(user.system_username, colorObj);
                if (user.display_name)    userColorCache.set(user.display_name, colorObj);
            });
        }

        // For users not found in database, set default color
        uncachedUsernames.forEach(username => {
            if (!userColorCache.has(username)) {
                userColorCache.set(username, USER_COLORS[0]);
            }
        });

        // Return all requested colors (from cache now)
        const result = new Map();
        usernames.forEach(username => {
            result.set(username, userColorCache.get(username) || USER_COLORS[0]);
        });
        return result;
    } catch (err) {
        logError('[UI] Error batch fetching user colors:', err);
        // Return default colors for all on error
        const result = new Map();
        usernames.forEach(username => {
            result.set(username, USER_COLORS[0]);
        });
        return result;
    }
}

/**
 * Convert hex color to RGB string
 * @param {string} hex - Hex color code (e.g., '#ff0000')
 * @returns {string} RGB string (e.g., 'rgb(255, 0, 0)')
 */
function hexToRgb(hex) {
    // Remove # if present
    hex = hex.replace('#', '');

    // Parse hex values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Set a specific color for a user (admin function)
 * @param {string} username - The username to assign color to
 * @param {string} colorHex - The hex color code (e.g., '#ff569c')
 */
export async function setUserColor(username, colorHex) {
    try {
        // Note: user_settings uses 'system_username' not 'username'
        const { error } = await _supabase
            .from('user_settings')
            .update({ name_color: colorHex })
            .eq('system_username', username);

        if (error) throw error;

        // Clear cache for this user
        userColorCache.delete(username);
    } catch (err) {
        logError('[UI] Error setting user color:', err);
    }
}

/**
 * Subscribe to user_settings changes and bust the color cache when a row is updated.
 * Call once after login so all clients pick up admin color changes without a full reload.
 */
export function subscribeToUserColorChanges() {
    _supabase
        .channel('user_settings_color_sync')
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'user_settings'
        }, (payload) => {
            const sysUsername = payload.new?.system_username;
            const displayName = payload.new?.display_name;
            if (sysUsername) userColorCache.delete(sysUsername);
            if (displayName)  userColorCache.delete(displayName);
            if (sysUsername || displayName) {
                log('[UI] Color cache busted for:', sysUsername, displayName);
            }
        })
        .subscribe();
}

export async function switchView(viewName, clickedButton) {
    appState.currentView = viewName;
    const indicator = document.getElementById('tab-indicator');
    const tabs = document.querySelectorAll('.tab-btn');

    tabs.forEach(tab => {
        tab.classList.remove('text-white');
        tab.classList.add('text-gray-400');
    });

    if (clickedButton) {
        clickedButton.classList.remove('text-gray-400');
        clickedButton.classList.add('text-white');

        indicator.style.left = `${clickedButton.offsetLeft}px`;
        indicator.style.width = `${clickedButton.offsetWidth}px`;
        const colors = { dashboard: 'bg-indigo-600', tickets: 'bg-amber-600', done: 'bg-green-600', 'follow-up': 'bg-slate-600', 'knowledge-base': 'bg-blue-600' };
        indicator.className = `absolute top-0 bottom-0 h-full rounded-md transition-all duration-300 ease-in-out ${colors[viewName]}`;
    }

    const views = { dashboard: 'dashboard-view', tickets: 'tickets-view', done: 'done-view', 'follow-up': 'follow-up-view', 'knowledge-base': 'knowledge-base-view' };
    Object.values(views).forEach(v => {
        const viewEl = document.getElementById(v);
        if (viewEl) viewEl.classList.add('hidden');
    });

    const currentViewEl = document.getElementById(views[viewName]);
    if (currentViewEl) currentViewEl.classList.remove('hidden');

    const filterBar = document.getElementById('tickets-filter-bar');
    if (filterBar) {
        filterBar.style.display = 'none';
    }

    if (['tickets', 'done', 'follow-up'].includes(viewName)) {
        if (viewName === 'follow-up') {
            document.getElementById('follow-up-dot').classList.add('hidden');
            _supabase.auth.updateUser({ data: { last_followup_view: new Date().toISOString() } });
        }
        if (filterBar) {
            filterBar.style.display = 'block';
        }
        // Force hide loading overlay when switching views
        hideLoading();
        await window.main.applyFilters();
    } else if (viewName === 'dashboard') {
        await window.main.renderDashboard();
        await window.main.renderStats();
    } else if (viewName === 'knowledge-base') {
        if (window.knowledgeBase && window.knowledgeBase.renderKnowledgeBaseView) {
            await window.knowledgeBase.renderKnowledgeBaseView();
        }
    }
}

// --- NOTIFICATIONS ---

function updateDismissAllButton() {
    const panel = document.getElementById('notification-panel');
    if (!panel) return;
    const notifications = panel.querySelectorAll('.notification');
    let btn = document.getElementById('dismiss-all-btn');
    if (notifications.length > 1) {
        if (!btn) {
            btn = document.createElement('div');
            btn.id = 'dismiss-all-btn';
            btn.className = 'flex justify-end';
            btn.innerHTML = `<button onclick="window.ui.dismissAllNotifications()" class="text-xs text-white/70 hover:text-white bg-white/10 hover:bg-white/20 border border-white/20 rounded px-2 py-1 transition-colors">Dismiss All</button>`;
            panel.insertBefore(btn, panel.firstChild);
        }
    } else if (btn) {
        btn.remove();
    }
}

export function showNotification(title, body, type = 'info', createSystemNotification = true, autoDismiss = null) {
    const panel = document.getElementById('notification-panel');
    if (!panel) return;
    const id = `notif-${Date.now()}`;
    const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-indigo-500' };

    // Auto-dismiss logic based on notification content
    // If autoDismiss is explicitly set, use that value
    // Otherwise, check if it should be preserved (important notifications only)
    let shouldAutoDismiss = autoDismiss;
    if (shouldAutoDismiss === null) {
        const titleLower = title.toLowerCase();
        const bodyLower = body.toLowerCase();
        const combinedText = titleLower + ' ' + bodyLower;

        // Preserve ONLY these important notifications (user must manually dismiss)
        // Note: Badges, mentions, milestones are already persisted via their dedicated tables
        const preserveKeywords = [
            'break', 'exceeded', 'penalty', 'blocked',                    // Break-related
            'points', 'score', '-20', '+', 'awarded',                     // Score-related
            'badge', 'achievement', 'earned',                             // Badge-related
            'leaderboard', 'rank', 'top',                                 // Leaderboard-related
            'late', 'shift', 'tardy',                                     // Late shift
            'schedule', 'adjusted', 'changed',                            // Schedule adjustment
            'absent', 'absence', 'missed',                                // Absence
            'mentioned', 'tagged', '@'                                     // Mentions in comments
        ];

        // Check if notification contains any preserve keywords
        const shouldPreserve = preserveKeywords.some(keyword =>
            combinedText.includes(keyword)
        );

        // Auto-dismiss everything else (tickets, exports, profile changes, etc.)
        shouldAutoDismiss = !shouldPreserve;
    }

    const notification = document.createElement('div');
    notification.id = id;
    notification.className = `notification w-full p-4 rounded-lg shadow-lg text-white ${colors[type]} glassmorphism mb-2`;
    notification.innerHTML = `
        <div class="flex items-start justify-between gap-3">
            <div class="flex-1">
                <p class="font-bold">${title}</p>
                <p class="text-sm">${body}</p>
            </div>
            <button onclick="window.ui.dismissNotification('${id}')" class="flex-shrink-0 text-white hover:text-gray-200 transition-colors" title="Dismiss">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    `;
    panel.appendChild(notification);
    setTimeout(() => { notification.classList.add('show'); }, 10);
    updateDismissAllButton();

    if (shouldAutoDismiss) {
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => { notification.remove(); updateDismissAllButton(); }, 500);
        }, 5000);
    }

    if (Notification.permission === 'granted' && createSystemNotification) { new Notification(title, { body }); }
}

/**
 * Dismiss a notification
 */
export function dismissNotification(notificationId) {
    const notification = document.getElementById(notificationId);
    if (notification) {
        notification.classList.remove('show');
        setTimeout(() => { notification.remove(); updateDismissAllButton(); }, 500);
    }
}

export function dismissAllNotifications() {
    const panel = document.getElementById('notification-panel');
    if (!panel) return;
    panel.querySelectorAll('.notification').forEach(n => {
        n.classList.remove('show');
        setTimeout(() => n.remove(), 500);
    });
    const btn = document.getElementById('dismiss-all-btn');
    if (btn) btn.remove();
}

/**
 * Restore persistent notifications from existing notification tables on page load
 * Uses: badge_notifications, mention_notifications, milestone_notifications
 */
export async function restorePersistentNotifications() {
    if (!appState.currentUser) {
        log('[Notifications] No current user, skipping restoration');
        return;
    }

    try {
        const panel = document.getElementById('notification-panel');
        if (!panel) return;

        const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-indigo-500' };
        let totalRestored = 0;

        // 1. Fetch unread badge notifications
        const { data: badgeNotifs, error: badgeError } = await _supabase
            .from('badge_notifications')
            .select('*')
            .eq('user_id', appState.currentUser.id)
            .eq('is_read', false)
            .order('created_at', { ascending: false });

        if (!badgeError && badgeNotifs && badgeNotifs.length > 0) {
            badgeNotifs.forEach(data => {
                const notificationId = `notif-badge-${data.id}`;
                showPersistentNotification(panel, notificationId, data.badge_emoji + ' ' + data.badge_name, data.message, 'success', colors, data.id, 'badge');
                totalRestored++;
            });
        }

        // 2. Fetch unread mention notifications
        const { data: mentionNotifs, error: mentionError } = await _supabase
            .from('mention_notifications')
            .select('*')
            .eq('mentioned_user_id', appState.currentUser.id)
            .eq('is_read', false)
            .order('created_at', { ascending: false });

        if (!mentionError && mentionNotifs && mentionNotifs.length > 0) {
            mentionNotifs.forEach(data => {
                const notificationId = `notif-mention-${data.id}`;
                const title = `${data.mentioned_by_username} mentioned you`;
                const body = `In ticket: ${data.ticket_subject}`;
                showPersistentNotification(panel, notificationId, title, body, 'info', colors, data.id, 'mention');
                totalRestored++;
            });
        }

        // 3. Fetch unread assignment notifications
        const { data: assignmentNotifs, error: assignmentError } = await _supabase
            .from('assignment_notifications')
            .select('*')
            .eq('user_id', appState.currentUser.id)
            .eq('is_read', false)
            .order('created_at', { ascending: false });

        if (!assignmentError && assignmentNotifs && assignmentNotifs.length > 0) {
            assignmentNotifs.forEach(data => {
                const notificationId = `notif-assignment-${data.id}`;
                const priorityEmoji = { High: '🔴', Medium: '🟡', Low: '🟢' }[data.priority] || '🎫';
                const title = `${priorityEmoji} New Ticket Assigned!`;
                const body = `${data.assigned_by_username} assigned you: ${data.ticket_subject}`;
                showPersistentNotification(panel, notificationId, title, body, 'info', colors, data.id, 'assignment', data.ticket_id);
                totalRestored++;
            });
        }

        // Note: Milestone notifications are handled by tickets.js loadExistingMilestoneNotifications()
        // with custom styling

        if (totalRestored > 0) {
            log(`[Notifications] Restored ${totalRestored} persistent notification(s)`);
        }
    } catch (err) {
        logError('[Notifications] Exception restoring notifications:', err);
    }
}

/**
 * Helper function to show a persistent notification
 */
function showPersistentNotification(panel, notificationId, title, body, type, colors, dbId, category, ticketId = null) {
    const notification = document.createElement('div');
    notification.id = notificationId;
    const cursorClass = ticketId ? 'cursor-pointer hover:scale-105 transition-transform' : '';
    notification.className = `notification w-full p-4 rounded-lg shadow-lg text-white ${colors[type]} glassmorphism mb-2 ${cursorClass}`;

    // Add click handler for assignment notifications to navigate to ticket
    const clickHandler = ticketId ? `onclick="window.ui.navigateToTicketFromNotification(${ticketId}, '${notificationId}', ${dbId}, '${category}')"` : '';

    notification.innerHTML = `
        <div class="flex items-start justify-between gap-3" ${clickHandler}>
            <div class="flex-1">
                <p class="font-bold">${title}</p>
                <p class="text-sm">${body}</p>
                ${ticketId ? '<p class="text-xs mt-1 opacity-75">Click to view ticket</p>' : ''}
            </div>
            <button onclick="event.stopPropagation(); window.ui.dismissPersistentNotification('${notificationId}', ${dbId}, '${category}')" class="flex-shrink-0 text-white hover:text-gray-200 transition-colors" title="Dismiss">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    `;
    panel.appendChild(notification);
    setTimeout(() => { notification.classList.add('show'); }, 10);
}

/**
 * Dismiss a persistent notification and mark as read in the appropriate table
 */
export async function dismissPersistentNotification(notificationId, dbId, category) {
    const notification = document.getElementById(notificationId);
    if (notification) {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 500);
    }

    try {
        if (category === 'badge') {
            await _supabase
                .from('badge_notifications')
                .update({ is_read: true })
                .eq('id', dbId);
        } else if (category === 'mention') {
            await _supabase
                .from('mention_notifications')
                .update({ is_read: true })
                .eq('id', dbId);
        } else if (category === 'assignment') {
            await _supabase
                .from('assignment_notifications')
                .update({ is_read: true })
                .eq('id', dbId);
        }
        // Note: Milestone notifications are handled by tickets.js dismissMilestoneNotification()
    } catch (err) {
        logError('[Notifications] Error dismissing persistent notification:', err);
    }
}

/**
 * Navigate to a ticket from a notification and mark as read
 */
export async function navigateToTicketFromNotification(ticketId, notificationId, dbId, category) {
    // Dismiss and mark notification as read
    await dismissPersistentNotification(notificationId, dbId, category);

    // Scroll to and expand the ticket
    const ticketElement = document.getElementById(`ticket-${ticketId}`);
    if (ticketElement) {
        ticketElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Expand the ticket if it's not already expanded
        const ticketBody = ticketElement.querySelector('.ticket-body');
        if (ticketBody && ticketBody.classList.contains('hidden')) {
            // Trigger the expand function
            if (window.tickets && window.tickets.expandTicket) {
                window.tickets.expandTicket(ticketId);
            }
        }

        // Add a highlight effect
        ticketElement.classList.add('ring-2', 'ring-blue-400', 'ring-offset-2', 'ring-offset-gray-800');
        setTimeout(() => {
            ticketElement.classList.remove('ring-2', 'ring-blue-400', 'ring-offset-2', 'ring-offset-gray-800');
        }, 3000);
    } else {
        // Ticket not visible in current view - show a message
        showNotification('Ticket Not Visible', 'The assigned ticket may be in a different view (Done/Follow-up).', 'info');
    }
}

export function playSoundAlert() {
    // Audio alert disabled
}

// --- LOADERS ---
export function showLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.remove('hidden');
        overlay.style.display = 'flex'; // Reset to flex to show centered content
    }
}

export function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
        // Also set display none to ensure it doesn't block clicks
        overlay.style.display = 'none';
    }
}

// js/ui.js

export function openEditModal(id) {
    const ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === id);
    if (!ticket) return;

    document.getElementById('edit-ticket-id').value = id;
    document.getElementById('edit-subject').value = ticket.subject;
    document.getElementById('edit-status').value = ticket.status;
    document.getElementById('edit-priority').value = ticket.priority || 'Medium';
    
    // Correctly handle the multi-select tag element
    const tagsSelect = document.getElementById('edit-tags');
    const ticketTags = ticket.tags || [];

    // Use a standard for loop for compatibility to select the ticket's current tags
    for (let i = 0; i < tagsSelect.options.length; i++) {
        const option = tagsSelect.options[i];
        option.selected = ticketTags.includes(option.value);
    }

    const complexityContainer = document.getElementById('complexity-container');
    if (appState.currentUserRole === 'admin') {
        document.getElementById('edit-complexity').value = ticket.complexity || 1;
        complexityContainer.classList.remove('hidden');
    } else {
        complexityContainer.classList.add('hidden');
    }
    
    openModal('edit-modal');
}



// ========== RELATIONSHIP MODAL ==========
export function closeRelationshipModal() {
    const modal = document.getElementById('relationship-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300);
    }
}

// ========== pinned TICKETS TAB ==========

export async function openPinnedTicketsView() {
    appState.currentView = 'pinned';
    
    const views = {
        dashboard: 'dashboard-view',
        tickets: 'tickets-view',
        done: 'done-view',
        'follow-up': 'follow-up-view',
        pinned: 'pinned-view'
    };
    
    Object.values(views).forEach(v => {
        const viewEl = document.getElementById(v);
        if (viewEl) viewEl.classList.add('hidden');
    });

    const pinnedView = document.getElementById('pinned-view');
    if (pinnedView) {
        pinnedView.classList.remove('hidden');
    }

    // Fetch and display pinned tickets
    const pinnedIds = await tickets.fetchUserPinnedTickets();
    
    const pinnedList = document.getElementById('pinned-ticket-list');
    if (!pinnedList) return;

    pinnedList.innerHTML = '';

    if (pinnedIds.length === 0) {
        pinnedList.innerHTML = '<div class="text-center text-gray-400 mt-8">No pinned tickets yet. Click the pin icon on any ticket to add it here.</div>';
        return;
    }

    try {
        // Fetch full ticket data
        const { data: pinnedTickets, error } = await _supabase
            .from('tickets')
            .select('*')
            .in('id', pinnedIds)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        if (!pinnedTickets || pinnedTickets.length === 0) {
            pinnedList.innerHTML = '<div class="text-center text-gray-400 mt-8">No pinned tickets found.</div>';
            return;
        }

        for (const ticket of pinnedTickets) {
            const ticketElement = await tickets.createTicketElement(ticket);
            pinnedList.appendChild(ticketElement);
        }
    } catch (err) {
        logError('Error fetching pinned tickets:', err);
        pinnedList.innerHTML = '<div class="text-center text-red-400 mt-8">Error loading pinned tickets</div>';
    }
}

// Make openModal available as a public function
export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}



export function closeEditModal() { closeModal('edit-modal'); }

export function openConfirmModal(title, message, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    confirmCallback = callback;
    openModal('confirm-modal');
    const confirmBtn = document.getElementById('confirm-btn');
    confirmBtn.onclick = () => {
        if (confirmCallback) confirmCallback();
        closeConfirmModal();
    };
}
export function closeConfirmModal() {
    closeModal('confirm-modal');
    confirmCallback = null;
}

export function openNewPasswordModal() { openModal('new-password-modal'); }
export function closeNewPasswordModal() { closeModal('new-password-modal'); }

export function openAdminModal() { openModal('admin-panel-modal'); }
export function closeAdminModal() { closeModal('admin-panel-modal'); }

export function openScheduleModal() {
    openModal('schedule-modal');
    document.getElementById('schedule-date-picker').value = new Date().toISOString().split('T')[0];
    window.schedule.fetchSchedule();
    window.schedule.highlightOverriddenDates();
    if (appState.currentUserRole === 'admin') {
        document.getElementById('admin-schedule-buttons').classList.remove('hidden');
    }
    const scheduleBtn = document.getElementById('schedule-btn');
    scheduleBtn.classList.remove('glowing-pulse');
    document.getElementById('schedule-dot').classList.add('hidden');
    _supabase.auth.updateUser({ data: { last_schedule_view: new Date().toISOString() } });
}
export function closeScheduleModal() {
    closeModal('schedule-modal');
    window.schedule.toggleScheduleEdit(false);
}

export function openDefaultScheduleModal() {
    if (!appState.isAdmin && !appState.isTeamLeader) {
        showNotification('Access Denied', 'Only admins and team leaders can manage default schedules.', 'error');
        return;
    }
    openModal('default-schedule-modal');
    window.schedule.switchDayTab(document.querySelector('.tab-button[data-day="1"]'), 1);
}
export function closeDefaultScheduleModal() { closeModal('default-schedule-modal'); }

export function openCompletedItemsModal() {
    openModal('completed-items-modal');
    window.schedule.fetchCompletedItems();
}
export function closeCompletedItemsModal() { closeModal('completed-items-modal'); }

export function openEditScheduleItemModal(itemId) {
    const itemToEdit = appState.deploymentNotes.find(note => note.id === itemId);
    if (!itemToEdit) return;
    document.getElementById('edit-item-id').value = itemToEdit.id;
    document.getElementById('edit-item-text').value = itemToEdit.note_text;
    document.getElementById('edit-item-type').value = itemToEdit.type;
    document.getElementById('edit-item-date').value = itemToEdit.deployment_date;
    document.getElementById('edit-item-time').value = itemToEdit.deployment_time;
    openModal('edit-schedule-item-modal');
}
export function closeEditScheduleItemModal() { closeModal('edit-schedule-item-modal'); }

export function openPerformanceModal() {
    openModal('performance-modal');
    window.main.renderPerformanceAnalytics();
}
export function closePerformanceModal() { closeModal('performance-modal'); }

export function openHistoryModal() {
    openModal('history-modal');
    window.main.renderLeaderboardHistory();
}
export function closeHistoryModal() { closeModal('history-modal'); }

export function openImageViewer(imageUrl) {
    const modal = document.getElementById('image-viewer-modal');
    const img = document.getElementById('full-image-view');  // <- CORRECT ID
    if (modal && img) {
        img.src = imageUrl;
        openModal('image-viewer-modal');
    }
}

export function closeImageViewer() {
    closeModal('image-viewer-modal');
}

export function closeAllModals() {
    ['edit-modal', 'confirm-modal', 'schedule-modal', 'default-schedule-modal', 'admin-panel-modal', 'completed-items-modal', 'edit-schedule-item-modal', 'performance-modal', 'history-modal', 'new-password-modal', 'image-viewer-modal', 'close-reason-modal'].forEach(closeModal);
    toggleActivityLog(true);
}


// --- UI TOGGLES & HELPERS ---

export function toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('-translate-x-full');
    document.getElementById('sidebar-backdrop')?.classList.toggle('hidden');
}

export function toggleRightSidebar() {
    document.getElementById('on-leave-sidebar')?.classList.toggle('translate-x-full');
    document.getElementById('right-sidebar-backdrop')?.classList.toggle('hidden');
}

export function toggleTicketCollapse(ticketId) {
    const ticket = document.getElementById(`ticket-${ticketId}`);
    if (!ticket) return;

    const body = ticket.querySelector('.ticket-body');
    const icon = ticket.querySelector('.ticket-collapse-btn svg');

    if (body && icon) {
        const isExpanding = body.classList.contains('hidden');

        if (isExpanding) {
            // Mark as "read" when expanding
            const ticketData = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === ticketId);
            if (ticketData) {
                appState.seenTickets[ticketId] = ticketData.updated_at;
                localStorage.setItem('seenTickets', JSON.stringify(appState.seenTickets));

                // Remove the red dot
                const redDot = ticket.querySelector(`#unread-note-dot-${ticketId}`);
                if (redDot) {
                    redDot.classList.add('hidden');
                }
            }
        }

        body.classList.toggle('hidden');
        icon.classList.toggle('rotate-180');
    }
}


export function toggleItemForm() {
    const form = document.getElementById('deployment-form');
    const btn = document.getElementById('add-deployment-btn');
    if (!form || !btn) return;
    if (form.classList.toggle('hidden')) {
        btn.textContent = 'Add ➕';
        btn.classList.remove('bg-red-600', 'hover:bg-red-700');
        btn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        document.getElementById('deployment-note-text').value = '';
        document.getElementById('deployment-date').value = '';
        document.getElementById('deployment-time').value = '';
    } else {
        btn.textContent = 'Cancel ❌';
        btn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
        btn.classList.add('bg-red-600', 'hover:bg-red-700');
        document.getElementById('deployment-date').value = new Date().toISOString().split('T')[0];
    }
}

export function updateCharCounter(inputId, counterId, maxLength) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(counterId);
    if (!input || !counter) return;
    const remaining = maxLength - input.value.length;
    counter.textContent = `${remaining} characters remaining`;
    counter.classList.toggle('warning', remaining <= 50 && remaining > 20);
    counter.classList.toggle('danger', remaining <= 20);
}

export function formatTime(timeString) {
    if (!timeString) return '';
    const [hour, minute] = timeString.split(':');
    let h = parseInt(hour, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${minute.padStart(2, '0')} ${ampm}`;
}

export function formatSeconds(seconds) {
    if (seconds === 0) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h > 0 ? h + 'h ' : ''}${m}m`;
}

export function toggleCustomDaysInput() {
    const statsPeriod = document.getElementById('stats-period');
    const customDaysInput = document.getElementById('custom-days-input');
    if (statsPeriod.value === 'custom') {
        customDaysInput.classList.remove('hidden');
        customDaysInput.focus();
    } else {
        customDaysInput.classList.add('hidden');
        window.main.applyFilters();
    }
}

// --- BROADCAST MESSAGES ---
export async function fetchBroadcastMessage() {
    try {
        const { data, error } = await _supabase.from('broadcast_messages').select('*').eq('team_id', appState.currentUserTeamId).eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle();
        if (error) throw error;
        const container = document.getElementById('broadcast-message-container');
        if (!container) return;
        if (data) {
            const dismissedId = sessionStorage.getItem('dismissedBroadcastId');
            if (dismissedId === data.id.toString()) {
                container.classList.add('hidden');
                return;
            }
            document.getElementById('broadcast-message-text').textContent = data.message;
            container.dataset.id = data.id;
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
        }
    } catch (err) {
        logError("Error fetching broadcast:", err);
    }
}

export function dismissBroadcast() {
    const container = document.getElementById('broadcast-message-container');
    if (!container) return;
    const messageId = container.dataset.id;
    if (messageId) {
        sessionStorage.setItem('dismissedBroadcastId', messageId);
    }
    container.classList.add('hidden');
}

// --- ACTIVITY LOG ---
export async function toggleActivityLog(forceClose = false) {
    const log = document.getElementById('activity-log');
    if (!log) return;
    if (forceClose) {
        log.classList.add('hidden');
        return;
    }
    log.classList.toggle('hidden');
    if (!log.classList.contains('hidden')) {
        document.getElementById('activity-dot').classList.add('hidden');
        fetchActivities();
        setTimeout(async () => {
            try {
                await _supabase.auth.updateUser({ data: { last_activity_view: new Date().toISOString() } });
                await fetchActivities();
            } catch (err) {
                logError('Error marking activities as read:', err);
            }
        }, 3000);
    }
}

async function fetchActivities(reset = true) {
    try {
        const { data: { user } } = await _supabase.auth.getUser();
        if (!user) return;

        // Reset state if this is a fresh fetch
        if (reset) {
            activityState.offset = 0;
            activityState.allActivities = [];
            activityState.displayedActivities = [];
        }

        const lastActivityView = user.user_metadata.last_activity_view || '1970-01-01T00:00:00.000Z';
        const { data, error } = await _supabase
            .from('activity_log')
            .select('*')
            .eq('team_id', appState.currentUserTeamId)
            .order('created_at', { ascending: false })
            .limit(500); // Fetch more to allow client-side filtering

        if (error) throw error;

        // Store all activities and apply filter
        if (data) {
            activityState.allActivities = data;
            filterAndDisplayActivities(lastActivityView);
        } else {
            displayEmptyState();
        }

        // Set up filter event listener
        const filterInput = document.getElementById('activity-filter');
        if (filterInput) {
            filterInput.removeEventListener('input', handleFilterChange);
            filterInput.addEventListener('input', handleFilterChange);
        }

        // Update load more button visibility
        updateLoadMoreButton();
    } catch (err) {
        logError('Error fetching activities:', err);
        const list = document.getElementById('activity-list');
        if (list) {
            list.innerHTML = '<div class="text-center text-red-400 py-8">Error loading activities</div>';
        }
    }
}

function filterAndDisplayActivities(lastActivityView) {
    const filterText = document.getElementById('activity-filter')?.value.toLowerCase() || '';
    activityState.currentFilter = filterText;

    // Filter activities by username
    let filtered = activityState.allActivities;
    if (filterText) {
        filtered = filtered.filter(activity =>
            activity.username.toLowerCase().includes(filterText)
        );
    }

    // Store filtered activities
    activityState.displayedActivities = filtered;

    // Get items to show (from offset to offset + limit)
    const itemsToShow = filtered.slice(0, activityState.offset + activityState.limit);

    if (itemsToShow.length === 0) {
        displayEmptyState();
        return;
    }

    const list = document.getElementById('activity-list');
    if (!list) return;

    list.innerHTML = itemsToShow.map(activity => {
        const isUnread = new Date(activity.created_at) > new Date(lastActivityView) && activity.user_id !== appState.currentUser.id;
        const activityIcon = getActivityIcon(activity.activity_type);
        const activityColor = getActivityColor(activity.activity_type);

        return `
            <div class="activity-item ${isUnread ? 'unread-activity' : ''}">
                <div class="flex items-start gap-3">
                    <div class="flex-shrink-0 w-8 h-8 rounded-full ${activityColor.bg} flex items-center justify-center ${activityColor.text}">
                        ${activityIcon}
                    </div>
                    <div class="flex-grow min-w-0">
                        <p class="text-sm">
                            <span class="activity-username">${activity.username}</span>
                            <span class="activity-action"> ${formatActivityAction(activity.activity_type, activity.details)}</span>
                        </p>
                        <p class="activity-time mt-1">${formatTimeAgo(activity.created_at)}</p>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function displayEmptyState() {
    const list = document.getElementById('activity-list');
    if (!list) return;

    list.innerHTML = `
        <div class="text-center text-gray-400 py-8">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <p class="text-sm">No recent activity</p>
        </div>
    `;
}

function handleFilterChange(e) {
    activityState.offset = 0; // Reset to first page when filter changes
    filterAndDisplayActivities(new Date().toISOString());
    updateLoadMoreButton();
}

function updateLoadMoreButton() {
    const loadMoreBtn = document.getElementById('load-more-btn');
    if (!loadMoreBtn) return;

    const totalToShow = activityState.offset + activityState.limit;
    const hasMore = totalToShow < activityState.displayedActivities.length;

    if (hasMore) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.style.display = 'block';
    } else {
        loadMoreBtn.classList.add('hidden');
        loadMoreBtn.style.display = 'none';
    }
}

export async function loadMoreActivities() {
    activityState.offset += activityState.limit;
    const { data: { user } } = await _supabase.auth.getUser();
    if (!user) return;
    const lastActivityView = user.user_metadata.last_activity_view || '1970-01-01T00:00:00.000Z';
    filterAndDisplayActivities(lastActivityView);
    updateLoadMoreButton();
}

// Helper function to get activity icon
function getActivityIcon(activityType) {
    const icons = {
        'TICKET_CREATED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" /></svg>',
        'TICKET_EDITED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>',
        'STATUS_CHANGED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" /></svg>',
        'NOTE_ADDED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z" clip-rule="evenodd" /></svg>',
        'NOTE_DELETED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>',
        'TICKET_DELETED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>',
        'TICKET_ASSIGNED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" /></svg>',
        'KUDOS_GIVEN': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" /></svg>',
        'SHIFT_START': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" /></svg>',
        'SHIFT_END': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" /></svg>',
        'SCHEDULE_UPDATED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd" /></svg>',
        'FOLLOWUP_ADDED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>'
    };
    return icons[activityType] || '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>';
}



// Time ago helper (if not already in this file)
function formatTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return time.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Helper function to get activity color
function getActivityColor(activityType) {
    const colors = {
        'TICKET_CREATED': { bg: 'bg-green-500/20', text: 'text-green-400' },
        'TICKET_EDITED': { bg: 'bg-blue-500/20', text: 'text-blue-400' },
        'STATUS_CHANGED': { bg: 'bg-purple-500/20', text: 'text-purple-400' },
        'NOTE_ADDED': { bg: 'bg-indigo-500/20', text: 'text-indigo-400' },
        'NOTE_DELETED': { bg: 'bg-orange-500/20', text: 'text-orange-400' },
        'TICKET_DELETED': { bg: 'bg-red-500/20', text: 'text-red-400' },
        'TICKET_ASSIGNED': { bg: 'bg-amber-500/20', text: 'text-amber-400' },
        'KUDOS_GIVEN': { bg: 'bg-pink-500/20', text: 'text-pink-400' },
        'SHIFT_START': { bg: 'bg-teal-500/20', text: 'text-teal-400' },
        'SHIFT_END': { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
        'SCHEDULE_UPDATED': { bg: 'bg-sky-500/20', text: 'text-sky-400' },
        'FOLLOWUP_ADDED': { bg: 'bg-yellow-500/20', text: 'text-yellow-400' }
    };
    return colors[activityType] || { bg: 'bg-gray-500/20', text: 'text-gray-400' };
}

function formatActivityAction(activityType, details) {
    const actions = {
        'TICKET_CREATED': `created ticket "${details?.subject || 'Untitled'}"`,
        'TICKET_EDITED': `edited ticket "${details?.subject || 'Untitled'}"`,
        'STATUS_CHANGED': `changed ticket status to ${details?.status || 'unknown'}`,
        'NOTE_ADDED': 'added a note to a ticket',
        'NOTE_DELETED': 'deleted a note from a ticket',
        'TICKET_DELETED': 'deleted a ticket',
        'TICKET_ASSIGNED': 'took assignment of a ticket',
        'KUDOS_GIVEN': `gave kudos to ${details?.receiver || 'someone'}`,
        'SHIFT_START': 'started their shift',
        'SHIFT_END': 'ended their shift',
        'SCHEDULE_UPDATED': `updated the schedule for ${details?.date || 'a date'}`,
        'DEFAULT_SCHEDULE_SAVED': `saved the default schedule for ${details?.day || 'a day'}`,
        'FOLLOWUP_ADDED': 'flagged a ticket for follow-up'
    };
    return actions[activityType] || 'performed an action';
}


export function openCloseReasonModal(ticketId) {
    const modal = document.getElementById('close-reason-modal');
    if (!modal) return;
    
    // Store ticket ID
    modal.dataset.ticketId = ticketId;
    
    // Reset form
    const completelyDoneRadio = document.querySelector('input[name="close-reason"][value="completely_done"]');
    if (completelyDoneRadio) completelyDoneRadio.checked = true;
    
    const otherText = document.getElementById('other-reason-text');
    if (otherText) otherText.value = '';
    
    const otherContainer = document.getElementById('other-reason-container');
    if (otherContainer) otherContainer.classList.add('hidden');
    
    openModal('close-reason-modal');
    
    // Add event listener for "Other" option
    document.querySelectorAll('input[name="close-reason"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const otherContainer = document.getElementById('other-reason-container');
            if (!otherContainer) return;
            
            if (e.target.value === 'other') {
                otherContainer.classList.remove('hidden');
                const otherText = document.getElementById('other-reason-text');
                if (otherText) otherText.focus();
            } else {
                otherContainer.classList.add('hidden');
            }
        });
    });
}

export function closeCloseReasonModal() {
    closeModal('close-reason-modal');
}


export async function checkForUnreadActivities() {
    try {
        const { data: { user } } = await _supabase.auth.getUser();
        if (!user) return;
        const lastActivityView = user.user_metadata.last_activity_view || '1970-01-01T00:00:00.000Z';
        const { count, error } = await _supabase.from('activity_log')
            .select('*', { count: 'exact', head: true })
            .eq('team_id', appState.currentUserTeamId)
            .gt('created_at', lastActivityView)
            .neq('user_id', appState.currentUser.id);
        if (error) throw error;
        const activityDot = document.getElementById('activity-dot');
        if (activityDot) {
            activityDot.classList.toggle('hidden', count === 0);
        }
    } catch (err) {
        logError('Error checking for unread activities:', err);
    }
}

export async function checkForUnreadFollowUps() {
    try {
        const { data: { user } } = await _supabase.auth.getUser();
        if (!user) return;
        const lastFollowUpView = user.user_metadata.last_followup_view || '1970-01-01T00:00:00.000Z';
        const { count, error } = await _supabase.from('tickets')
            .select('*', { count: 'exact', head: true })
            .eq('needs_followup', true)
            .gt('updated_at', lastFollowUpView);
        if (error) throw error;
        const followUpDot = document.getElementById('follow-up-dot');
        if (followUpDot) {
            followUpDot.classList.toggle('hidden', count === 0);
        }
    } catch (err) {
        logError("Exception checking follow-ups", err);
    }
}

export async function handleActivityLogUpdate(payload) {
    const activity = payload.new;
    const isOriginator = activity.user_id === appState.currentUser.id;
    const isLogOpen = !document.getElementById('activity-log').classList.contains('hidden');
    showNotification(isOriginator ? 'Action Logged' : 'New Team Activity', formatActivity(activity), isOriginator ? 'success' : 'info', !isOriginator);
    if (!isOriginator && !isLogOpen) {
        document.getElementById('activity-dot').classList.remove('hidden');
    }
    if (isLogOpen) {
        await fetchActivities();
    }
}

function formatActivity(log) {
    const { username, activity_type, details } = log;
    const userHtml = `<strong>${username}</strong>`;
    switch (activity_type) {
        case 'KUDOS_GIVEN': return `${userHtml} gave kudos to <strong>${details.receiver}</strong> on a ticket.`;
        case 'TICKET_CREATED': return `${userHtml} created ticket: "${details.subject || ''}"`;
        case 'STATUS_CHANGED': return `${userHtml} set a ticket's status to <strong>${details.status}</strong>`;
        case 'TICKET_ASSIGNED': return `${userHtml} took assignment of a ticket.`;
        case 'TICKET_EDITED': return `${userHtml} edited ticket: "${details.subject || ''}"`;
        case 'NOTE_ADDED': return `${userHtml} added a note to a ticket.`;
        case 'NOTE_DELETED': return `${userHtml} deleted a note from a ticket.`;
        case 'TICKET_DELETED': return `${userHtml} deleted a ticket.`;
        case 'SHIFT_START': return `${userHtml} started their shift.`;
        case 'SHIFT_END': return `${userHtml} ended their shift.`;
        case 'SCHEDULE_UPDATED': return `${userHtml} updated the schedule for <strong>${details.date}</strong>.`;
        case 'DEFAULT_SCHEDULE_SAVED': return `${userHtml} saved the default schedule for <strong>${details.day}</strong>.`;
        case 'FOLLOWUP_ADDED': return `${userHtml} flagged a ticket for follow-up.`;
        default: return `${userHtml} performed an action.`;
    }
}

// --- CHART RENDERING ---
export function renderChart(containerId, chartKey, type, data, title) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `<canvas id="${chartKey}"></canvas>`;
    if (appState.charts[chartKey]) { appState.charts[chartKey].destroy(); }
    const ctx = document.getElementById(chartKey).getContext('2d');
    appState.charts[chartKey] = new Chart(ctx, {
        type,
        data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: '#d1d5db' } },
                title: { display: true, text: title, color: '#d1d5db', font: { size: 16 } }
            },
            scales: type === 'bar' ? {
                y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
                x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }
            } : {}
        }
    });
}

// ============================================
// STATUS/BREAK MANAGEMENT SYSTEM
// ============================================

let selectedBreakType = null;
let selectedDuration = null;

const BREAK_TYPES = {
    coffee_break: {
        emoji: '☕',
        name: 'Coffee Break',
        color: 'yellow',
        durations: [5, 10, 15]
    },
    lunch: {
        emoji: '🍔',
        name: 'Lunch Break',
        color: 'orange',
        durations: [30, 45, 60]
    },
    meeting: {
        emoji: '👔',
        name: 'In Meeting',
        color: 'blue',
        durations: [15, 30, 45, 60]
    },
    away: {
        emoji: '🚶',
        name: 'Away',
        color: 'purple',
        durations: [5, 10, 15, 30]
    },
    personal: {
        emoji: '🚻',
        name: 'Personal',
        color: 'green',
        durations: [5, 10]
    },
    other: {
        emoji: '⏸️',
        name: 'Other',
        color: 'gray',
        durations: [5, 10, 15, 30, 'custom']
    }
};

/**
 * Open status selection modal
 */
export function openStatusModal() {
    const modal = document.getElementById('status-modal');
    if (!modal) return;

    // Check if user is already on break
    const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
    const myAttendance = appState.attendance.get(myName) || {};

    if (myAttendance.lunch_start_time && myAttendance.on_lunch) {
        // User is already on break - show active break info
        showActiveBreakInfo(myAttendance);
    } else {
        // Hide active break info
        document.getElementById('active-break-info').classList.add('hidden');
    }

    // Reset selection
    selectedBreakType = null;
    selectedDuration = null;
    document.getElementById('duration-section').classList.add('hidden');
    document.getElementById('reason-section').classList.add('hidden');
    document.getElementById('break-reason-input').value = '';
    document.getElementById('confirm-status-btn').disabled = true;

    // Clear selected states
    document.querySelectorAll('.status-option-card').forEach(card => {
        card.classList.remove('selected');
    });

    // Show modal
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

/**
 * Close status modal
 */
export function closeStatusModal() {
    const modal = document.getElementById('status-modal');
    if (!modal) return;

    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}

/**
 * Select break type
 */
export function selectBreakType(breakType) {
    selectedBreakType = breakType;

    // Update UI selection
    document.querySelectorAll('.status-option-card').forEach(card => {
        if (card.dataset.breakType === breakType) {
            card.classList.add('selected');
        } else {
            card.classList.remove('selected');
        }
    });

    // Show and populate duration options
    showDurationOptions(breakType);

    // Show reason input (required for "other" break type)
    const reasonSection = document.getElementById('reason-section');
    const reasonInput = document.getElementById('break-reason-input');
    reasonSection.classList.remove('hidden');

    // Mark reason as required for "other" break type
    if (breakType === 'other') {
        reasonInput.setAttribute('required', 'true');
        reasonInput.placeholder = 'Break reason (required for Other)';
    } else {
        reasonInput.removeAttribute('required');
        reasonInput.placeholder = 'Break reason (optional)';
    }
}

/**
 * Show duration options based on break type
 */
function showDurationOptions(breakType) {
    const durationSection = document.getElementById('duration-section');
    const durationOptions = document.getElementById('duration-options');
    const breakTypeConfig = BREAK_TYPES[breakType];

    durationSection.classList.remove('hidden');
    durationOptions.innerHTML = '';

    breakTypeConfig.durations.forEach(duration => {
        if (duration === 'custom') {
            // Custom duration input
            const customDiv = document.createElement('div');
            customDiv.className = 'col-span-2';
            customDiv.innerHTML = `
                <input type="number"
                    id="custom-duration-input"
                    placeholder="Minutes"
                    min="1"
                    max="240"
                    onchange="ui.selectDuration('custom', this.value)"
                    class="w-full bg-gray-700/50 text-white p-3 rounded-lg border border-gray-600 focus:ring-2 focus:ring-indigo-500 text-center font-semibold">
            `;
            durationOptions.appendChild(customDiv);
        } else {
            // Preset duration button
            const btn = document.createElement('div');
            btn.className = 'duration-option';
            btn.textContent = `${duration} min`;
            btn.onclick = () => selectDuration('preset', duration);
            btn.dataset.duration = duration;
            durationOptions.appendChild(btn);
        }
    });
}

/**
 * Select duration
 */
export function selectDuration(type, value) {
    if (type === 'preset') {
        selectedDuration = parseInt(value);

        // Update UI
        document.querySelectorAll('.duration-option').forEach(option => {
            if (option.dataset.duration == value) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
            }
        });
    } else if (type === 'custom') {
        selectedDuration = parseInt(value);
    }

    // Enable confirm button if we have both break type and duration
    document.getElementById('confirm-status-btn').disabled = !selectedBreakType || !selectedDuration || selectedDuration < 1;
}

/**
 * Confirm and start the break/status
 */
export async function confirmStatusChange() {
    if (!selectedBreakType || !selectedDuration) return;

    const reason = document.getElementById('break-reason-input').value.trim();

    // Validate that "other" break type has a reason
    if (selectedBreakType === 'other' && !reason) {
        showNotification('Reason Required', 'Please provide a reason for "Other" break type.', 'error');
        return;
    }

    try {
        // Update attendance record
        const { data, error } = await _supabase.from('attendance')
            .update({
                on_lunch: true,
                lunch_start_time: new Date().toISOString(),
                break_type: selectedBreakType,
                break_reason: reason || null,
                expected_duration: selectedDuration
            })
            .eq('id', appState.currentShiftId)
            .select();

        if (error) {
            logError('[Status Modal] Database error:', error);
            throw error;
        }

        // Broadcast to other users
        const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
        const breakConfig = BREAK_TYPES[selectedBreakType];
        const message = reason
            ? `${myName} is ${breakConfig.name.toLowerCase()}: ${reason} (${selectedDuration} min)`
            : `${myName} is on ${breakConfig.name.toLowerCase()} (${selectedDuration} min)`;

        await _supabase.rpc('broadcast_status_change', {
            p_user_id: appState.currentUser.id,
            p_username: myName,
            p_status_type: 'break_started',
            p_break_type: selectedBreakType,
            p_message: message
        });

        showNotification('Status Updated', `You're now on ${breakConfig.name.toLowerCase()}`, 'success');
        closeStatusModal();

    } catch (error) {
        logError('[Status Modal] Error updating status:', error);
        showNotification('Error', 'Could not update status: ' + error.message, 'error');
    }
}

/**
 * End current break
 */
export async function endCurrentBreak() {
    try {
        // Get current attendance to check break duration
        const { data: attendance, error: fetchError } = await _supabase
            .from('attendance')
            .select('lunch_start_time, expected_duration, break_type, total_break_time_minutes')
            .eq('id', appState.currentShiftId)
            .single();

        if (fetchError) throw fetchError;

        // Calculate actual break duration
        let minutesExceeded = 0;
        let actualDurationMinutes = 0;
        let breakType = attendance?.break_type;

        if (attendance && attendance.lunch_start_time && attendance.expected_duration) {
            const breakStart = new Date(attendance.lunch_start_time);
            const breakEnd = new Date();
            actualDurationMinutes = Math.floor((breakEnd - breakStart) / 60000);
            const expectedDuration = attendance.expected_duration;

            minutesExceeded = actualDurationMinutes - expectedDuration;

            log(`Break ended: Expected ${expectedDuration} min, actual ${actualDurationMinutes} min, exceeded by ${minutesExceeded} min`);
        }

        // Calculate new total break time (cumulative across all breaks in this shift)
        // Exclude 'meeting' and 'other' break types from total
        const currentTotal = attendance?.total_break_time_minutes || 0;
        let newTotalBreakTime = currentTotal;

        // Only add to total if break type is not 'meeting' or 'other'
        if (breakType !== 'meeting' && breakType !== 'other') {
            newTotalBreakTime = currentTotal + actualDurationMinutes;
            log(`[Break Time] Previous total: ${currentTotal} min, this break: ${actualDurationMinutes} min (${breakType}), new total: ${newTotalBreakTime} min`);
        } else {
            log(`[Break Time] Break type '${breakType}' excluded from total. Actual duration: ${actualDurationMinutes} min. Total remains: ${currentTotal} min`);
        }

        // Update attendance record with new cumulative break time
        // Note: Keep break_type, break_reason, and expected_duration for historical record
        const { error } = await _supabase.from('attendance')
            .update({
                on_lunch: false,
                lunch_start_time: null,
                total_break_time_minutes: newTotalBreakTime
            })
            .eq('id', appState.currentShiftId);

        if (error) throw error;

        // Check if break exceeded 10 minutes and apply penalty
        if (minutesExceeded >= 10) {
            const { awardPoints } = await import('./main.js');
            await awardPoints('BREAK_EXCEEDED', {
                minutesExceeded: minutesExceeded,
                breakType: breakType
            });

            showNotification(
                'Break Exceeded',
                `Your break exceeded by ${minutesExceeded} minutes. -20 points penalty applied.`,
                'error'
            );
        }

        // Broadcast return
        const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
        await _supabase.rpc('broadcast_status_change', {
            p_user_id: appState.currentUser.id,
            p_username: myName,
            p_status_type: 'break_ended',
            p_break_type: null,
            p_message: `${myName} has returned from break`
        });

        if (minutesExceeded < 10) {
            showNotification('Welcome Back!', 'You\'re back from your break', 'success');
        }

        closeStatusModal();

    } catch (error) {
        logError('Error ending break:', error);
        showNotification('Error', 'Could not end break', 'error');
    }
}

/**
 * Show active break information
 */
function showActiveBreakInfo(attendance) {
    const activeBreakInfo = document.getElementById('active-break-info');
    const activeBreakDetails = document.getElementById('active-break-details');

    if (!activeBreakInfo || !activeBreakDetails) return;

    const breakStart = new Date(attendance.lunch_start_time);
    const minutesElapsed = Math.floor((new Date() - breakStart) / 60000);
    const expectedDuration = attendance.expected_duration || 0;
    const remaining = Math.max(0, expectedDuration - minutesElapsed);

    const breakConfig = BREAK_TYPES[attendance.break_type] || BREAK_TYPES.other;

    let details = `${breakConfig.emoji} ${breakConfig.name}`;
    if (attendance.break_reason) {
        details += ` - ${attendance.break_reason}`;
    }
    details += `<br><span class="text-xs text-gray-400">Started ${minutesElapsed} min ago`;
    if (remaining > 0) {
        details += ` • ${remaining} min remaining`;
    } else if (expectedDuration > 0) {
        details += ` • <span class="text-red-400">Overdue by ${minutesElapsed - expectedDuration} min</span>`;
    }
    details += `</span>`;

    activeBreakDetails.innerHTML = details;
    activeBreakInfo.classList.remove('hidden');
}

/**
 * Display status notification toast
 */
export function displayStatusNotification(notification) {
    const container = document.getElementById('status-notifications-container');
    if (!container) return;

    const breakConfig = BREAK_TYPES[notification.break_type] || BREAK_TYPES.other;

    const toast = document.createElement('div');
    toast.className = 'status-notification-toast glassmorphism p-4 rounded-lg shadow-lg border-l-4 status-' + (notification.break_type || 'other');
    toast.id = `status-notif-${notification.id}`;

    toast.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="text-2xl">${breakConfig.emoji}</div>
            <div class="flex-1">
                <div class="font-semibold text-white mb-1">${notification.message}</div>
                <div class="text-xs text-gray-400">${new Date(notification.created_at).toLocaleTimeString()}</div>
            </div>
            <button onclick="ui.dismissStatusNotification(${notification.id})"
                class="text-gray-400 hover:text-white transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
            </button>
        </div>
    `;

    container.appendChild(toast);

    // Auto dismiss after 10 seconds
    setTimeout(() => dismissStatusNotification(notification.id), 10000);
}

/**
 * Dismiss status notification
 */
export async function dismissStatusNotification(notificationId) {
    const toast = document.getElementById(`status-notif-${notificationId}`);
    if (toast) {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }

    // Mark as read in database
    try {
        await _supabase.from('status_notifications')
            .update({ is_read: true })
            .eq('id', notificationId);
    } catch (error) {
        logError('Error dismissing notification:', error);
    }
}

// Export BREAK_TYPES for use in main.js
export { BREAK_TYPES };
