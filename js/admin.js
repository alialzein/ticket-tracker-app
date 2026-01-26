import { log, logError, logWarn } from './logger.js';
// js/admin.js

import { _supabase } from './config.js';
import { appState } from './state.js';
import { showNotification, openConfirmModal, showLoading, hideLoading } from './ui.js';
import { logActivity } from './main.js';

// --- TICKET MANAGEMENT ---

export async function searchTickets_Admin() {
    const searchTerm = document.getElementById('admin-search-subject-input').value.trim();
    const resultsContainer = document.getElementById('admin-ticket-search-results');

    if (searchTerm.length < 3) {
        return showNotification('Search Too Short', 'Please enter at least 3 characters to search.', 'error');
    }
    resultsContainer.innerHTML = '<div class="text-center text-gray-400">Searching...</div>';

    try {
        const { data: tickets, error } = await _supabase
            .from('tickets')
            .select('id, subject, username')
            .ilike('subject', `%${searchTerm}%`)
            .limit(10);

        if (error) throw error;
        if (tickets.length === 0) {
            resultsContainer.innerHTML = '<div class="text-center text-gray-400">No tickets found.</div>';
            return;
        }

        resultsContainer.innerHTML = '';
        tickets.forEach(ticket => {
            const resultEl = document.createElement('div');
            resultEl.id = `search-result-${ticket.id}`;
            resultEl.className = 'bg-gray-800 p-3 rounded-lg flex justify-between items-center';
            resultEl.innerHTML = `
                <div>
                    <p class="font-semibold text-white">#${ticket.id} - ${ticket.subject}</p>
                    <p class="text-xs text-gray-400">Created by ${ticket.username}</p>
                </div>
                <button onclick="admin.deleteTicketById_Admin(${ticket.id})" class="bg-red-700 hover:bg-red-800 text-white font-semibold py-1 px-3 rounded-lg text-xs">Delete</button>
            `;
            resultsContainer.appendChild(resultEl);
        });
    } catch (err) {
        resultsContainer.innerHTML = '<div class="text-center text-red-400">Error during search.</div>';
        showNotification('Search Error', err.message, 'error');
    }
}

export function deleteTicketById_Admin(ticketId) {
    if (!ticketId) {
        return showNotification('Error', 'Invalid Ticket ID provided.', 'error');
    }
    openConfirmModal('Delete Ticket', `Are you sure you want to permanently delete ticket #${ticketId}?`, async () => {
        try {
            const { error } = await _supabase.from('tickets').delete().eq('id', ticketId);
            if (error) throw error;

            logActivity('TICKET_DELETED', { ticket_id: ticketId });
            showNotification('Success', `Ticket #${ticketId} has been deleted.`, 'success');

            const resultElement = document.getElementById(`search-result-${ticketId}`);
            if (resultElement) {
                resultElement.remove();
            }
        } catch (error) {
            showNotification('Error Deleting Ticket', error.message, 'error');
        }
    });
}

// --- USER MANAGEMENT ---

export function sendPasswordReset_Admin() {
    const userSelect = document.getElementById('admin-reset-user-select');
    const username = userSelect.value;
    if (!username) {
        return showNotification('Error', 'Please select a user.', 'error');
    }
    const email = appState.userEmailMap.get(username);
    if (!email) {
        return showNotification('Error', `Could not find an email for user ${username}.`, 'error');
    }
    openConfirmModal('Reset Password', `Are you sure you want to send a password reset link to ${username} (${email})?`, async () => {
        const { error } = await _supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin,
        });
        if (error) {
            showNotification('Error', error.message, 'error');
        } else {
            showNotification('Success', `Password reset email sent to ${username}.`, 'success');
        }
    });
}

export async function pingUser_Admin() {
    const userSelect = document.getElementById('admin-ping-user-select');
    const messageInput = document.getElementById('admin-ping-message');
    const username = userSelect.value;
    const message = messageInput.value.trim();

    if (!username || !message) {
        return showNotification('Error', 'Please select a user and enter a message.', 'error');
    }
    const userId = appState.allUsers.get(username);
    if (!userId) {
        return showNotification('Error', `Could not find ID for user ${username}.`, 'error');
    }

    try {
        const { error } = await _supabase.from('pings').insert({
            target_user_id: userId,
            message: message
        });
        if (error) throw error;
        showNotification('Success', `Ping sent to ${username}.`, 'success');
        messageInput.value = '';
    } catch (err) {
        showNotification('Error', 'Could not send ping. ' + err.message, 'error');
    }
}

// In admin.js

export async function exportTicketsToCSV() {
    showLoading();
    showNotification('Exporting View', 'Preparing your data based on current filters...', 'info');

    try {
        const isDoneView = appState.currentView === 'done';
        const isFollowUpView = appState.currentView === 'follow-up';
        const searchTerm = document.getElementById('search-input').value.trim();
        
        let query;

        // Base query based on the current view
        if (isFollowUpView) {
            query = _supabase.from('tickets').select('*').eq('needs_followup', true);
        } else {
            const statusToFetch = isDoneView ? 'Done' : 'In Progress';
            query = _supabase.from('tickets').select('*').eq('status', statusToFetch);
        }

        // Apply all the same filters as the main view
        if (searchTerm) query = query.ilike('subject', `%${searchTerm}%`);
        
        const userFilter = document.getElementById('filter-user').value;
        if (userFilter) query = query.or(`username.eq.${userFilter},assigned_to_name.eq.${userFilter}`);
        
        const sourceFilter = document.getElementById('filter-source').value;
        if (sourceFilter) query = query.eq('source', sourceFilter);
        
        const priorityFilter = document.getElementById('filter-priority').value;
        if (priorityFilter) query = query.eq('priority', priorityFilter);
        
        const tagFilter = document.getElementById('filter-tag').value;
        if (tagFilter) query = query.contains('tags', `["${tagFilter}"]`);

        // Fetch all matching records without pagination
        const { data, error } = await query.order('updated_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            hideLoading();
            return showNotification('No Data', 'No tickets match the current filters to export.', 'info');
        }
        
        const filename = `TicketExport-${appState.currentView}-${new Date().toISOString().split('T')[0]}`;
        exportToCSV(data, filename);

    } catch (err) {
        showNotification('Export Failed', err.message, 'error');
    } finally {
        hideLoading();
    }
}

// --- REPORTING & EXPORTS ---

// Helper function for CSV conversion
function exportToCSV(data, filename) {
    if (!data || data.length === 0) {
        return showNotification('No Data', 'There is no data to export for the selected criteria.', 'info');
    }
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];
    for (const row of data) {
        const values = headers.map(header => {
            let field = row[header];
            if (field === null || field === undefined) {
                field = '';
            } else if (typeof field === 'object') {
                field = JSON.stringify(field);
            }
            const fieldStr = String(field);
            if (fieldStr.search(/("|,|\n)/g) >= 0) {
                return `"${fieldStr.replace(/"/g, '""')}"`;
            }
            return fieldStr;
        });
        csvRows.push(values.join(','));
    }
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showNotification('Export Complete', `${filename}.csv has been downloaded.`, 'success');
}


export async function generateAttendanceReport() {
    const selectedUsername = document.getElementById('admin-report-user-select').value;
    const startDate = document.getElementById('admin-report-start-date').value;
    const endDate = document.getElementById('admin-report-end-date').value;
    const resultsContainer = document.getElementById('admin-attendance-report-results');

    if (!selectedUsername || !startDate || !endDate) {
        return showNotification('Error', 'Please select a user and both start and end dates.', 'error');
    }
    if (new Date(startDate) > new Date(endDate)) {
        return showNotification('Error', 'Start date cannot be after the end date.', 'error');
    }
    resultsContainer.innerHTML = '<p class="text-center text-gray-400">Fetching report...</p>';
    try {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        const { data, error } = await _supabase
            .from('attendance')
            .select('shift_start, shift_end,device_type')
            .eq('username', selectedUsername)
            .gte('shift_start', new Date(startDate).toISOString())
            .lte('shift_start', endOfDay.toISOString())
            .order('shift_start', { ascending: true });
        if (error) throw error;
        renderAttendanceReport(data);
    } catch (err) {
        resultsContainer.innerHTML = `<p class="text-center text-red-400">Failed to fetch report: ${err.message}</p>`;
        showNotification('Report Error', err.message, 'error');
    }
}

function renderAttendanceReport(records) {
    const resultsContainer = document.getElementById('admin-attendance-report-results');
    if (!records || records.length === 0) {
        resultsContainer.innerHTML = '<p class="text-center text-gray-400">No attendance records found for this period.</p>';
        return;
    }
    let tableHTML = `
        <table class="w-full text-sm text-left">
            <thead class="text-xs text-gray-300 uppercase bg-gray-700/50">
                <tr>
                    <th scope="col" class="px-4 py-2">Date</th>
                    <th scope="col" class="px-4 py-2">Shift Start</th>
                    <th scope="col" class="px-4 py-2">Shift End</th>
                    <th scope="col" class="px-4 py-2">Duration</th>
                    <th scope="col" class="px-4 py-2">Device</th>
                </tr>
            </thead>
            <tbody>`;
    records.forEach(record => {
        const startDate = new Date(record.shift_start);
        const endDate = record.shift_end ? new Date(record.shift_end) : null;
        let duration = 'In Progress';
        if (endDate) {
            const diffMs = endDate - startDate;
            const hours = Math.floor(diffMs / 3600000);
            const minutes = Math.floor((diffMs % 3600000) / 60000);
            duration = `${hours}h ${minutes}m`;
        }
        let deviceDisplay = record.device_type === 'desktop' ? '💻 Desktop' : (record.device_type === 'mobile' ? '📱 Mobile' : 'N/A');
        tableHTML += `
            <tr class="border-b border-gray-700">
                <td class="px-4 py-2">${startDate.toLocaleDateString()}</td>
                <td class="px-4 py-2">${startDate.toLocaleTimeString()}</td>
                <td class="px-4 py-2">${endDate ? endDate.toLocaleTimeString() : '---'}</td>
                <td class="px-4 py-2">${duration}</td>
                <td class="px-4 py-2">${deviceDisplay}</td>
            </tr>`;
    });
    tableHTML += '</tbody></table>';
    resultsContainer.innerHTML = tableHTML;
}

export async function exportTicketsByDate() {
    const startDate = document.getElementById('export-start-date').value;
    const endDate = document.getElementById('export-end-date').value;

    if (!startDate || !endDate) {
        return showNotification('Error', 'Please select both a start and end date.', 'error');
    }
    if (new Date(startDate) > new Date(endDate)) {
        return showNotification('Error', 'Start date cannot be after the end date.', 'error');
    }

    showLoading();
    showNotification('Export Started', 'Fetching ticket data for the selected range...', 'info');

    try {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);

        const { data: tickets, error } = await _supabase
            .from('tickets')
            .select('*')
            .gte('created_at', new Date(startDate).toISOString())
            .lte('created_at', endOfDay.toISOString())
            .order('created_at', { ascending: true });

        if (error) throw error;
        if (!tickets || tickets.length === 0) {
            hideLoading();
            return showNotification('No Data', 'No tickets found in the selected date range.', 'info');
        }

        const filename = `Tickets-${startDate}-to-${endDate}`;
        exportToCSV(tickets, filename);
    } catch (err) {
        logError("Error exporting tickets by date:", err);
        showNotification('Export Failed', err.message, 'error');
    } finally {
        hideLoading();
    }
}

export async function generateUserActivityReport() {
    const selectedUsername = document.getElementById('admin-log-user-select').value;
    const startDate = document.getElementById('admin-log-start-date').value;
    const endDate = document.getElementById('admin-log-end-date').value;
    const resultsContainer = document.getElementById('admin-user-log-results');

    if (!selectedUsername || !startDate || !endDate) {
        return showNotification('Error', 'Please select a user and both start and end dates.', 'error');
    }
    resultsContainer.innerHTML = '<p class="text-center text-gray-400">Fetching logs...</p>';
    try {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        const { data, error } = await _supabase
            .from('user_points')
            .select('*')
            .eq('username', selectedUsername)
            .gte('created_at', new Date(startDate).toISOString())
            .lte('created_at', endOfDay.toISOString())
            .order('created_at', { ascending: false });
        if (error) throw error;
        if (!data || data.length === 0) {
            resultsContainer.innerHTML = '<p class="text-center text-gray-400">No activity found for this user in this period.</p>';
            return;
        }
        resultsContainer.innerHTML = data.map(log => {
            const pointClass = log.points_awarded > 0 ? 'text-green-400' : 'text-red-400';
            const sign = log.points_awarded > 0 ? '+' : '';
            return `
            <div class="bg-gray-800/50 p-3 rounded-lg text-sm mb-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold ${pointClass}">${sign}${log.points_awarded} pts</span>
                    <span class="text-xs text-gray-500">${new Date(log.created_at).toLocaleString()}</span>
                </div>
                <p class="text-gray-300 mt-1">${log.details.reason || 'No reason provided'}</p>
            </div>`;
        }).join('');
    } catch (err) {
        resultsContainer.innerHTML = `<p class="text-center text-red-400">Failed to fetch logs: ${err.message}</p>`;
    }
}

export async function exportUserActivityReport() {
    const selectedUsername = document.getElementById('admin-log-user-select').value;
    const startDate = document.getElementById('admin-log-start-date').value;
    const endDate = document.getElementById('admin-log-end-date').value;
    if (!selectedUsername || !startDate || !endDate) {
        return showNotification('Error', 'Please select a user (or "All Users") and both start and end dates.', 'error');
    }
    showLoading();
    try {
        const endOfDay = new Date(endDate);
        endOfDay.setHours(23, 59, 59, 999);
        let query = _supabase.from('user_points').select('created_at, username, event_type, points_awarded, details, related_ticket_id');
        if (selectedUsername !== 'all') {
            query = query.eq('username', selectedUsername);
        }
        const { data, error } = await query
            .gte('created_at', new Date(startDate).toISOString())
            .lte('created_at', endOfDay.toISOString())
            .order('created_at', { ascending: false });
        if (error) throw error;
        const filename = `UserActivityLog-${selectedUsername}-${startDate}-to-${endDate}`;
        exportToCSV(data, filename);
    } catch (err) {
        showNotification('Export Failed', `Failed to fetch log data: ${err.message}`, 'error');
    } finally {
        hideLoading();
    }
}

export async function generateWeeklyHistoryReport() {
    const selectedUsername = document.getElementById('admin-history-user-select').value;
    const startDate = document.getElementById('admin-history-start-date').value;
    const endDate = document.getElementById('admin-history-end-date').value;
    const resultsContainer = document.getElementById('admin-weekly-history-results');

    if (!selectedUsername || !startDate || !endDate) {
        return showNotification('Error', 'Please select a user and both start and end dates.', 'error');
    }
    resultsContainer.innerHTML = '<p class="text-center text-gray-400">Fetching weekly history...</p>';
    try {
        const { data, error } = await _supabase
            .from('weekly_leaderboard')
            .select('week_start_date, total_score')
            .eq('username', selectedUsername)
            .gte('week_start_date', startDate)
            .lte('week_start_date', endDate)
            .order('week_start_date', { ascending: false });
        if (error) throw error;
        if (!data || data.length === 0) {
            resultsContainer.innerHTML = '<p class="text-center text-gray-400">No weekly score history found for this user in this period.</p>';
            return;
        }
        resultsContainer.innerHTML = data.map(record => {
            const weekStart = new Date(record.week_start_date + 'T00:00:00').toLocaleDateString();
            const pointClass = record.total_score >= 0 ? 'text-green-400' : 'text-red-400';
            const sign = record.total_score > 0 ? '+' : '';
            return `
            <div class="bg-gray-800/50 p-3 rounded-lg text-sm mb-2">
                <div class="flex justify-between items-center">
                    <span class="font-semibold text-white">Week of ${weekStart}</span>
                    <span class="font-bold text-lg ${pointClass}">${sign}${record.total_score} pts</span>
                </div>
            </div>`;
        }).join('');
    } catch (err) {
        resultsContainer.innerHTML = `<p class="text-center text-red-400">Failed to fetch history: ${err.message}</p>`;
    }
}

export async function exportWeeklyHistoryReport() {
    const selectedUsername = document.getElementById('admin-history-user-select').value;
    const startDate = document.getElementById('admin-history-start-date').value;
    const endDate = document.getElementById('admin-history-end-date').value;
    if (!selectedUsername || !startDate || !endDate) {
        return showNotification('Error', 'Please select a user (or "All Users") and both start and end dates.', 'error');
    }
    showLoading();
    try {
        let query = _supabase.from('weekly_leaderboard').select('week_start_date, username, total_score');
        if (selectedUsername !== 'all') {
            query = query.eq('username', selectedUsername);
        }
        const { data, error } = await query
            .gte('week_start_date', startDate)
            .lte('week_start_date', endDate)
            .order('week_start_date', { ascending: false });
        if (error) throw error;
        const filename = `WeeklyHistory-${selectedUsername}-${startDate}-to-${endDate}`;
        exportToCSV(data, filename);
    } catch (err) {
        showNotification('Export Failed', `Failed to fetch history data: ${err.message}`, 'error');
    } finally {
        hideLoading();
    }
}


// --- BROADCAST MESSAGES ---

export async function postBroadcastMessage() {
    const input = document.getElementById('broadcast-input');
    const message = input.value.trim();
    if (!message) return;
    showLoading();
    try {
        await _supabase.from('broadcast_messages').update({ is_active: false }).eq('is_active', true);
        const { error } = await _supabase.from('broadcast_messages').insert({ message: message, user_id: appState.currentUser.id, is_active: true });
        if (error) throw error;
        input.value = '';
        showNotification('Success', 'Broadcast message posted!', 'success');
    } catch (err) {
        showNotification('Error', err.message, 'error');
    } finally {
        hideLoading();
    }
}

