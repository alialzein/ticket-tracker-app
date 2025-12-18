// Admin Panel Functions
// This file contains all the admin functions migrated from the old admin modal

import { _supabase } from '../../js/config.js';
import { showNotification } from './admin-main.js';

// Global state for admin panel
const adminPanelState = {
    userList: [],
    userEmailMap: new Map()
};

/**
 * Initialize admin functions
 */
export async function initAdminFunctions() {
    console.log('[AdminPanel] Initializing admin functions...');

    // Load user list
    await loadUserList();

    // Populate user dropdowns
    populateUserDropdowns();
}

/**
 * Load user list from database
 */
async function loadUserList() {
    try {
        // Get users from user_settings and auth.users (via join or separate queries)
        const { data: settings, error: settingsError } = await _supabase
            .from('user_settings')
            .select('user_id, system_username, display_name')
            .order('system_username');

        if (settingsError) throw settingsError;

        // For each user, try to get their email from auth metadata or construct it
        adminPanelState.userList = [];

        for (const setting of settings || []) {
            const username = setting.system_username || setting.display_name || 'Unknown';

            // Try to get user email from auth.users table
            // Since we can't access admin API, we'll construct email or get it from metadata
            let email = `${username}@b-pal.net`; // Default email pattern

            // Try to get the actual user to get their email
            try {
                const { data: { user }, error: userError } = await _supabase.auth.getUser();
                if (!userError && user && user.id === setting.user_id) {
                    email = user.email;
                }
            } catch {
                // If we can't get individual user, use the constructed email
            }

            adminPanelState.userList.push({
                user_id: setting.user_id,
                username: username,
                email: email
            });
        }

        // Build email map
        adminPanelState.userEmailMap.clear();
        adminPanelState.userList.forEach(user => {
            adminPanelState.userEmailMap.set(user.username, user.email);
        });

        console.log('[AdminPanel] Loaded', adminPanelState.userList.length, 'users');
    } catch (err) {
        console.error('[AdminPanel] Error loading user list:', err);
        adminPanelState.userList = [];
    }
}

/**
 * Populate all user dropdowns
 */
function populateUserDropdowns() {
    const dropdownIds = [
        'admin-reset-user-select',
        'admin-ping-user-select',
        'admin-report-user-select',
        'admin-log-user-select',
        'admin-history-user-select'
    ];

    dropdownIds.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;

        // Clear existing options (except first)
        select.innerHTML = '<option value="">Select User</option>';

        // Add users
        adminPanelState.userList.forEach(user => {
            const option = document.createElement('option');
            option.value = user.username;
            option.textContent = user.username;
            select.appendChild(option);
        });
    });
}

// ============================================
// USER MANAGEMENT FUNCTIONS
// ============================================

/**
 * Send password reset email
 */
export async function sendPasswordReset() {
    const userSelect = document.getElementById('admin-reset-user-select');
    const username = userSelect.value;

    if (!username) {
        return showNotification('Error', 'Please select a user.', 'error');
    }

    const email = adminPanelState.userEmailMap.get(username);
    if (!email) {
        return showNotification('Error', `Could not find an email for user ${username}.`, 'error');
    }

    const confirmed = confirm(`Are you sure you want to send a password reset link to ${username} (${email})?`);
    if (!confirmed) return;

    try {
        const { error } = await _supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin,
        });

        if (error) throw error;

        showNotification('Success', `Password reset email sent to ${username}.`, 'success');

        // Log action
        await logAdminAction('user_password_reset', null, username, { email });

    } catch (err) {
        showNotification('Error', err.message, 'error');
    }
}

/**
 * Ping a user (send real-time notification)
 */
export async function pingUser() {
    const userSelect = document.getElementById('admin-ping-user-select');
    const messageInput = document.getElementById('admin-ping-message');

    const username = userSelect.value;
    const message = messageInput.value.trim();

    if (!username) {
        return showNotification('Error', 'Please select a user.', 'error');
    }

    if (!message) {
        return showNotification('Error', 'Please enter a message.', 'error');
    }

    try {
        // Get user ID
        const user = adminPanelState.userList.find(u => u.username === username);
        if (!user) throw new Error('User not found');

        // Insert ping notification
        const { error } = await _supabase
            .from('user_pings')
            .insert({
                user_id: user.user_id,
                username: username,
                message: message,
                sent_at: new Date().toISOString()
            });

        if (error) throw error;

        showNotification('Success', `Ping sent to ${username}!`, 'success');

        // Clear input
        messageInput.value = '';

        // Log action
        await logAdminAction('user_pinged', user.user_id, username, { message });

    } catch (err) {
        showNotification('Error', err.message, 'error');
    }
}

// ============================================
// TICKET MANAGEMENT FUNCTIONS
// ============================================

/**
 * Search tickets by subject
 */
export async function searchTickets() {
    const searchInput = document.getElementById('admin-search-subject-input');
    const resultsContainer = document.getElementById('admin-ticket-search-results');

    const searchTerm = searchInput.value.trim();

    if (searchTerm.length < 3) {
        return showNotification('Search Too Short', 'Please enter at least 3 characters to search.', 'error');
    }

    resultsContainer.innerHTML = '<div class="text-center text-gray-400 py-4">Searching...</div>';

    try {
        const { data: tickets, error } = await _supabase
            .from('tickets')
            .select('id, subject, username')
            .ilike('subject', `%${searchTerm}%`)
            .limit(10);

        if (error) throw error;

        if (tickets.length === 0) {
            resultsContainer.innerHTML = '<div class="text-center text-gray-400 py-4">No tickets found.</div>';
            return;
        }

        resultsContainer.innerHTML = '';
        tickets.forEach(ticket => {
            const resultEl = document.createElement('div');
            resultEl.id = `search-result-${ticket.id}`;
            resultEl.className = 'bg-gray-700/50 p-3 rounded-lg flex justify-between items-center';
            resultEl.innerHTML = `
                <div>
                    <p class="font-semibold text-white">#${ticket.id} - ${ticket.subject}</p>
                    <p class="text-xs text-gray-400">Created by ${ticket.username}</p>
                </div>
                <button onclick="adminPanel.deleteTicket(${ticket.id})" class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-lg text-xs transition-colors">
                    Delete
                </button>
            `;
            resultsContainer.appendChild(resultEl);
        });
    } catch (err) {
        resultsContainer.innerHTML = '<div class="text-center text-red-400 py-4">Error during search.</div>';
        showNotification('Search Error', err.message, 'error');
    }
}

/**
 * Delete a ticket by ID
 */
export async function deleteTicket(ticketId) {
    if (!ticketId) {
        return showNotification('Error', 'Invalid Ticket ID provided.', 'error');
    }

    const confirmed = confirm(`Are you sure you want to permanently delete ticket #${ticketId}?`);
    if (!confirmed) return;

    try {
        const { error } = await _supabase
            .from('tickets')
            .delete()
            .eq('id', ticketId);

        if (error) throw error;

        showNotification('Success', `Ticket #${ticketId} has been deleted.`, 'success');

        // Remove from UI
        const resultElement = document.getElementById(`search-result-${ticketId}`);
        if (resultElement) {
            resultElement.remove();
        }

        // Log action
        await logAdminAction('ticket_deleted', null, null, { ticket_id: ticketId });

    } catch (err) {
        showNotification('Error Deleting Ticket', err.message, 'error');
    }
}

// ============================================
// ANALYTICS & REPORTS FUNCTIONS
// ============================================

/**
 * Generate attendance report
 */
export async function generateAttendanceReport() {
    const userSelect = document.getElementById('admin-report-user-select');
    const startDateInput = document.getElementById('admin-report-start-date');
    const endDateInput = document.getElementById('admin-report-end-date');
    const resultsContainer = document.getElementById('admin-attendance-report-results');

    const username = userSelect.value;
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (!username || !startDate || !endDate) {
        return showNotification('Missing Fields', 'Please select user and date range.', 'error');
    }

    resultsContainer.innerHTML = '<div class="text-center text-gray-400 py-4">Generating report...</div>';

    try {
        const user = adminPanelState.userList.find(u => u.username === username);
        if (!user) throw new Error('User not found');

        const { data: attendance, error } = await _supabase
            .from('attendance')
            .select('*')
            .eq('username', username)
            .gte('shift_start', startDate)
            .lte('shift_start', endDate + 'T23:59:59')
            .order('shift_start', { ascending: false });

        if (error) throw error;

        if (attendance.length === 0) {
            resultsContainer.innerHTML = '<div class="text-center text-gray-400 py-4">No attendance records found.</div>';
            return;
        }

        // Build report HTML
        let html = '<div class="space-y-2">';
        attendance.forEach(record => {
            const shiftStart = record.shift_start ? new Date(record.shift_start) : null;
            const shiftEnd = record.shift_end ? new Date(record.shift_end) : null;
            const date = shiftStart ? shiftStart.toLocaleDateString() : '-';
            const clockIn = shiftStart ? shiftStart.toLocaleTimeString() : '-';
            const clockOut = shiftEnd ? shiftEnd.toLocaleTimeString() : '-';

            html += `
                <div class="bg-gray-700/50 p-3 rounded-lg">
                    <div class="flex justify-between items-center">
                        <div>
                            <p class="text-white font-semibold">${date}</p>
                            <p class="text-xs text-gray-400">In: ${clockIn} | Out: ${clockOut}</p>
                            ${record.device_type ? `<p class="text-xs text-gray-500">Device: ${record.device_type}</p>` : ''}
                        </div>
                        <div class="text-right">
                            <p class="text-sm text-gray-300">Break: ${record.total_break_time_minutes || 0} min</p>
                            ${record.is_blocked ? '<span class="text-xs text-red-400">Blocked</span>' : ''}
                            ${record.on_lunch ? '<span class="text-xs text-yellow-400">On Break</span>' : ''}
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        resultsContainer.innerHTML = html;

    } catch (err) {
        resultsContainer.innerHTML = '<div class="text-center text-red-400 py-4">Error generating report.</div>';
        showNotification('Report Error', err.message, 'error');
    }
}

/**
 * Generate user activity log
 */
export async function generateUserActivityReport() {
    const userSelect = document.getElementById('admin-log-user-select');
    const startDateInput = document.getElementById('admin-log-start-date');
    const endDateInput = document.getElementById('admin-log-end-date');
    const resultsContainer = document.getElementById('admin-user-log-results');

    const username = userSelect.value;
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (!username || !startDate || !endDate) {
        return showNotification('Missing Fields', 'Please select user and date range.', 'error');
    }

    resultsContainer.innerHTML = '<div class="text-center text-gray-400 py-4">Generating log...</div>';

    try {
        const user = adminPanelState.userList.find(u => u.username === username);
        if (!user) throw new Error('User not found');

        const { data: points, error } = await _supabase
            .from('user_points')
            .select('*')
            .eq('username', username)
            .gte('created_at', startDate + 'T00:00:00')
            .lte('created_at', endDate + 'T23:59:59')
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (points.length === 0) {
            resultsContainer.innerHTML = '<div class="text-center text-gray-400 py-4">No activity found.</div>';
            return;
        }

        // Build log HTML
        let html = '<div class="space-y-2">';
        points.forEach(record => {
            const date = new Date(record.created_at).toLocaleString();
            const pointsColor = record.points_awarded >= 0 ? 'text-green-400' : 'text-red-400';

            html += `
                <div class="bg-gray-700/50 p-2 rounded text-xs">
                    <div class="flex justify-between">
                        <span class="text-gray-400">${date}</span>
                        <span class="${pointsColor} font-semibold">${record.points_awarded > 0 ? '+' : ''}${record.points_awarded}</span>
                    </div>
                    <p class="text-white mt-1">${record.event_type || 'No reason'}</p>
                </div>
            `;
        });
        html += '</div>';

        resultsContainer.innerHTML = html;

    } catch (err) {
        resultsContainer.innerHTML = '<div class="text-center text-red-400 py-4">Error generating log.</div>';
        showNotification('Log Error', err.message, 'error');
    }
}

/**
 * Export user activity to Excel (CSV)
 */
export async function exportUserActivityReport() {
    const userSelect = document.getElementById('admin-log-user-select');
    const startDateInput = document.getElementById('admin-log-start-date');
    const endDateInput = document.getElementById('admin-log-end-date');

    const username = userSelect.value;
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (!username || !startDate || !endDate) {
        return showNotification('Missing Fields', 'Please select user and date range.', 'error');
    }

    try {
        const user = adminPanelState.userList.find(u => u.username === username);
        if (!user) throw new Error('User not found');

        const { data: points, error } = await _supabase
            .from('user_points')
            .select('*')
            .eq('username', username)
            .gte('created_at', startDate + 'T00:00:00')
            .lte('created_at', endDate + 'T23:59:59')
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (points.length === 0) {
            return showNotification('No Data', 'No activity to export.', 'error');
        }

        // Create CSV
        let csv = 'Date,Points,Event Type\n';
        points.forEach(record => {
            const date = new Date(record.created_at).toLocaleString();
            const eventType = (record.event_type || '').replace(/,/g, ';');
            csv += `"${date}",${record.points_awarded},"${eventType}"\n`;
        });

        // Download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `user_activity_${username}_${startDate}_${endDate}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        showNotification('Export Successful', 'Activity log exported!', 'success');

    } catch (err) {
        showNotification('Export Error', err.message, 'error');
    }
}

/**
 * Generate weekly history report
 */
export async function generateWeeklyHistoryReport() {
    const userSelect = document.getElementById('admin-history-user-select');
    const startDateInput = document.getElementById('admin-history-start-date');
    const endDateInput = document.getElementById('admin-history-end-date');
    const resultsContainer = document.getElementById('admin-weekly-history-results');

    const username = userSelect.value;
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (!username || !startDate || !endDate) {
        return showNotification('Missing Fields', 'Please select user and date range.', 'error');
    }

    resultsContainer.innerHTML = '<div class="text-center text-gray-400 py-4">Generating report...</div>';

    try {
        const user = adminPanelState.userList.find(u => u.username === username);
        if (!user) throw new Error('User not found');

        const { data: weeklyScores, error } = await _supabase
            .from('weekly_leaderboard')
            .select('*')
            .eq('username', username)
            .gte('week_start_date', startDate)
            .lte('week_start_date', endDate)
            .order('week_start_date', { ascending: false });

        if (error) throw error;

        if (weeklyScores.length === 0) {
            resultsContainer.innerHTML = '<div class="text-center text-gray-400 py-4">No weekly scores found.</div>';
            return;
        }

        // Build report HTML
        let html = '<div class="space-y-2">';
        weeklyScores.forEach(record => {
            const weekDate = new Date(record.week_start_date).toLocaleDateString();

            html += `
                <div class="bg-gray-700/50 p-3 rounded-lg flex justify-between items-center">
                    <div>
                        <p class="text-white font-semibold">Week of ${weekDate}</p>
                        <p class="text-xs text-gray-400">Total Score: ${record.total_score}</p>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        resultsContainer.innerHTML = html;

    } catch (err) {
        resultsContainer.innerHTML = '<div class="text-center text-red-400 py-4">Error generating report.</div>';
        showNotification('Report Error', err.message, 'error');
    }
}

/**
 * Export weekly history to Excel (CSV)
 */
export async function exportWeeklyHistoryReport() {
    const userSelect = document.getElementById('admin-history-user-select');
    const startDateInput = document.getElementById('admin-history-start-date');
    const endDateInput = document.getElementById('admin-history-end-date');

    const username = userSelect.value;
    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (!username || !startDate || !endDate) {
        return showNotification('Missing Fields', 'Please select user and date range.', 'error');
    }

    try {
        const user = adminPanelState.userList.find(u => u.username === username);
        if (!user) throw new Error('User not found');

        const { data: weeklyScores, error} = await _supabase
            .from('weekly_leaderboard')
            .select('*')
            .eq('username', username)
            .gte('week_start_date', startDate)
            .lte('week_start_date', endDate)
            .order('week_start_date', { ascending: false});

        if (error) throw error;

        if (weeklyScores.length === 0) {
            return showNotification('No Data', 'No weekly scores to export.', 'error');
        }

        // Create CSV
        let csv = 'Week Start Date,Total Score\n';
        weeklyScores.forEach(record => {
            const weekDate = new Date(record.week_start_date).toLocaleDateString();
            csv += `"${weekDate}",${record.total_score}\n`;
        });

        // Download
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `weekly_scores_${username}_${startDate}_${endDate}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        showNotification('Export Successful', 'Weekly scores exported!', 'success');

    } catch (err) {
        showNotification('Export Error', err.message, 'error');
    }
}

/**
 * Analyze KPIs - Calculate team performance metrics and fair KPI recommendations (matching original system)
 */
export async function analyzeKPI() {
    const startDateInput = document.getElementById('admin-kpi-start-date');
    const endDateInput = document.getElementById('admin-kpi-end-date');
    const resultsContainer = document.getElementById('admin-kpi-results');

    const startDate = startDateInput.value;
    const endDate = endDateInput.value;

    if (!startDate || !endDate) {
        return showNotification('Missing Fields', 'Please select both start and end dates.', 'error');
    }

    resultsContainer.innerHTML = '<p class="text-indigo-400 text-sm py-4">Analyzing data...</p>';

    try {
        // Fetch weekly scores for the period
        const { data: weeklyScores, error } = await _supabase
            .from('weekly_leaderboard')
            .select('*')
            .gte('week_start_date', startDate)
            .lte('week_start_date', endDate)
            .order('week_start_date', { ascending: true });

        if (error) throw error;

        if (!weeklyScores || weeklyScores.length === 0) {
            resultsContainer.innerHTML = '<p class="text-yellow-400 text-sm py-4">No data found for the selected period.</p>';
            return;
        }

        // Group by user and week
        const userWeeklyData = {};

        weeklyScores.forEach(record => {
            if (!userWeeklyData[record.username]) {
                userWeeklyData[record.username] = {
                    username: record.username,
                    weeks: [],
                    totalPoints: 0
                };
            }
            userWeeklyData[record.username].weeks.push({
                weekStart: record.week_start_date,
                points: record.total_score
            });
            userWeeklyData[record.username].totalPoints += record.total_score;
        });

        // Calculate statistics for each user
        const userStats = Object.keys(userWeeklyData).map(username => {
            const userData = userWeeklyData[username];
            const weeklyPoints = userData.weeks.map(w => w.points);

            return {
                username: userData.username,
                weekCount: weeklyPoints.length,
                totalPoints: userData.totalPoints,
                averageWeekly: userData.totalPoints / weeklyPoints.length,
                medianWeekly: calculateMedian(weeklyPoints),
                minWeekly: Math.min(...weeklyPoints),
                maxWeekly: Math.max(...weeklyPoints),
                stdDev: calculateStdDev(weeklyPoints),
                weeklyData: userData.weeks
            };
        });

        // Sort by average weekly score
        userStats.sort((a, b) => b.averageWeekly - a.averageWeekly);

        // Calculate team-wide statistics
        const allWeeklyAverages = userStats.map(u => u.averageWeekly);
        const teamMedian = calculateMedian(allWeeklyAverages);
        const teamAverage = allWeeklyAverages.reduce((sum, val) => sum + val, 0) / allWeeklyAverages.length;
        const teamStdDev = calculateStdDev(allWeeklyAverages);

        // Generate KPI recommendations for each user
        const kpiRecommendations = userStats.map(user => generateKPIRecommendation(user, teamAverage));

        // Display results
        displayKPIAnalysis({
            userStats,
            kpiRecommendations,
            teamStats: {
                median: teamMedian,
                average: teamAverage,
                stdDev: teamStdDev,
                totalUsers: userStats.length
            },
            startDate,
            endDate
        }, resultsContainer);

        // Store for export
        window.kpiAnalysisData = {
            kpiRecommendations,
            teamStats: { median: teamMedian, average: teamAverage, stdDev: teamStdDev, totalUsers: userStats.length },
            startDate,
            endDate
        };

    } catch (error) {
        console.error('Error generating KPI analysis:', error);
        resultsContainer.innerHTML = `<p class="text-red-400 text-sm py-4">Error: ${error.message}</p>`;
    }
}

/**
 * Generate fair KPI recommendation for a user (Tier-based bonus system)
 */
function generateKPIRecommendation(user, teamAverage) {
    const { averageWeekly } = user;
    let tier, targetKPI, reasoning, bonusPercentage;
    const percentOfTeamAvg = (averageWeekly / teamAverage) * 100;

    if (percentOfTeamAvg < 70) {
        tier = 'Needs Support';
        bonusPercentage = 25;
        targetKPI = Math.round(averageWeekly * 1.25);
        reasoning = `Currently at ${Math.round(percentOfTeamAvg)}% of team average. KPI = Current + 25% bonus support (${targetKPI}).`;
    } else if (percentOfTeamAvg < 90) {
        tier = 'Developing';
        bonusPercentage = 15;
        targetKPI = Math.round(averageWeekly * 1.15);
        reasoning = `Currently at ${Math.round(percentOfTeamAvg)}% of team average. KPI = Current + 15% bonus support (${targetKPI}).`;
    } else if (percentOfTeamAvg < 110) {
        tier = 'Proficient';
        bonusPercentage = 0;
        targetKPI = Math.round(averageWeekly);
        reasoning = `Currently at team average level. KPI = Current level maintained (${targetKPI}).`;
    } else if (percentOfTeamAvg < 125) {
        tier = 'Advanced';
        bonusPercentage = 0;
        targetKPI = Math.round(averageWeekly);
        reasoning = `Above team average. KPI = Current level maintained (${targetKPI}).`;
    } else {
        tier = 'Expert';
        bonusPercentage = 0;
        targetKPI = Math.round(averageWeekly);
        reasoning = `Top performer at ${Math.round(percentOfTeamAvg)}% of team average. KPI = Current level maintained (${targetKPI}).`;
    }

    const kpiOutOf5 = Math.min(5, Math.max(1, Math.round((targetKPI / teamAverage) * 3)));

    return {
        ...user,
        tier,
        targetKPI,
        bonusPercentage,
        reasoning,
        percentOfTeamAvg: Math.round(percentOfTeamAvg),
        currentVsTarget: targetKPI - Math.round(averageWeekly),
        kpiOutOf5
    };
}

/**
 * Display the KPI analysis results (matching original layout exactly)
 */
function displayKPIAnalysis(analysis, container) {
    const { kpiRecommendations, teamStats, startDate, endDate } = analysis;

    const html = `
        <div class="space-y-4">
            <!-- Team Overview -->
            <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <h5 class="text-sm font-bold text-indigo-300 mb-3">Team Performance Overview (${startDate} to ${endDate})</h5>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                    <div class="bg-gray-900/50 p-2 rounded border-l-2 border-indigo-500">
                        <p class="text-gray-400">Team Average (Weekly)</p>
                        <p class="text-lg font-bold text-indigo-400">${Math.round(teamStats.average)}</p>
                        <p class="text-[10px] text-gray-500 mt-1">Baseline for all KPIs</p>
                    </div>
                    <div class="bg-gray-900/50 p-2 rounded">
                        <p class="text-gray-400">Team Median</p>
                        <p class="text-lg font-bold text-white">${Math.round(teamStats.median)}</p>
                        <p class="text-[10px] ${Math.abs(teamStats.average - teamStats.median) < 5 ? 'text-green-400' : 'text-yellow-400'} mt-1">
                            ${Math.abs(teamStats.average - teamStats.median) < 5 ? '✓ Close to average' : '⚠ Gap detected'}
                        </p>
                    </div>
                    <div class="bg-gray-900/50 p-2 rounded">
                        <p class="text-gray-400">Standard Deviation</p>
                        <p class="text-lg font-bold text-yellow-400">${Math.round(teamStats.stdDev)}</p>
                        <p class="text-[10px] ${teamStats.stdDev < 15 ? 'text-green-400' : 'text-yellow-400'} mt-1">
                            ${teamStats.stdDev < 15 ? '✓ Consistent' : '~ Moderate variation'}
                        </p>
                    </div>
                </div>

                <!-- Statistics Explanation -->
                <div class="mt-3 p-2 bg-indigo-900/10 rounded border border-indigo-600/20">
                    <p class="text-[11px] text-gray-400">
                        <span class="font-semibold text-indigo-300">📊 What do these mean?</span><br/>
                        <span class="text-indigo-400">• Team Average:</span> Sum of all weekly scores ÷ number of users. This is the baseline everyone is compared to.<br/>
                        <span class="text-indigo-400">• Team Median:</span> The middle score when sorted. Less affected by outliers.<br/>
                        <span class="text-indigo-400">• Standard Deviation:</span> Shows how spread out scores are. Higher = more variation.
                    </p>
                </div>
            </div>

            <!-- Individual KPI Recommendations -->
            <div class="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                <h5 class="text-sm font-bold text-indigo-300 mb-3">Individual KPI Recommendations</h5>
                <div>
                    <table class="w-full text-xs">
                        <thead class="bg-gray-900/50">
                            <tr>
                                <th class="text-left p-2 text-gray-400">User</th>
                                <th class="text-center p-2 text-gray-400">Tier</th>
                                <th class="text-center p-2 text-gray-400">Current Avg</th>
                                <th class="text-center p-2 text-gray-400">% of Team Avg</th>
                                <th class="text-center p-2 text-gray-400">Bonus %</th>
                                <th class="text-center p-2 text-gray-400">Total Score</th>
                                <th class="text-center p-2 text-gray-400">Current KPI<br/><span class="text-[10px] font-normal">(out of 5)</span></th>
                                <th class="text-left p-2 text-gray-400">Reasoning</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-700/50">
                            ${kpiRecommendations.map(rec => `
                                <tr class="hover:bg-gray-700/30">
                                    <td class="p-2 font-medium text-white">${rec.username}</td>
                                    <td class="p-2 text-center">
                                        <span class="px-2 py-1 rounded text-[10px] font-semibold ${getTierColor(rec.tier)}">
                                            ${rec.tier}
                                        </span>
                                    </td>
                                    <td class="p-2 text-center text-gray-300">${Math.round(rec.averageWeekly)}</td>
                                    <td class="p-2 text-center">
                                        <span class="font-semibold ${rec.percentOfTeamAvg < 90 ? 'text-orange-400' : rec.percentOfTeamAvg > 110 ? 'text-green-400' : 'text-gray-300'}">${rec.percentOfTeamAvg}%</span>
                                    </td>
                                    <td class="p-2 text-center">
                                        <span class="${rec.bonusPercentage > 0 ? 'text-yellow-400 font-bold text-sm' : 'text-gray-500'}">${rec.bonusPercentage > 0 ? '+' + rec.bonusPercentage + '%' : '0%'}</span>
                                    </td>
                                    <td class="p-2 text-center">
                                        <span class="text-indigo-400 font-bold text-sm">${rec.targetKPI}</span>
                                        <span class="text-gray-500 text-[10px] block">(${rec.currentVsTarget > 0 ? '+' : ''}${rec.currentVsTarget} pts)</span>
                                    </td>
                                    <td class="p-2 text-center">
                                        <span class="text-lg font-bold ${rec.kpiOutOf5 >= 4 ? 'text-green-400' : rec.kpiOutOf5 >= 3 ? 'text-blue-400' : rec.kpiOutOf5 >= 2 ? 'text-yellow-400' : 'text-orange-400'}">${rec.kpiOutOf5}/5</span>
                                    </td>
                                    <td class="p-2 text-gray-400 text-[10px]">${rec.reasoning}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Fairness Explanation -->
            <div class="bg-indigo-900/20 border border-indigo-600/30 rounded-lg p-3">
                <h6 class="text-xs font-bold text-indigo-300 mb-2">📋 KPI Setting Methodology (Bonus-Only System)</h6>
                <div class="text-[11px] text-gray-400 space-y-1">
                    <p><span class="text-red-400 font-semibold">Needs Support (&lt;70% of team avg):</span> Current + 25% bonus. Extra support to help catch up.</p>
                    <p><span class="text-orange-400 font-semibold">Developing (70-90% of team avg):</span> Current + 15% bonus. Moderate support to reach team level.</p>
                    <p><span class="text-yellow-400 font-semibold">Proficient (90-110% of team avg):</span> Current level maintained. No bonus needed.</p>
                    <p><span class="text-green-400 font-semibold">Advanced (110-125% of team avg):</span> Current level maintained. Already performing well.</p>
                    <p><span class="text-blue-400 font-semibold">Expert (≥125% of team avg):</span> Current level maintained. Already excellent.</p>
                </div>
                <div class="mt-3 p-2 bg-yellow-900/20 rounded border border-yellow-600/30">
                    <p class="text-[10px] text-yellow-300">
                        <span class="font-semibold">💡 Why bonuses only for lower performers?</span><br/>
                        This system focuses on <span class="font-semibold">helping those who need it most</span>. Lower performers get bonus percentages to make their targets achievable, while average and above-average performers maintain their current level. This creates a fairer system that supports growth where needed.
                    </p>
                </div>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

/**
 * Get color class for tier badge
 */
function getTierColor(tier) {
    switch(tier) {
        case 'Needs Support': return 'bg-red-500/20 text-red-400 border border-red-500/40';
        case 'Developing': return 'bg-orange-500/20 text-orange-400 border border-orange-500/40';
        case 'Proficient': return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40';
        case 'Advanced': return 'bg-green-500/20 text-green-400 border border-green-500/40';
        case 'Expert': return 'bg-blue-500/20 text-blue-400 border border-blue-500/40';
        default: return 'bg-gray-500/20 text-gray-400 border border-gray-500/40';
    }
}

// Utility functions for statistics
function calculateMedian(arr) {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function calculateStdDev(arr) {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;
    const squaredDiffs = arr.map(val => Math.pow(val - mean, 2));
    const avgSquaredDiff = squaredDiffs.reduce((sum, val) => sum + val, 0) / arr.length;
    return Math.sqrt(avgSquaredDiff);
}

/**
 * Export KPI report to CSV
 */
export async function exportKPIReport() {
    if (!window.kpiAnalysisData) {
        return showNotification('No Data', 'Please run the KPI analysis first.', 'error');
    }

    try {
        const { kpiRecommendations, teamStats, startDate, endDate } = window.kpiAnalysisData;

        // Prepare data for export
        const exportData = [];

        // Add summary rows
        exportData.push(['KPI ANALYSIS REPORT']);
        exportData.push(['Period', `${startDate} to ${endDate}`]);
        exportData.push([]);
        exportData.push(['TEAM STATISTICS']);
        exportData.push(['Team Average', Math.round(teamStats.average)]);
        exportData.push(['Team Median', Math.round(teamStats.median)]);
        exportData.push(['Total Users', teamStats.totalUsers]);
        exportData.push([]);
        exportData.push(['INDIVIDUAL KPI RECOMMENDATIONS']);
        exportData.push(['User', 'Performance Tier', 'Current Weekly Avg', '% of Team Avg', 'Bonus %', 'Total Score', 'Current KPI (out of 5)', 'Points to Grow', 'Reasoning']);

        // Add user data
        kpiRecommendations.forEach(rec => {
            exportData.push([
                rec.username,
                rec.tier,
                Math.round(rec.averageWeekly),
                `${rec.percentOfTeamAvg}%`,
                rec.bonusPercentage > 0 ? `+${rec.bonusPercentage}%` : '0%',
                rec.targetKPI,
                `${rec.kpiOutOf5}/5`,
                rec.currentVsTarget,
                rec.reasoning
            ]);
        });

        // Convert to CSV
        const csv = exportData.map(row => row.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `KPI_Analysis_${startDate}_to_${endDate}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        showNotification('Export Successful', 'KPI analysis exported to CSV!', 'success');

    } catch (err) {
        showNotification('Export Error', err.message, 'error');
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Log admin action to audit log
 */
async function logAdminAction(action, targetUserId = null, targetUsername = null, details = {}) {
    try {
        const { data: { user } } = await _supabase.auth.getUser();

        const adminUsername = user.user_metadata?.['display name'] ||
                            user.email?.split('@')[0] ||
                            'Admin';

        await _supabase
            .from('admin_audit_log')
            .insert({
                admin_user_id: user.id,
                admin_username: adminUsername,
                action: action,
                target_user_id: targetUserId,
                target_username: targetUsername,
                details: details
            });

    } catch (err) {
        console.error('[AdminPanel] Error logging admin action:', err);
    }
}

// Export all functions as adminPanel namespace
export const adminPanel = {
    initAdminFunctions,
    sendPasswordReset,
    pingUser,
    searchTickets,
    deleteTicket,
    generateAttendanceReport,
    generateUserActivityReport,
    exportUserActivityReport,
    generateWeeklyHistoryReport,
    exportWeeklyHistoryReport,
    analyzeKPI,
    exportKPIReport
};

// Make available globally for onclick handlers
window.adminPanel = adminPanel;
