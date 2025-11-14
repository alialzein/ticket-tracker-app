// js/main.js

import { _supabase } from './config.js';
import { appState, invalidateTicketCache, invalidateStatsCache, invalidateDashboardCache } from './state.js';
import { initAuth, signIn, signUp, signOut, setNewPassword } from './auth.js';
import * as tickets from './tickets.js';
import * as schedule from './schedule.js';
import * as admin from './admin.js';
import * as ui from './ui.js';
import { BREAK_TYPES } from './ui.js';
import * as presence from './presence.js';

// --- UTILITY FUNCTIONS ---
const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
};
const debouncedApplyFilters = debounce(applyFilters, 500);

// --- INITIALIZATION and STATE MANAGEMENT ---
export async function initializeApp(session) {
    if (appState.currentUser && appState.currentUser.id === session.user.id) return;
    appState.currentUser = session.user;
    appState.seenTickets = JSON.parse(localStorage.getItem('seenTickets')) || {};

    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app-container').classList.remove('hidden');

    const currentUserEl = document.getElementById('current-user');
    if (currentUserEl) {
        currentUserEl.textContent = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
    }

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            setupAppEventListeners();
        });
    });

    ui.showLoading();
    await checkAndDisableUIForVisitor();

    setupSubscriptions();
    window.tickets.initializePresenceTracking();
    window.tickets.setupPresenceCleanup();
    window.tickets.initializeTypingIndicator();
    window.tickets.loadExistingMilestoneNotifications(); // Load milestone notifications on page load
    schedule.startShiftReminders();

    // Initialize user presence tracking (online/idle/offline status)
    await presence.initializePresence();

    // Update break timers every second (smooth countdown)
    if (!window.statsUpdateInterval) {
        window.statsUpdateInterval = setInterval(() => {
            updateBreakTimersLive();
        }, 1000); // Update every 1 second
    }

    await Promise.all([
        fetchUsers(),
        schedule.fetchAttendance(),
        schedule.fetchScheduleItems(),
        schedule.renderScheduleAdjustments(),
        ui.fetchBroadcastMessage(),
        ui.checkForUnreadActivities(),
        ui.checkForUnreadFollowUps(),
        schedule.checkScheduleUpdate(),
        window.tickets.fetchMentionNotifications(),
        window.tickets.fetchReactionNotifications(),
        window.tickets.fetchTypingIndicators('new_ticket')
    ]);

    populateAllUserDropdowns();
    await renderOnLeaveNotes();
    await renderLeaderboard();

    const initialTab = document.getElementById('tab-tickets');
    if (initialTab) {
        await ui.switchView('tickets', initialTab);
    }

    ui.hideLoading();
}

export function resetApp() {
    if (window.supabaseSubscriptions) {
        window.supabaseSubscriptions.forEach(sub => sub.unsubscribe());
    }
    window.tickets.cleanupTypingIndicators();

    // Clear stats update interval
    if (window.statsUpdateInterval) {
        clearInterval(window.statsUpdateInterval);
        window.statsUpdateInterval = null;
    }

    appState.currentUser = null;
    appState.currentShiftId = null;
    appState.tickets = [];
    appState.doneTickets = [];
    appState.followUpTickets = [];
    appState.allUsers = new Map();
    appState.userEmailMap = new Map();
    appState.attendance = new Map();
    appState.seenTickets = {};
    localStorage.removeItem('seenTickets');

    document.getElementById('login-overlay').style.display = 'flex';
    document.getElementById('app-container').classList.add('hidden');
    ['ticket-list', 'done-ticket-list', 'stats-container', 'leaderboard-container', 'on-leave-notes', 'deployment-notes-list'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
}

// --- CORE LOGIC & DATA ORCHESTRATION ---
export async function applyFilters() {
    appState.currentPage = 0;
    appState.doneCurrentPage = 0;
    // Invalidate all caches to ensure fresh data after filter changes or ticket operations
    invalidateTicketCache();
    invalidateStatsCache();
    invalidateDashboardCache();
    await tickets.fetchTickets(true);
    await renderStats();
    await renderOnLeaveNotes();
}

async function fetchUsers() {
    try {
        const { data, error } = await _supabase.rpc('get_team_members');
        if (error) throw error;
        appState.allUsers.clear();
        appState.userEmailMap.clear();
        data.forEach(user => {
            if (user.username) {
                appState.allUsers.set(user.username, user.user_id);
                appState.userEmailMap.set(user.username, user.email);
            }
        });
        const selects = ['admin-reset-user-select', 'admin-ping-user-select', 'admin-report-user-select'];
        const logSelects = ['admin-log-user-select', 'admin-history-user-select'];

        selects.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<option value="">Select User</option>';
        });
        logSelects.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.innerHTML = '<option value="">Select a User</option><option value="all">All Users</option>';
        });

        Array.from(appState.allUsers.keys()).sort().forEach(name => {
            selects.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML += `<option value="${name}">${name}</option>`;
            });
            logSelects.forEach(id => {
                const el = document.getElementById(id);
                if (el) el.innerHTML += `<option value="${name}">${name}</option>`;
            });
        });
    } catch (err) {
        console.error('Exception fetching users:', err);
    }
}


export async function awardPoints(eventType, data = {}, target = null) {
    try {
        const targetUserId = target ? target.userId : appState.currentUser.id;
        // IMPORTANT: Always use email-based username (immutable system identifier)
        const targetUsername = target ? target.username : appState.currentUser.email.split('@')[0];

        console.log(`[awardPoints] Calling Edge Function for ${eventType}:`, {
            userId: targetUserId,
            username: targetUsername,
            data
        });

        const { data: responseData, error } = await _supabase.functions.invoke('smart-task', {
            body: { eventType, userId: targetUserId, username: targetUsername, data },
        });

        if (error) {
            console.error(`[awardPoints] Edge Function error for ${eventType}:`, error);
            throw error;
        }

        console.log(`[awardPoints] Success for ${eventType}:`, responseData);
    } catch (err) {
        console.error(`[awardPoints] Failed to award points for ${eventType}:`, err);
        // Don't throw - let the operation continue even if points fail
    }
}

export async function logActivity(activity_type, details) {
    try {
        const { error } = await _supabase.from('activity_log').insert({
            user_id: appState.currentUser.id,
            username: appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0],
            activity_type,
            details
        });
        if (error) throw error;
    } catch (err) { console.error('Error logging activity:', err); }
}

// Cache for timer DOM elements to avoid repeated querySelectorAll
const timerElementCache = new Map(); // user -> { card, timerDiv, lastUpdate }

// Update break timers with countdown display (live updates)
function updateBreakTimersLive() {
    const myName = appState.currentUser?.user_metadata?.display_name || appState.currentUser?.email?.split('@')[0];

    appState.attendance.forEach((attendanceStatus, user) => {
        if (attendanceStatus.on_lunch && attendanceStatus.lunch_start_time) {
            const lunchStartTime = new Date(attendanceStatus.lunch_start_time);
            const now = new Date();
            const elapsedMs = now - lunchStartTime;

            // Store break start time in localStorage for persistence across refreshes
            const breakKey = `break_${user}_${attendanceStatus.lunch_start_time}`;
            if (!localStorage.getItem(breakKey)) {
                localStorage.setItem(breakKey, JSON.stringify({
                    startTime: attendanceStatus.lunch_start_time,
                    expectedDuration: attendanceStatus.expected_duration || 0,
                    username: user
                }));
            }

            // Calculate remaining time
            const expectedDurationMs = (attendanceStatus.expected_duration || 0) * 60 * 1000;
            const remainingMs = expectedDurationMs - elapsedMs;
            const isOverdue = remainingMs < 0;

            // Get absolute time values
            const absMs = Math.abs(remainingMs);
            const minutes = Math.floor(absMs / 60000);
            const seconds = Math.floor((absMs % 60000) / 1000);

            // Get cached timer element or find it once using data attribute
            let cached = timerElementCache.get(user);
            if (!cached || !document.contains(cached.timerContainer)) {
                // Cache miss or element removed - find it again using data attribute
                const timerContainer = document.querySelector(`[data-timer-container="${user}"]`);

                if (timerContainer) {
                    // Find the timer div inside the container (the first child with flex or text-xs class)
                    const timerDiv = timerContainer.querySelector('div') || timerContainer;
                    cached = { timerContainer, timerDiv, lastUpdate: '' };
                    timerElementCache.set(user, cached);
                }
            }

            if (cached && cached.timerDiv) {
                let newContent = '';
                let newClassName = '';
                const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                const expectedDuration = attendanceStatus.expected_duration || 0;

                if (user === myName) {
                    // My break timer - show countdown with full details
                    if (expectedDuration > 0) {
                        if (!isOverdue) {
                            // Countdown mode - time remaining
                            const warningThreshold = expectedDurationMs * 0.2; // 20% of time left = warning
                            const isNearEnd = remainingMs <= warningThreshold && remainingMs > 0;

                            if (isNearEnd) {
                                // Warning: less than 20% time left
                                newClassName = 'flex items-center gap-2 text-xs text-yellow-400 font-semibold';
                                newContent = `
                                    <span class="animate-pulse">⏰</span>
                                    <span>Time left: ${formattedTime}</span>
                                    <span class="text-gray-500">/ ${expectedDuration}min</span>
                                `;
                            } else {
                                // Normal countdown
                                newClassName = 'flex items-center gap-2 text-xs text-green-400';
                                newContent = `
                                    <span>⏱️</span>
                                    <span>Time left: ${formattedTime}</span>
                                    <span class="text-gray-500">/ ${expectedDuration}min</span>
                                `;
                            }
                        } else {
                            // Overdue - time exceeded
                            newClassName = 'flex items-center gap-2 text-xs text-red-400 font-semibold animate-pulse';
                            newContent = `
                                <span class="text-red-600">⚠️</span>
                                <span>OVERDUE: +${formattedTime}</span>
                                <span class="text-gray-500">/ ${expectedDuration}min</span>
                            `;
                        }
                    } else {
                        // No expected duration - just show elapsed time
                        const elapsedMinutes = Math.floor(elapsedMs / 60000);
                        const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
                        newClassName = 'text-xs text-gray-400';
                        newContent = `⏱️ ${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;
                    }
                } else {
                    // Other users - show countdown with expected duration if set
                    if (expectedDuration > 0) {
                        if (!isOverdue) {
                            // Show countdown for other users too
                            newClassName = 'flex items-center gap-2 text-xs text-gray-400';
                            newContent = `
                                <span>⏱️</span>
                                <span>${formattedTime} left</span>
                                <span class="text-gray-500">/ ${expectedDuration}min</span>
                            `;
                        } else {
                            // Other user is overdue - show warning
                            newClassName = 'flex items-center gap-2 text-xs text-red-400 font-semibold';
                            newContent = `
                                <span>⚠️</span>
                                <span>+${formattedTime} overdue</span>
                                <span class="text-gray-500">/ ${expectedDuration}min</span>
                            `;
                        }
                    } else {
                        // No expected duration - show elapsed time
                        const elapsedMinutes = Math.floor(elapsedMs / 60000);
                        const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
                        newClassName = 'text-xs text-gray-400';
                        newContent = `⏱️ ${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;
                    }
                }

                // Only update DOM if content actually changed
                if (cached.lastUpdate !== newContent) {
                    cached.timerDiv.className = newClassName;
                    cached.timerDiv.innerHTML = newContent;
                    cached.lastUpdate = newContent;
                }

                // Check for break time notifications (only for current user)
                if (user === myName && expectedDuration > 0) {
                    // Notification 1: Break time reached (at 0:00)
                    const breakEndNotificationKey = `break_notified_end_${breakKey}`;
                    if (isOverdue && !localStorage.getItem(breakEndNotificationKey)) {
                        localStorage.setItem(breakEndNotificationKey, 'true');

                        // Show browser notification
                        if ('Notification' in window && Notification.permission === 'granted') {
                            new Notification('Break Time is Up!', {
                                body: `Your ${expectedDuration}-minute break has ended. Please return to work.`,
                                icon: '/favicon.ico',
                                tag: 'break-time-up'
                            });
                        }

                        // Show in-app notification (slide-in notification like mentions/milestones)
                        displayBreakNotification({
                            type: 'break-ended',
                            title: 'Break Time is Up!',
                            message: `Your ${expectedDuration}-minute break has ended. Please return to work.`,
                            icon: '⏰',
                            color: 'yellow'
                        });

                        // Play alert sound
                        if (window.ui && window.ui.playSoundAlert) {
                            window.ui.playSoundAlert();
                        }
                    }

                    // Notification 2: 10 minutes overdue (point deduction warning)
                    if (isOverdue) {
                        const overdueMinutes = Math.floor(Math.abs(remainingMs) / 60000);
                        const overdue10MinNotificationKey = `break_notified_10min_${breakKey}`;

                        if (overdueMinutes >= 10 && !localStorage.getItem(overdue10MinNotificationKey)) {
                            localStorage.setItem(overdue10MinNotificationKey, 'true');

                            // Show browser notification
                            if ('Notification' in window && Notification.permission === 'granted') {
                                new Notification('Break Time Exceeded!', {
                                    body: `Your break has exceeded by ${overdueMinutes} minutes. -20 points will be deducted when you end the break.`,
                                    icon: '/favicon.ico',
                                    tag: 'break-exceeded'
                                });
                            }

                            // Show in-app notification (slide-in notification like mentions/milestones)
                            displayBreakNotification({
                                type: 'break-exceeded',
                                title: 'Break Time Exceeded!',
                                message: `Your break has exceeded by ${overdueMinutes} minutes. -20 points will be deducted when you end the break.`,
                                icon: '⚠️',
                                color: 'red'
                            });

                            // Play alert sound
                            if (window.ui && window.ui.playSoundAlert) {
                                window.ui.playSoundAlert();
                            }
                        }
                    }
                }
            }
        } else {
            // Clear localStorage when break ends (including notification flags)
            const breakKeys = Object.keys(localStorage).filter(key =>
                key.startsWith(`break_${user}_`) ||
                key.startsWith(`break_notified_end_break_${user}_`) ||
                key.startsWith(`break_notified_10min_break_${user}_`)
            );
            breakKeys.forEach(key => localStorage.removeItem(key));
        }
    });
}

// Clear timer cache when stats are re-rendered
export function clearTimerCache() {
    timerElementCache.clear();
}

/**
 * Display break notification (slide-in notification similar to mentions/milestones)
 * No database required - purely UI notification
 */
function displayBreakNotification(notification) {
    const notificationId = `break-notif-${notification.type}-${Date.now()}`;

    // Check if notification already displayed (prevent duplicates)
    if (document.getElementById(notificationId)) return;

    const container = document.getElementById('notification-panel');
    if (!container) return;

    const notificationEl = document.createElement('div');
    notificationEl.id = notificationId;

    // Color classes based on notification type
    const colorClasses = {
        yellow: 'bg-gradient-to-r from-yellow-600 to-yellow-500 border-yellow-400',
        red: 'bg-gradient-to-r from-red-600 to-red-500 border-red-400'
    };

    const bgClass = colorClasses[notification.color] || colorClasses.yellow;

    notificationEl.className = `break-notification glassmorphism p-4 rounded-lg shadow-lg border cursor-pointer transition-all ${bgClass}`;
    notificationEl.style.animation = 'slideInRight 0.3s ease-out, pulse 2s ease-in-out infinite';

    notificationEl.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-10 h-10 rounded-full bg-white/20 flex items-center justify-center text-2xl">
                ${notification.icon}
            </div>
            <div class="flex-grow min-w-0">
                <div class="flex items-start justify-between gap-2 mb-1">
                    <p class="font-semibold text-white text-sm">
                        ${notification.title}
                    </p>
                    <button onclick="this.closest('.break-notification').remove()"
                            class="text-white/80 hover:text-white transition-colors flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
                <p class="text-sm text-white/90">${notification.message}</p>
            </div>
        </div>
    `;

    // Click to dismiss
    notificationEl.onclick = (e) => {
        if (e.target.tagName !== 'BUTTON' && e.target.tagName !== 'svg' && e.target.tagName !== 'path') {
            notificationEl.style.opacity = '0';
            notificationEl.style.transform = 'translateX(100%)';
            setTimeout(() => notificationEl.remove(), 300);
        }
    };

    container.appendChild(notificationEl);

    // Auto-dismiss after 30 seconds for break ended, 60 seconds for exceeded
    const autoDismissTime = notification.type === 'break-ended' ? 30000 : 60000;
    setTimeout(() => {
        if (notificationEl && notificationEl.parentElement) {
            notificationEl.style.opacity = '0';
            notificationEl.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notificationEl.parentElement) {
                    notificationEl.remove();
                }
            }, 300);
        }
    }, autoDismissTime);
}

// --- RENDERING FUNCTIONS for main layout ---

async function renderStats() {
    const statsContainer = document.getElementById('stats-container');
    const periodSelect = document.getElementById('stats-period');

    if (!statsContainer || !periodSelect) {
        return;
    }

    // ⚡ OPTIMIZATION: Check if we have cached stats data
    const now = Date.now();
    const cacheAge = appState.cache.lastStatsFetch ? now - appState.cache.lastStatsFetch : Infinity;

    if (cacheAge < appState.cache.STATS_CACHE_TTL && appState.cache.stats) {
        console.log('[Stats] Using cached data (age:', Math.round(cacheAge / 1000), 'seconds)');
        // Use cached stats (skip the expensive database query)
        // Just re-render with existing appState.allUsers and attendance
        // Stats will be refreshed after 10 minutes automatically
    }

    schedule.clearLunchTimer();
    clearTimerCache(); // Clear cached timer elements since we're re-rendering
    statsContainer.innerHTML = '<div class="loading-spinner w-8 h-8 mx-auto"></div>';

    let daysToFilter = parseInt(periodSelect.value);
    if (periodSelect.value === 'custom') {
        daysToFilter = parseInt(document.getElementById('custom-days-input').value) || 0;
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - (daysToFilter - 1));

    try {
        // ⚡ OPTIMIZATION: Only query if cache is stale
        let allTicketsForStats;
        if (cacheAge >= appState.cache.STATS_CACHE_TTL || !appState.cache.stats) {
            let query = _supabase.from('tickets').select('handled_by, username, assigned_to_name').gte('updated_at', startDate.toISOString());
            if (appState.currentView === 'tickets') {
                query = query.eq('status', 'In Progress');
            } else if (appState.currentView === 'done') {
                query = query.eq('status', 'Done');
            }
            const { data, error } = await query;
            if (error) throw error;
            allTicketsForStats = data;

            // Update cache
            appState.cache.stats = allTicketsForStats;
            appState.cache.lastStatsFetch = Date.now();
        } else {
            allTicketsForStats = appState.cache.stats;
        }

        const userStats = {};
        allTicketsForStats.forEach(ticket => {
            const handlers = Array.from(new Set(ticket.handled_by || [ticket.assigned_to_name || ticket.username]));
            handlers.forEach(handlerName => {
                if (handlerName) {
                    userStats[handlerName] = (userStats[handlerName] || 0) + 1;
                }
            });
        });

        statsContainer.innerHTML = '';
        if (appState.allUsers.size === 0) {
            statsContainer.innerHTML = `<div class="col-span-full text-center text-gray-400"><p>No team data available</p></div>`;
            return;
        }

        // Fetch current user presence data
        const activeUsers = await presence.getActiveUsers();
        appState.userPresence.clear();
        activeUsers.forEach(p => {
            appState.userPresence.set(p.username, p.status);
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];

        // Build HTML string first to avoid duplicates
        let statsHTML = '';

        Array.from(appState.allUsers.keys()).sort().forEach(user => {
            const count = userStats[user] || 0;
            const attendanceStatus = appState.attendance.get(user);
            const presenceStatus = appState.userPresence.get(user); // online, idle, or undefined (offline)
            const userColor = ui.getUserColor(user);
            let statusHtml = '<div class="w-2 h-2 rounded-full bg-gray-500" title="Offline"></div>';
            let lunchButtonHtml = '';
            let timerHtml = '';
            if (attendanceStatus) {
                const lastShiftDate = new Date(attendanceStatus.last_shift_start);
                const lastShiftDateOnly = new Date(lastShiftDate);
                lastShiftDateOnly.setHours(0, 0, 0, 0);
                let datePrefix = '';
                if (lastShiftDateOnly.getTime() === today.getTime()) { datePrefix = 'Today '; }
                else if (lastShiftDateOnly.getTime() === yesterday.getTime()) { datePrefix = 'Yesterday '; }
                else { datePrefix = lastShiftDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' '; }
                const startTime = lastShiftDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                timerHtml = `<span class="text-xs text-gray-400">(${datePrefix}${startTime})</span>`;
            }

            if (attendanceStatus && attendanceStatus.status === 'online') {
                if (attendanceStatus.on_lunch && attendanceStatus.lunch_start_time) {
                    const breakConfig = BREAK_TYPES?.[attendanceStatus.break_type] || BREAK_TYPES?.other || {
                        emoji: '⏸️',
                        name: 'Other',
                        color: 'gray'
                    };
                    const lunchStartTime = new Date(attendanceStatus.lunch_start_time);
                    const minutesElapsed = Math.floor((new Date() - lunchStartTime) / 60000);
                    const remaining = Math.max(0, (attendanceStatus.expected_duration || 0) - minutesElapsed);

                    if (user === myName) {
                        statusHtml = `
                            <button data-action="toggle-lunch-status"
                                class="cursor-pointer glowing-pulse-red rounded-full status-${attendanceStatus.break_type}"
                                title="On ${breakConfig.name}">
                                ${breakConfig.emoji}
                            </button>
                        `;

                        // Calculate remaining time in MM:SS format (countdown)
                        const expectedDurationMs = (attendanceStatus.expected_duration || 0) * 60 * 1000;
                        const elapsedMs = new Date() - lunchStartTime;
                        const remainingMs = expectedDurationMs - elapsedMs;
                        const isOverdue = remainingMs < 0;
                        const absMs = Math.abs(remainingMs);
                        const minutes = Math.floor(absMs / 60000);
                        const seconds = Math.floor((absMs % 60000) / 1000);
                        const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                        if (attendanceStatus.expected_duration > 0) {
                            if (!isOverdue) {
                                // Countdown mode - check if near end (20% warning threshold)
                                const warningThreshold = expectedDurationMs * 0.2;
                                const isNearEnd = remainingMs <= warningThreshold && remainingMs > 0;

                                if (isNearEnd) {
                                    // Warning: less than 20% time left
                                    timerHtml = `
                                        <div class="flex items-center gap-2 text-xs text-yellow-400 font-semibold">
                                            <span class="animate-pulse">⏰</span>
                                            <span>Time left: ${formattedTime}</span>
                                            <span class="text-gray-500">/ ${attendanceStatus.expected_duration}min</span>
                                        </div>
                                    `;
                                } else {
                                    // Normal countdown
                                    timerHtml = `
                                        <div class="flex items-center gap-2 text-xs text-green-400">
                                            <span>⏱️</span>
                                            <span>Time left: ${formattedTime}</span>
                                            <span class="text-gray-500">/ ${attendanceStatus.expected_duration}min</span>
                                        </div>
                                    `;
                                }
                            } else {
                                // Overdue - time exceeded
                                timerHtml = `
                                    <div class="flex items-center gap-2 text-xs text-red-400 font-semibold animate-pulse">
                                        <span class="text-red-600">⚠️</span>
                                        <span>OVERDUE: +${formattedTime}</span>
                                        <span class="text-gray-500">/ ${attendanceStatus.expected_duration}min</span>
                                    </div>
                                `;
                            }
                        } else {
                            // No expected duration - show elapsed time in MM:SS
                            const elapsedMinutes = Math.floor(elapsedMs / 60000);
                            const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
                            timerHtml = `<div class="text-xs text-gray-400">⏱️ ${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}</div>`;
                        }
                    } else {
                        statusHtml = `<span title="On ${breakConfig.name}" class="status-${attendanceStatus.break_type}">${breakConfig.emoji}</span>`;

                        // Calculate remaining time for other users too (countdown)
                        const expectedDurationMs = (attendanceStatus.expected_duration || 0) * 60 * 1000;
                        const elapsedMs = new Date() - lunchStartTime;
                        const remainingMs = expectedDurationMs - elapsedMs;
                        const isOverdue = remainingMs < 0;
                        const absMs = Math.abs(remainingMs);
                        const minutes = Math.floor(absMs / 60000);
                        const seconds = Math.floor((absMs % 60000) / 1000);
                        const formattedTime = `${minutes}:${seconds.toString().padStart(2, '0')}`;

                        if (attendanceStatus.expected_duration > 0) {
                            if (!isOverdue) {
                                // Show countdown for other users
                                timerHtml = `
                                    <div class="flex items-center gap-2 text-xs text-gray-400">
                                        <span>⏱️</span>
                                        <span>${formattedTime} left</span>
                                        <span class="text-gray-500">/ ${attendanceStatus.expected_duration}min</span>
                                    </div>
                                `;
                            } else {
                                // Other user is overdue - show warning
                                timerHtml = `
                                    <div class="flex items-center gap-2 text-xs text-red-400 font-semibold">
                                        <span>⚠️</span>
                                        <span>+${formattedTime} overdue</span>
                                        <span class="text-gray-500">/ ${attendanceStatus.expected_duration}min</span>
                                    </div>
                                `;
                            }
                        } else {
                            // No expected duration - show elapsed time in MM:SS
                            const elapsedMinutes = Math.floor(elapsedMs / 60000);
                            const elapsedSeconds = Math.floor((elapsedMs % 60000) / 1000);
                            const timeDisplay = `${elapsedMinutes}:${elapsedSeconds.toString().padStart(2, '0')}`;

                            if (attendanceStatus.break_reason) {
                                timerHtml = `<div class="text-xs text-gray-400" title="${attendanceStatus.break_reason}">⏱️ ${timeDisplay}</div>`;
                            } else {
                                timerHtml = `<div class="text-xs text-gray-400">⏱️ ${timeDisplay}</div>`;
                            }
                        }
                    }
                } else {
                    statusHtml = '<div class="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="Online"></div>';
                    if (user === myName) {
                        lunchButtonHtml = `<button data-action="toggle-lunch-status" class="cursor-pointer text-lg hover:scale-110 transition-transform" title="Set Status / Take a break">⏸️</button>`;
                    }
                }
            }
            const onBreakClass = (attendanceStatus && attendanceStatus.on_lunch && attendanceStatus.lunch_start_time)
                ? `user-on-break status-${attendanceStatus.break_type || 'other'}`
                : '';

            // Build presence label (Online/Idle) with data attribute for easy updates
            let presenceLabel = '';
            if (presenceStatus === 'online') {
                presenceLabel = '<span data-presence-label="true" class="text-green-400 text-[10px] font-semibold">Online</span>';
            } else if (presenceStatus === 'idle') {
                presenceLabel = '<span data-presence-label="true" class="text-yellow-400 text-[10px] font-normal">Idle</span>';
            }

            statsHTML += `
                <div class="glassmorphism p-2 rounded-lg border border-gray-600/30 hover-scale ${onBreakClass}">
                    <div class="flex items-center justify-center gap-2 text-xs ${userColor.text} font-semibold">
                        ${statusHtml}
                        <div class="flex flex-col items-center flex-grow">
                            <span class="text-center">${user}</span>
                            ${presenceLabel}
                        </div>
                        ${lunchButtonHtml}
                    </div>
                    <div class="text-xl font-bold text-white text-center">${count}</div>
                    <div class="text-center h-4" data-timer-container="${user}">${timerHtml}</div>
                </div>`;
        });

        // Set all HTML at once to prevent duplicates
        statsContainer.innerHTML = statsHTML;

    } catch (err) {
        console.error('Error fetching stats:', err);
        statsContainer.innerHTML = `<div class="col-span-full text-center text-red-400"><p>Could not load stats.</p></div>`;
    }
}

// js/main.js

async function renderOnLeaveNotes() {
    const onLeaveContainer = document.getElementById('on-leave-notes');
    if (!onLeaveContainer) return;
    onLeaveContainer.innerHTML = '';
    const today = new Date();
    const todayDateString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const startOfToday = new Date(todayDateString + 'T00:00:00');
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

    try {
        const { data: upcomingOff, error } = await _supabase.from('schedules')
            .select('username, date')
            .eq('status', 'Off')
            .gte('date', todayDateString)
            .order('date', { ascending: true });
        if (error) throw error;
        if (upcomingOff.length === 0) {
            onLeaveContainer.innerHTML = '<p class="text-xs text-center text-gray-400">No upcoming absences.</p>'; // Changed text size
            return;
        }
        const uniqueAbsences = Array.from(new Map(upcomingOff.map(leave => [`${leave.username}-${leave.date}`, leave])).values());
        uniqueAbsences.forEach(leave => {
            const userColor = ui.getUserColor(leave.username);
            const leaveDate = new Date(leave.date + 'T00:00:00');
            let dateString;
            let isToday = false;
            if (leaveDate.getTime() === startOfToday.getTime()) {
                dateString = 'Absent Today';
                isToday = true;
            } else if (leaveDate.getTime() === startOfTomorrow.getTime()) {
                dateString = 'Tomorrow';
            } else {
                dateString = leaveDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
            }
            // Use p-2 instead of p-3, and text-xs for smaller content
            onLeaveContainer.innerHTML += `
            <div class="p-2 rounded-lg transition-all text-xs ${isToday ? 'bg-amber-500/20 border-l-4 border-amber-500' : 'glassmorphism border border-gray-600/30'}">
                <p class="font-semibold ${userColor.text}">${leave.username}</p>
                <p class="text-gray-300">${dateString}</p>
            </div>`;
        });
    } catch (err) {
        console.error('Error fetching leave notes:', err);
        onLeaveContainer.innerHTML = '<p class="text-xs text-center text-red-400">Error loading absences.</p>'; // Changed text size
    }
}
export async function renderLeaderboard() {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;
    container.innerHTML = '<p class="text-sm text-center text-gray-400">Loading scores...</p>';
    try {
        const { data, error } = await _supabase.rpc('get_leaderboard', { days_limit: 7 });
        if (error) throw error;
        if (!data || data.length === 0) {
            container.innerHTML = '<p class="text-sm text-center text-gray-400">No scores recorded yet.</p>';
            return;
        }
        const medals = ['🥇', '🥈', '🥉'];
        container.innerHTML = data.map((user, index) => {
            const userColor = ui.getUserColor(user.username);
            const rank = index < 3 ? medals[index] : `#${index + 1}`;
            return `
                <div class="glassmorphism p-2 rounded-lg flex items-center justify-between text-xs hover-scale">
                    <div class="flex items-center gap-2">
                        <span class="font-bold w-6 text-center text-sm">${rank}</span>
                        <span class="${userColor.text} font-semibold">${user.username}</span>
                    </div>
                    <span class="font-bold text-gray-200 bg-black/30 border border-gray-600/50 px-2 py-0.5 rounded-md text-xs">${user.total_points} pts</span>
                </div>`;
        }).join('');
    } catch (err) {
        console.error("Failed to render leaderboard:", err);
        container.innerHTML = '<p class="text-sm text-center text-red-400">Could not load scores.</p>';
    }
}
export async function renderLeaderboardHistory() {
    const content = document.getElementById('leaderboard-history-content');
    if (!content) return;
    content.innerHTML = '<p class="text-center text-gray-400">Loading weekly winners...</p>';
    try {
        const { data, error } = await _supabase.from('leaderboard_history').select('*').order('week_start_date', { ascending: false });
        if (error) throw error;
        if (data.length === 0) {
            content.innerHTML = '<p class="text-center text-gray-400">No weekly records found yet.</p>';
            return;
        }
        content.innerHTML = data.map(record => `
            <div class="glassmorphism p-4 my-2 rounded-lg border border-gray-700/50">
                <p class="font-bold text-lg text-amber-300">Week of ${new Date(record.week_start_date + 'T00:00:00').toLocaleDateString()}</p>
                <p class="mt-1">🏆 Winner: <span class="font-semibold text-white">${record.winner_username}</span> with ${record.winner_score} pts</p>
            </div>`).join('');
    } catch (err) {
        console.error("Failed to render leaderboard history:", err);
        content.innerHTML = '<p class="text-center text-red-400">Could not load history.</p>';
    }
}
export async function renderDashboard() {
    ui.showLoading();
    const selectedUser = document.getElementById('dashboard-user-filter').value;
    const periodSelect = document.getElementById('stats-period');
    let daysToFilter = parseInt(periodSelect.value);
    if (periodSelect.value === 'custom') {
        daysToFilter = parseInt(document.getElementById('custom-days-input').value) || 0;
    }

    // Check if period filter or user filter has changed
    const currentPeriodFilter = periodSelect.value;
    const periodOrUserChanged =
        appState.cache.lastDashboardPeriod !== currentPeriodFilter ||
        appState.cache.lastDashboardUser !== selectedUser;

    // Check cache
    const now = Date.now();
    const cacheAge = appState.cache.lastDashboardFetch ? now - appState.cache.lastDashboardFetch : Infinity;

    let data;

    // Use cache only if: fresh data + no filter changes + has cached data
    if (cacheAge < appState.cache.CACHE_TTL && appState.cache.dashboard && !periodOrUserChanged) {
        console.log('[Dashboard] Using cached data (age:', Math.round(cacheAge / 1000), 'seconds)');
        data = appState.cache.dashboard;
    } else {
        // Fetch fresh data
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - (daysToFilter - 1));

        try {
            // ⚡ OPTIMIZATION: Only fetch In Progress and Done tickets (not deleted/archived)
            const { data: fetchedData, error } = await _supabase
                .from('tickets')
                .select('*')
                .in('status', ['In Progress', 'Done'])
                .gte('updated_at', startDate.toISOString());

            if (error) throw error;

            data = fetchedData;

            // Update cache
            appState.cache.dashboard = data;
            appState.cache.lastDashboardFetch = Date.now();
            appState.cache.lastDashboardPeriod = currentPeriodFilter;
            appState.cache.lastDashboardUser = selectedUser;
        } catch (err) {
            console.error('Error fetching dashboard data:', err);
            ui.hideLoading();
            return;
        }
    }

    try {

        const totalTicketsContainer = document.getElementById('total-tickets-container');
        if (totalTicketsContainer) {
            totalTicketsContainer.innerHTML = `
                <h3 class="text-lg font-semibold text-gray-300 mb-2">Total Tickets</h3>
                <p class="text-5xl font-bold text-white">${data.length}</p>
                <p class="text-sm text-gray-400 mt-1">in selected period</p>
            `;
        }

        const userTickets = selectedUser === 'all' ? data : data.filter(t => (t.handled_by || []).includes(selectedUser));
        const doneTickets = userTickets.filter(t => t.status === 'Done' && t.completed_at);

        const resolutionContainer = document.getElementById('avg-resolution-time-container');
        resolutionContainer.innerHTML = `<h3 class="text-lg font-semibold text-gray-300 mb-4">Avg. Resolution Time</h3>`;
        const priorityStats = {};

        doneTickets.forEach(t => {
            const priority = t.priority || 'Medium';
            if (!priorityStats[priority]) {
                priorityStats[priority] = { totalMs: 0, count: 0 };
            }
            priorityStats[priority].totalMs += new Date(t.completed_at) - new Date(t.created_at);
            priorityStats[priority].count++;
        });

        const priorityOrder = ['Urgent', 'High', 'Medium', 'Low'];
        let hasResolutionData = false;
        priorityOrder.forEach(priority => {
            if (priorityStats[priority] && priorityStats[priority].count > 0) {
                hasResolutionData = true;
                const stats = priorityStats[priority];
                const avgMs = stats.totalMs / stats.count;
                const hours = Math.floor(avgMs / 3600000);
                const minutes = Math.round((avgMs % 3600000) / 60000);
                const priorityStyle = tickets.PRIORITY_STYLES[priority];

                resolutionContainer.innerHTML += `
                    <div class="flex items-center justify-between p-2 rounded-lg ${priorityStyle.bg} mb-2">
                        <span class="font-semibold ${priorityStyle.text}">${priority}</span>
                        <span class="font-bold text-lg ${priorityStyle.text}">${hours}h ${minutes}m</span>
                    </div>
                `;
            }
        });

        if (!hasResolutionData) {
            resolutionContainer.innerHTML += `<p class="text-sm text-gray-400 mt-4">No completed tickets with this filter.</p>`;
        }

        const sourceCounts = userTickets.reduce((acc, t) => { acc[t.source] = (acc[t.source] || 0) + 1; return acc; }, {});
        const priorityCounts = userTickets.reduce((acc, t) => { const p = t.priority || 'Medium'; acc[p] = (acc[p] || 0) + 1; return acc; }, {});
        const priorityLabels = Object.keys(priorityCounts);
        const priorityColorMap = { 'Low': '#22c55e', 'Medium': '#f59e0b', 'High': '#ef4444', 'Urgent': '#b91c1c' };
        const priorityBackgroundColors = priorityLabels.map(label => priorityColorMap[label] || '#6b7280');
        const ticketsPerDay = {};
        userTickets.forEach(t => { const day = new Date(t.created_at).toISOString().split('T')[0]; ticketsPerDay[day] = (ticketsPerDay[day] || 0) + 1; });
        const sortedDays = Object.keys(ticketsPerDay).sort();
        const titleSuffix = selectedUser === 'all' ? `(All Members)` : `(${selectedUser})`;
        ui.renderChart('tickets-by-source-container', 'sourceChart', 'pie', { labels: Object.keys(sourceCounts), datasets: [{ data: Object.values(sourceCounts), backgroundColor: ['#3b82f6', '#8b5cf6'] }] }, `Tickets by Source ${titleSuffix}`);
        ui.renderChart('tickets-by-priority-container', 'priorityChart', 'doughnut', { labels: priorityLabels, datasets: [{ data: priorityLabels.map(l => priorityCounts[l]), backgroundColor: priorityBackgroundColors }] }, `Tickets by Priority ${titleSuffix}`);
        ui.renderChart('tickets-per-day-container', 'dailyChart', 'bar', { labels: sortedDays, datasets: [{ label: 'Tickets Created', data: sortedDays.map(day => ticketsPerDay[day]), backgroundColor: '#4f46e5' }] }, `Daily Volume ${titleSuffix}`);
    } catch (err) {
        console.error("Dashboard fetch error:", err);
        ui.showNotification('Dashboard Error', 'Failed to load dashboard data', 'error');
    } finally {
        ui.hideLoading();
    }
}
export async function renderPerformanceAnalytics() {
    const content = document.getElementById('performance-content');
    const header = document.getElementById('performance-header');
    if (!content || !header) return;
    const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];

    header.textContent = `My Performance (${myName})`;
    content.innerHTML = '<div class="loading-spinner w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full mx-auto"></div>';

    try {
        const { data, error } = await _supabase.rpc('get_user_performance_stats', {
            user_name_param: myName,
            days_limit: 7
        });
        if (error) throw error;

        const myAvgTime = ui.formatSeconds(data.user_stats.avg_resolution_seconds);
        const teamAvgTime = ui.formatSeconds(data.team_stats.avg_resolution_seconds);
        const tagAnalysisHTML = data.tag_analysis.length > 0
            ? data.tag_analysis.map(tag => `<div class="bg-gray-600/50 text-gray-300 text-sm font-semibold px-3 py-1 rounded-full border border-gray-500 flex justify-between"><span>#${tag.tag}</span><span>${tag.count}</span></div>`).join('')
            : '<p class="text-gray-400 text-center">No tags handled in this period.</p>';

        content.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 text-center">
                <div class="glassmorphism p-4 rounded-lg"><h4 class="text-lg font-semibold text-gray-300 mb-2">Weekly Score 🏆</h4><p class="text-5xl font-bold text-white">${data.user_stats.total_points}</p><p class="text-sm text-gray-400 mt-1">pts</p></div>
                <div class="glassmorphism p-4 rounded-lg"><h4 class="text-lg font-semibold text-gray-300 mb-2">Tickets Closed</h4><p class="text-5xl font-bold text-white">${data.user_stats.tickets_closed}</p><p class="text-sm text-gray-400 mt-1">Last 7 Days</p></div>
                <div class="glassmorphism p-4 rounded-lg"><h4 class="text-lg font-semibold text-gray-300 mb-2">Avg. Resolution Time</h4><p class="text-5xl font-bold text-white">${myAvgTime}</p><p class="text-sm text-gray-400 mt-1">Team Average: ${teamAvgTime}</p></div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="glassmorphism p-4 rounded-lg"><h4 class="text-lg font-semibold text-gray-300 mb-4 text-center">My Top Tags (7 Days)</h4><div class="space-y-2">${tagAnalysisHTML}</div></div>
                <div id="priority-chart-container" class="glassmorphism p-4 rounded-lg h-64"></div>
            </div>`;

        const priorityLabels = Object.keys(data.priority_analysis);
        if (priorityLabels.length > 0) {
            const priorityColorMap = { 'Low': '#22c55e', 'Medium': '#f59e0b', 'High': '#ef4444', 'Urgent': '#b91c1c' };
            const priorityBackgroundColors = priorityLabels.map(label => priorityColorMap[label] || '#6b7280');
            ui.renderChart('priority-chart-container', 'myPriorityChart', 'doughnut', {
                labels: priorityLabels,
                datasets: [{ data: Object.values(data.priority_analysis), backgroundColor: priorityBackgroundColors }]
            }, `My Tickets by Priority`);
        } else {
            document.getElementById('priority-chart-container').innerHTML = '<p class="text-gray-400 text-center mt-8">No ticket data for chart.</p>';
        }
    } catch (err) {
        console.error("Failed to render performance analytics:", err);
        content.innerHTML = '<p class="text-center text-red-400">Could not load performance data.</p>';
    }
}
async function checkAndDisableUIForVisitor() {
    try {
        const { data, error } = await _supabase.from('user_roles').select('role').eq('user_id', appState.currentUser.id).single();
        if (error && error.code !== 'PGRST116') throw error;
        if (data) {
            appState.currentUserRole = data.role;
            if (data.role === 'visitor_admin') {
                document.getElementById('tickets-footer').style.display = 'none';
                document.getElementById('shift-btn').style.display = 'none';
                const addDeploymentBtn = document.getElementById('add-deployment-btn');
                if (addDeploymentBtn) addDeploymentBtn.parentElement.style.display = 'none';
                document.body.classList.add('visitor-mode');
            }
            if (data.role === 'admin' || data.role === 'visitor_admin') {
                document.getElementById('open-admin-panel-btn').classList.remove('hidden');
                const exportBtn = document.getElementById('export-btn');
                if (exportBtn) {
                    exportBtn.classList.remove('hidden');
                }
            }
        }
    } catch (err) {
        console.error("Error checking user role:", err);
    }
}

function populateAllUserDropdowns() {
    const assignSelect = document.getElementById("assign-to");
    const filterSelect = document.getElementById("filter-user");
    const dashboardFilterSelect = document.getElementById("dashboard-user-filter");
    if (!assignSelect || !filterSelect || !dashboardFilterSelect) return;

    assignSelect.innerHTML = '<option value="">Assign to (optional)</option>';
    filterSelect.innerHTML = '<option value="">All Users</option>';
    dashboardFilterSelect.innerHTML = '<option value="all">All Team Members</option>';
    const sortedUsers = Array.from(appState.allUsers.keys()).sort();
    const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
    sortedUsers.forEach(name => {
        if (name !== myName) {
            assignSelect.innerHTML += `<option value="${name}">${name}</option>`;
        }
        filterSelect.innerHTML += `<option value="${name}">${name}</option>`;
        dashboardFilterSelect.innerHTML += `<option value="${name}">${name}</option>`;
    });
}


// --- EVENT LISTENERS ---
let loginListenersInitialized = false;
let appListenersInitialized = false;

function setupLoginEventListeners() {
    if (loginListenersInitialized) return;

    document.getElementById('signin-btn').addEventListener('click', signIn);
    document.getElementById('signup-btn').addEventListener('click', signUp);
    document.getElementById('email-input').addEventListener('keypress', e => {
        if (e.key === 'Enter') document.getElementById('password-input').focus();
    });
    document.getElementById('password-input').addEventListener('keypress', e => {
        if (e.key === 'Enter') signIn();
    });

    loginListenersInitialized = true;
}

function setupAppEventListeners() {
    if (appListenersInitialized) return;

    const searchInput = document.getElementById('search-input');
    const statsPeriod = document.getElementById('stats-period');
    const ticketSubject = document.getElementById('ticket-subject');
    const customDaysInput = document.getElementById('custom-days-input');
    const dashboardUserFilter = document.getElementById('dashboard-user-filter');
    const attachmentInput = document.getElementById('ticket-attachment');
    const filterUser = document.getElementById('filter-user');
    const filterSource = document.getElementById('filter-source');
    const filterPriority = document.getElementById('filter-priority');
    const openHistoryBtn = document.getElementById('open-history-btn');
    const closePerformanceBtn = document.getElementById('close-performance-modal-btn');

    if (!searchInput || !statsPeriod || !ticketSubject || !customDaysInput || !dashboardUserFilter || !attachmentInput || !filterUser || !openHistoryBtn || !closePerformanceBtn) {
        setTimeout(setupAppEventListeners, 100);
        return;
    }

    openHistoryBtn.addEventListener('click', ui.openHistoryModal);
    closePerformanceBtn.addEventListener('click', ui.closePerformanceModal);


    // Filter Listeners - use debounced version to prevent duplicate calls when changing multiple filters
    searchInput.addEventListener('input', debouncedApplyFilters);
    filterUser.addEventListener('change', debouncedApplyFilters);
    filterSource.addEventListener('change', debouncedApplyFilters);
    filterPriority.addEventListener('change', debouncedApplyFilters);
    document.getElementById('filter-tag').addEventListener('change', debouncedApplyFilters);

    statsPeriod.addEventListener('change', ui.toggleCustomDaysInput);
    customDaysInput.addEventListener('change', debouncedApplyFilters);
    dashboardUserFilter.addEventListener('change', renderDashboard);

    document.querySelectorAll('.source-btn').forEach(btn => btn.addEventListener('click', () => {
        appState.selectedSource = btn.textContent.trim();
        document.querySelectorAll('.source-btn').forEach(b => b.dataset.selected = (b.textContent.trim() === appState.selectedSource));
    }));

    // Removed Ctrl+Enter shortcut for creating tickets

    attachmentInput.addEventListener('change', () => {
        const fileLabel = document.getElementById('ticket-attachment-filename'); // Corrected ID
        if (attachmentInput.files.length > 0) {
            fileLabel.textContent = attachmentInput.files[0].name;
        } else {
            fileLabel.textContent = 'Attach File';
        }
    });

    document.addEventListener('click', function (event) {
        const activityLog = document.getElementById('activity-log');
        const activityBtn = document.getElementById('activity-btn');
        if (activityLog && activityBtn && !activityLog.classList.contains('hidden') && !activityLog.contains(event.target) && !activityBtn.contains(event.target)) {
            activityLog.classList.add('hidden');
        }
    });

    document.body.addEventListener('click', (event) => {
        const target = event.target.closest('[data-action]');
        if (!target) return;

        const action = target.dataset.action;

        switch (action) {
            case 'open-performance-modal':
                ui.openPerformanceModal();
                break;
            case 'toggle-lunch-status':
                ui.openStatusModal();
                break;
            case 'toggle-shift':
                schedule.toggleShift();
                break;
        }
    });

    // Escape key to close modals
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            ui.closeAllModals();
        }
    });

    const starredTab = document.getElementById('tab-starred');
    if (starredTab) {
        starredTab.addEventListener('click', async () => {
            ui.openPinnedTicketsView();
        });
    }

    appListenersInitialized = true;
}

export function handleTicketToggle(ticketId) {
    ui.toggleTicketCollapse(ticketId);
    const ticket = document.getElementById(`ticket-${ticketId}`);
    const body = ticket?.querySelector('.ticket-body');
    
    // Track which ticket is expanded
    if (body && !body.classList.contains('hidden')) {
        appState.expandedTicketId = ticketId;
    } else {
        appState.expandedTicketId = null;
    }
}

// js/main.js

// Batch pending real-time updates to avoid cascading re-renders
const pendingUpdates = {
    stats: false,
    leaderboard: false,
    followUps: false,
    mentions: false,
    reactions: false,
    scheduleItems: false,
    onLeaveNotes: false
};

// Flush batched updates after 300ms of inactivity
const flushBatchedUpdates = debounce(async () => {
    const updates = [];

    // Render stats if flagged
    if (pendingUpdates.stats) {
        updates.push(renderStats());
        pendingUpdates.stats = false;
    }

    // Render leaderboard if flagged
    if (pendingUpdates.leaderboard) {
        updates.push(renderLeaderboard());
        pendingUpdates.leaderboard = false;
    }

    // Check follow-ups if flagged
    if (pendingUpdates.followUps) {
        updates.push(ui.checkForUnreadFollowUps());
        pendingUpdates.followUps = false;
    }

    // Fetch mentions if flagged
    if (pendingUpdates.mentions) {
        updates.push(window.tickets.fetchMentionNotifications());
        pendingUpdates.mentions = false;
    }

    // Fetch reactions if flagged
    if (pendingUpdates.reactions) {
        updates.push(window.tickets.fetchReactionNotifications());
        pendingUpdates.reactions = false;
    }

    // Fetch schedule items if flagged
    if (pendingUpdates.scheduleItems) {
        updates.push(schedule.fetchScheduleItems());
        pendingUpdates.scheduleItems = false;
    }

    // Render on-leave notes if flagged
    if (pendingUpdates.onLeaveNotes) {
        updates.push(renderOnLeaveNotes());
        pendingUpdates.onLeaveNotes = false;
    }

    // Execute all pending updates in parallel
    if (updates.length > 0) {
        await Promise.all(updates);
    }
}, 300);

/**
 * Update only the presence label for a specific user (no full refresh)
 * This prevents the entire stats section from blinking
 */
function updateUserPresenceLabel(username, status) {
    // Find the user's card in the DOM
    const statsContainer = document.getElementById('stats-container');
    if (!statsContainer) return;

    // Find the specific user card by searching for username
    const userCards = statsContainer.querySelectorAll('.glassmorphism');
    let userCard = null;

    for (const card of userCards) {
        const usernameSpan = card.querySelector('.flex-grow .text-center');
        if (usernameSpan && usernameSpan.textContent.trim() === username) {
            userCard = card;
            break;
        }
    }

    if (!userCard) return;

    // Find or create the presence label container
    const usernameContainer = userCard.querySelector('.flex-grow');
    if (!usernameContainer) return;

    // Remove existing presence label if any
    const existingLabel = usernameContainer.querySelector('[data-presence-label]');
    if (existingLabel) {
        existingLabel.remove();
    }

    // Add new presence label if status is online or idle
    if (status === 'online') {
        const label = document.createElement('span');
        label.setAttribute('data-presence-label', 'true');
        label.className = 'text-green-400 text-[10px] font-semibold';
        label.textContent = 'Online';
        usernameContainer.appendChild(label);
    } else if (status === 'idle') {
        const label = document.createElement('span');
        label.setAttribute('data-presence-label', 'true');
        label.className = 'text-yellow-400 text-[10px] font-normal';
        label.textContent = 'Idle';
        usernameContainer.appendChild(label);
    }
    // If status is null/offline, label is already removed
}

function setupSubscriptions() {
    // ⚡ OPTIMIZATION: Use filtered subscriptions to reduce egress by ~30%
    // Only listen for changes on recent tickets (last 60 days)
    const sixtyDaysAgo = new Date();
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const filterDate = sixtyDaysAgo.toISOString();

    const ticketChannel = _supabase.channel('public:tickets');

 ticketChannel
        // ⚡ OPTIMIZATION: Filter INSERT to only recent tickets
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'tickets',
            filter: `updated_at=gte.${filterDate}`
        }, async (payload) => {
            const newTicket = payload.new;
            const shouldBeVisible = (appState.currentView === 'tickets' && newTicket.status === 'In Progress') ||
                (appState.currentView === 'done' && newTicket.status === 'Done') ||
                (appState.currentView === 'follow-up' && newTicket.needs_followup);

            if (shouldBeVisible) {
                await tickets.prependTicketToView(newTicket);
            }
        })
        // ⚡ OPTIMIZATION: Filter UPDATE to only recent tickets
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'tickets',
            filter: `updated_at=gte.${filterDate}`
        }, async (payload) => {
            const newTicket = payload.new;
            const ticketElement = document.getElementById(`ticket-${newTicket.id}`);

            const shouldBeVisible = (appState.currentView === 'tickets' && newTicket.status === 'In Progress') ||
                (appState.currentView === 'done' && newTicket.status === 'Done') ||
                (appState.currentView === 'follow-up' && newTicket.needs_followup);

            if (ticketElement && !shouldBeVisible) {
                // Ticket should no longer be visible - remove it
                ticketElement.remove();
            } else if (!ticketElement && shouldBeVisible) {
                // Ticket should be visible but isn't - add it
                await tickets.prependTicketToView(newTicket);
            } else if (ticketElement && shouldBeVisible) {
                // Ticket is visible and should stay visible - update it in place
                await tickets.refreshTicketRelationships(newTicket.id);
                await tickets.updateTicketInPlace(newTicket);
            }

            // Only batch leaderboard/stats updates (not full ticket refresh)
            // The ticket was already updated in place above
            pendingUpdates.leaderboard = true;
            pendingUpdates.stats = true;
            pendingUpdates.followUps = true;
            flushBatchedUpdates();
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tickets' }, async (payload) => {
            const ticketElement = document.getElementById(`ticket-${payload.old.id}`);
            if (ticketElement) ticketElement.remove();

            // Batch these updates
            pendingUpdates.leaderboard = true;
            pendingUpdates.stats = true;
            flushBatchedUpdates();
        });


    const channels = [
        ticketChannel,
        _supabase.channel('public:note_reactions').on('postgres_changes', { event: '*', schema: 'public', table: 'note_reactions' }, async (payload) => {
            // For DELETE events, use payload.old; for INSERT/UPDATE, use payload.new
            const reactionData = payload.eventType === 'DELETE' ? payload.old : payload.new;
            const ticketId = reactionData?.ticket_id;
            const noteIndex = reactionData?.note_index;

            if (ticketId !== undefined && noteIndex !== undefined && noteIndex !== null) {
                // We have specific ticket and note info - render just that note
                await tickets.renderNoteReactions(ticketId, noteIndex);
            } else if (payload.eventType === 'DELETE') {
                // DELETE event without old data - refresh all visible expanded tickets
                const expandedTickets = document.querySelectorAll('.ticket-body:not(.hidden)');
                expandedTickets.forEach(async (ticketBody) => {
                    const ticketElement = ticketBody.closest('[id^="ticket-"]');
                    if (ticketElement) {
                        const ticketIdMatch = ticketElement.id.match(/ticket-(\d+)/);
                        if (ticketIdMatch) {
                            const tId = parseInt(ticketIdMatch[1]);
                            const ticketData = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === tId);
                            if (ticketData && ticketData.notes) {
                                ticketData.notes.forEach((note, idx) => {
                                    tickets.renderNoteReactions(tId, idx);
                                });
                            }
                        }
                    }
                });
            }
        }),

                _supabase.channel('public:ticket_presence')
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'ticket_presence'
            }, async (payload) => {
                const ticketId = payload.new?.ticket_id || payload.old?.ticket_id;
                if (ticketId) {
                    // Update presence indicators for this ticket
                    await tickets.displayActiveViewers(ticketId);
                }
            }),

        _supabase.channel('public:user_points').on('postgres_changes', { event: '*', schema: 'public', table: 'user_points' }, async (payload) => {
            pendingUpdates.leaderboard = true;
            flushBatchedUpdates();
        }),
        _supabase.channel('public:schedules').on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => {
            schedule.checkScheduleUpdate();
            pendingUpdates.onLeaveNotes = true;
            schedule.renderScheduleAdjustments();
            flushBatchedUpdates();
        }),
        _supabase.channel('public:default_schedules').on('postgres_changes', { event: '*', schema: 'public', table: 'default_schedules' }, () => {
            schedule.checkScheduleUpdate();
            pendingUpdates.onLeaveNotes = true;
            schedule.renderScheduleAdjustments();
            flushBatchedUpdates();
        }),
        _supabase.channel('public:attendance').on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, async () => {
            await schedule.fetchAttendance();
            pendingUpdates.stats = true;
            flushBatchedUpdates();
        }),
        _supabase.channel('public:broadcast_messages').on('postgres_changes', { event: '*', schema: 'public', table: 'broadcast_messages' }, ui.fetchBroadcastMessage),
        _supabase.channel('public:deployment_notes').on('postgres_changes', { event: '*', schema: 'public', table: 'deployment_notes' }, () => {
            pendingUpdates.scheduleItems = true;
            flushBatchedUpdates();
        }),
        _supabase.channel('public:activity_log').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_log' }, ui.handleActivityLogUpdate),
        _supabase.channel('public:pings').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pings' }, (payload) => {
            const pingData = payload.new;
            if (pingData.target_user_id === appState.currentUser.id) {
                ui.playSoundAlert();
                alert(`Message from Admin:\n\n${pingData.message}`);
            }
        }),

        // Listen for new mention notifications in real-time
        _supabase.channel('public:mention_notifications').on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'mention_notifications'
        }, async (payload) => {
            const notification = payload.new;
            // Only show if it's for the current user
            if (notification.mentioned_user_id === appState.currentUser.id) {
                // Play notification sound immediately (don't batch this)
                ui.playSoundAlert();
                // Batch the notification fetch
                pendingUpdates.mentions = true;
                flushBatchedUpdates();
            }
        }),

        // Listen for new milestone notifications in real-time
        _supabase.channel('public:milestone_notifications').on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'milestone_notifications'
        }, async (payload) => {
            // All users see milestone notifications - no sound, just display
            const notification = payload.new;
            window.tickets.displaySingleMilestoneNotification(notification);
        }),

        // Listen for new reaction notifications in real-time
        _supabase.channel('public:reaction_notifications').on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'reaction_notifications'
        }, async (payload) => {
            const notification = payload.new;
            // Only show if it's for the current user (note author)
            if (notification.note_author_id === appState.currentUser.id) {
                // Batch the notification fetch
                pendingUpdates.reactions = true;
                flushBatchedUpdates();
            }
        }),

        // Listen for typing indicators in real-time
        _supabase.channel('public:typing_indicators').on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'typing_indicators'
        }, async (payload) => {
            // Refresh typing indicators when anyone types or stops typing
            await window.tickets.fetchTypingIndicators('new_ticket');
        }),

        // Listen for status notifications
        _supabase.channel('public:status_notifications').on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'status_notifications'
        }, async (payload) => {
            const notification = payload.new;
            // Only show if it's for other users (not the current user who triggered it)
            if (notification.user_id !== appState.currentUser.id) {
                ui.displayStatusNotification(notification);
                ui.playSoundAlert(); // Optional sound alert
            }
        }),

        // Subscribe to user presence changes
        _supabase.channel('public:user_presence').on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'user_presence'
        }, async (payload) => {
            console.log('[Presence] Change detected:', payload);
            // Update local presence state
            if (payload.new && payload.new.username) {
                appState.userPresence.set(payload.new.username, payload.new.status);
                // Update only the presence label for this user (no full refresh)
                updateUserPresenceLabel(payload.new.username, payload.new.status);
            } else if (payload.old && payload.old.username) {
                appState.userPresence.delete(payload.old.username);
                // Remove presence label
                updateUserPresenceLabel(payload.old.username, null);
            }
        })
    ];

    channels.forEach(channel => channel.subscribe());
    window.supabaseSubscriptions = channels;
}


// --- APP ENTRY POINT ---
document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    setupLoginEventListeners();

    window.main = { applyFilters, renderDashboard, renderStats, renderPerformanceAnalytics, renderLeaderboardHistory, awardPoints, logActivity};
    window.tickets = tickets;
    window.schedule = schedule;
    window.admin = admin;
    window.ui = ui;
    window.auth = { signOut, setNewPassword };
});

// Cleanup intervals when page is hidden/closed (memory leak prevention)
window.addEventListener('pagehide', () => {
    if (window.statsUpdateInterval) {
        clearInterval(window.statsUpdateInterval);
        window.statsUpdateInterval = null;
    }
});
