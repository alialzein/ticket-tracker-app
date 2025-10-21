// js/main.js

import { _supabase } from './config.js';
import { appState } from './state.js';
import { initAuth, signIn, signUp, signOut, setNewPassword } from './auth.js';
import * as tickets from './tickets.js';
import * as schedule from './schedule.js';
import * as admin from './admin.js';
import * as ui from './ui.js';

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
    schedule.startShiftReminders();

    await Promise.all([
        fetchUsers(),
        schedule.fetchAttendance(),
        schedule.fetchScheduleItems(),
        schedule.renderScheduleAdjustments(),
        ui.fetchBroadcastMessage(),
        ui.checkForUnreadActivities(),
        ui.checkForUnreadFollowUps(),
        schedule.checkScheduleUpdate(),
        window.tickets.fetchMentionNotifications()
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
        const targetUsername = target ? target.username : (appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0]);

        const { error } = await _supabase.functions.invoke('smart-task', {
            body: { eventType, userId: targetUserId, username: targetUsername, data },
        });
        if (error) throw error;
    } catch (err) {
        console.error(`Failed to award points for ${eventType}:`, err);
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

// --- RENDERING FUNCTIONS for main layout ---

async function renderStats() {
    const statsContainer = document.getElementById('stats-container');
    const periodSelect = document.getElementById('stats-period');

    if (!statsContainer || !periodSelect) {
        return;
    }

    schedule.clearLunchTimer();
    statsContainer.innerHTML = '<div class="loading-spinner w-8 h-8 mx-auto"></div>';

    let daysToFilter = parseInt(periodSelect.value);
    if (periodSelect.value === 'custom') {
        daysToFilter = parseInt(document.getElementById('custom-days-input').value) || 0;
    }

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - (daysToFilter - 1));

    try {
        let query = _supabase.from('tickets').select('handled_by, username, assigned_to_name').gte('updated_at', startDate.toISOString());
        if (appState.currentView === 'tickets') {
            query = query.eq('status', 'In Progress');
        } else if (appState.currentView === 'done') {
            query = query.eq('status', 'Done');
        }
        const { data: allTicketsForStats, error } = await query;
        if (error) throw error;

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

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];

        Array.from(appState.allUsers.keys()).sort().forEach(user => {
            const count = userStats[user] || 0;
            const attendanceStatus = appState.attendance.get(user);
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
                    statusHtml = '<span title="On a break">🍔</span>';
                    if (user === myName) {
                        statusHtml = `<button data-action="toggle-lunch-status" class="cursor-pointer glowing-pulse-red rounded-full" title="Back from break">🍔</button>`;
                        const lunchStartTime = new Date(attendanceStatus.lunch_start_time);
                        const now = new Date();
                        const diffSeconds = Math.floor((now - lunchStartTime) / 1000);
                        const totalMinutes = Math.floor(diffSeconds / 60);

                        if (totalMinutes < 30) {
                            schedule.startLunchTimer(lunchStartTime, user);
                            timerHtml = `<div id="lunch-timer-${user.replace(/\./g, '-')}" class="lunch-timer">30:00</div>`;
                        } else {
                            timerHtml = `<div class="flex items-center justify-center gap-1 text-xs text-red-400 font-semibold"><span class="lunch-warning">⚠️</span><span>${totalMinutes}m</span></div>`;
                        }
                    } else {
                        const lunchStartTime = new Date(attendanceStatus.lunch_start_time);
                        const now = new Date();
                        const totalMinutes = Math.floor((now - lunchStartTime) / (1000 * 60));
                        timerHtml = `<div class="text-xs text-red-400 font-semibold">(On break: ${totalMinutes}m)</div>`;
                    }
                } else {
                    statusHtml = '<div class="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="Online"></div>';
                    if (user === myName) {
                        lunchButtonHtml = `<button data-action="toggle-lunch-status" class="cursor-pointer" title="Take a break">☕</button>`;
                    }
                }
            }
            statsContainer.innerHTML += `
                <div class="glassmorphism p-2 rounded-lg border border-gray-600/30 hover-scale">
                    <div class="flex items-center justify-center gap-2 text-xs ${userColor.text} font-semibold">
                        ${statusHtml}
                        <span class="flex-grow text-center">${user}</span>
                        ${lunchButtonHtml}
                    </div>
                    <div class="text-xl font-bold text-white text-center">${count}</div>
                    <div class="text-center h-4">${timerHtml}</div>
                </div>`;
        });

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

    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
    startDate.setDate(startDate.getDate() - (daysToFilter - 1));

    try {
        const { data, error } = await _supabase
            .from('tickets')
            .select('*')
            .gte('created_at', startDate.toISOString());

        if (error) throw error;

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
function setupLoginEventListeners() {
    document.getElementById('signin-btn').addEventListener('click', signIn);
    document.getElementById('signup-btn').addEventListener('click', signUp);
    document.getElementById('email-input').addEventListener('keypress', e => {
        if (e.key === 'Enter') document.getElementById('password-input').focus();
    });
    document.getElementById('password-input').addEventListener('keypress', e => {
        if (e.key === 'Enter') signIn();
    });
}

function setupAppEventListeners() {
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


    // Filter Listeners
    searchInput.addEventListener('input', debouncedApplyFilters);
    filterUser.addEventListener('change', applyFilters);
    filterSource.addEventListener('change', applyFilters);
    filterPriority.addEventListener('change', applyFilters);
    document.getElementById('filter-tag').addEventListener('change', applyFilters); // Added listener for tag filter

    statsPeriod.addEventListener('change', ui.toggleCustomDaysInput);
    customDaysInput.addEventListener('change', applyFilters);
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
                schedule.toggleLunchStatus();
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
}

export function handleTicketToggle(ticketId) {
    ui.toggleTicketCollapse(ticketId);
    const ticket = document.getElementById(`ticket-${ticketId}`);
    const body = ticket?.querySelector('.ticket-body');
    
    // Track which ticket is expanded
    if (body && !body.classList.contains('hidden')) {
        appState.expandedTicketId = ticketId;
        console.log('Ticket expanded:', ticketId);
    } else {
        appState.expandedTicketId = null;
        console.log('Ticket collapsed:', ticketId);
    }
}

// js/main.js

function setupSubscriptions() {
    const ticketChannel = _supabase.channel('public:tickets');

 ticketChannel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'tickets' }, async (payload) => {
            const newTicket = payload.new;
            const shouldBeVisible = (appState.currentView === 'tickets' && newTicket.status === 'In Progress') ||
                (appState.currentView === 'done' && newTicket.status === 'Done') ||
                (appState.currentView === 'follow-up' && newTicket.needs_followup);

            if (shouldBeVisible) {
                await tickets.prependTicketToView(newTicket);
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'tickets' }, async (payload) => {
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
                // ⭐ THIS IS THE KEY CHANGE - refresh relationships on UPDATE
                await tickets.refreshTicketRelationships(newTicket.id);
                await tickets.updateTicketInPlace(newTicket);
            }

            await renderLeaderboard();
            await renderStats();
            await ui.checkForUnreadFollowUps();
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'tickets' }, async (payload) => {
            const ticketElement = document.getElementById(`ticket-${payload.old.id}`);
            if (ticketElement) ticketElement.remove();
            await renderLeaderboard();
            await renderStats();
        });


    const channels = [
        ticketChannel,
        _supabase.channel('public:kudos').on('postgres_changes', { event: '*', schema: 'public', table: 'kudos' }, async (payload) => {
            if (payload.eventType === 'INSERT' || payload.eventType === 'DELETE') {
                const ticketId = payload.new?.ticket_id || payload.old?.ticket_id;
                const noteIndex = payload.new?.note_index || payload.old?.note_index;
                if (ticketId !== undefined && noteIndex !== undefined) {
                    tickets.updateKudosCount(ticketId, noteIndex);
                }
            }
            await renderLeaderboard();
        }),

                _supabase.channel('public:ticket_presence')
            .on('postgres_changes', { 
                event: '*', 
                schema: 'public', 
                table: 'ticket_presence' 
            }, async (payload) => {
                console.log('Presence update:', payload);
                const ticketId = payload.new?.ticket_id || payload.old?.ticket_id;
                if (ticketId) {
                    // Update presence indicators for this ticket
                    await tickets.displayActiveViewers(ticketId);
                }
            }),
            
        _supabase.channel('public:user_points').on('postgres_changes', { event: '*', schema: 'public', table: 'user_points' }, renderLeaderboard),
        _supabase.channel('public:schedules').on('postgres_changes', { event: '*', schema: 'public', table: 'schedules' }, () => { schedule.checkScheduleUpdate(); renderOnLeaveNotes(); schedule.renderScheduleAdjustments(); }),
        _supabase.channel('public:default_schedules').on('postgres_changes', { event: '*', schema: 'public', table: 'default_schedules' }, () => { schedule.checkScheduleUpdate(); renderOnLeaveNotes(); schedule.renderScheduleAdjustments(); }),
        _supabase.channel('public:attendance').on('postgres_changes', { event: '*', schema: 'public', table: 'attendance' }, async () => { await schedule.fetchAttendance(); await renderStats(); }),
        _supabase.channel('public:broadcast_messages').on('postgres_changes', { event: '*', schema: 'public', table: 'broadcast_messages' }, ui.fetchBroadcastMessage),
        _supabase.channel('public:deployment_notes').on('postgres_changes', { event: '*', schema: 'public', table: 'deployment_notes' }, schedule.fetchScheduleItems),
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
                // Display the notification
                await window.tickets.fetchMentionNotifications();
                // Play notification sound
                ui.playSoundAlert();
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
