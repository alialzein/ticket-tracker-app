// Admin Broadcast and Activity Management
import { _supabase } from '../../js/config.js';
import { adminState } from './admin-main.js';

let currentActivityFilter = 'all';

/**
 * Post broadcast message
 */
export async function postBroadcastMessage() {
    const input = document.getElementById('broadcast-input');
    const message = input.value.trim();

    if (!message) {
        showNotification('Error', 'Please enter a message', 'error');
        return;
    }

    try {
        console.log('[Admin] Posting broadcast message...');

        // Deactivate all previous broadcast messages
        await _supabase
            .from('broadcast_messages')
            .update({ is_active: false })
            .eq('is_active', true);

        // Insert new broadcast message
        const { error } = await _supabase
            .from('broadcast_messages')
            .insert({
                message: message,
                user_id: adminState.currentUser.id,
                is_active: true
            });

        if (error) throw error;

        // Log the action
        await logAdminAction('broadcast_posted', null, null, { message });

        input.value = '';
        showNotification('Success', 'Broadcast message posted successfully!', 'success');

    } catch (err) {
        console.error('[Admin] Error posting broadcast:', err);
        showNotification('Error', err.message, 'error');
    }
}

/**
 * Load recent activity with filtering
 */
export async function loadRecentActivity() {
    const container = document.getElementById('recent-activity');

    try {
        console.log('[Admin] Loading recent activity...');

        let query = _supabase
            .from('admin_audit_log')
            .select('id, admin_username, action, target_username, created_at, details')
            .order('created_at', { ascending: false })
            .limit(50);

        // Apply filter
        if (currentActivityFilter !== 'all') {
            query = query.eq('action', currentActivityFilter);
        }

        const { data, error } = await query;

        if (error) {
            console.error('[Admin] Error loading activity:', error);
            container.innerHTML = `
                <div class="text-center py-8 text-gray-400">
                    <p>📝 No activity logged yet</p>
                    <p class="text-xs mt-2">Activity will appear here once actions are performed</p>
                </div>
            `;
            return;
        }

        console.log('[Admin] Loaded', data?.length || 0, 'activity entries');

        if (!data || data.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-gray-400">
                    <p>No ${currentActivityFilter === 'all' ? 'recent' : 'matching'} activity</p>
                </div>
            `;
            return;
        }

        // Render activity items
        container.innerHTML = data.map(activity => {
            const timestamp = new Date(activity.created_at).toLocaleString();
            const canDelete = adminState.isSuperAdmin;

            return `
                <div class="flex items-start gap-3 p-3 bg-gray-700/50 rounded-lg group">
                    <div class="flex-1">
                        <p class="text-sm text-white">
                            <span class="font-semibold text-blue-400">${activity.admin_username || 'Admin'}</span>
                            ${formatAction(activity.action, activity.target_username)}
                        </p>
                        ${activity.details ? `<p class="text-xs text-gray-500 mt-1">${formatDetails(activity.details)}</p>` : ''}
                        <p class="text-xs text-gray-500 mt-1">${timestamp}</p>
                    </div>
                    ${canDelete ? `
                        <button onclick="adminFunctions.deleteActivityLog('${activity.id}')" class="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-300 transition-opacity" title="Delete">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('[Admin] Error loading recent activity:', err);
        container.innerHTML = `
            <div class="text-center py-8 text-gray-400">
                <p>Activity tracking unavailable</p>
            </div>
        `;
    }
}

/**
 * Format action text
 */
function formatAction(action, targetUsername) {
    const actionMap = {
        'user_created': `created user <span class="text-purple-400">${targetUsername}</span>`,
        'user_updated': `updated user <span class="text-purple-400">${targetUsername}</span>`,
        'user_blocked': `blocked user <span class="text-red-400">${targetUsername}</span>`,
        'user_unblocked': `unblocked user <span class="text-green-400">${targetUsername}</span>`,
        'user_deleted': `deleted user <span class="text-red-400">${targetUsername}</span>`,
        'broadcast_posted': 'posted a broadcast message',
        'activity_cleared': 'cleared all activity logs'
    };

    return actionMap[action] || action;
}

/**
 * Format details object
 */
function formatDetails(details) {
    if (typeof details === 'string') {
        try {
            details = JSON.parse(details);
        } catch {
            return details;
        }
    }

    if (details.message) {
        return `Message: "${details.message}"`;
    }

    if (details.is_team_leader) {
        return 'Made team leader';
    }

    if (details.blocked_reason) {
        return `Reason: ${details.blocked_reason}`;
    }

    return '';
}

/**
 * Apply activity filter
 */
export function applyActivityFilter() {
    const filterSelect = document.getElementById('activity-filter');
    currentActivityFilter = filterSelect.value;
    loadRecentActivity();
}

/**
 * Delete single activity log
 */
export async function deleteActivityLog(logId) {
    if (!adminState.isSuperAdmin) {
        showNotification('Error', 'Only super admins can delete activity logs', 'error');
        return;
    }

    if (!confirm('Are you sure you want to delete this activity log?')) {
        return;
    }

    try {
        const { error } = await _supabase
            .from('admin_audit_log')
            .delete()
            .eq('id', logId);

        if (error) throw error;

        showNotification('Success', 'Activity log deleted', 'success');
        loadRecentActivity();

    } catch (err) {
        console.error('[Admin] Error deleting activity log:', err);
        showNotification('Error', err.message, 'error');
    }
}

/**
 * Clear all activity logs
 */
export async function clearAllActivity() {
    if (!adminState.isSuperAdmin) {
        showNotification('Error', 'Only super admins can clear activity logs', 'error');
        return;
    }

    if (!confirm('⚠️ WARNING: This will permanently delete ALL activity logs. This action cannot be undone!\n\nAre you absolutely sure?')) {
        return;
    }

    try {
        // Log the clear action before clearing
        await logAdminAction('activity_cleared', null, null, {
            timestamp: new Date().toISOString()
        });

        // Delete all logs except the one we just created
        const { error } = await _supabase
            .from('admin_audit_log')
            .delete()
            .neq('action', 'activity_cleared');

        if (error) throw error;

        showNotification('Success', 'All activity logs cleared', 'success');
        loadRecentActivity();

    } catch (err) {
        console.error('[Admin] Error clearing activity:', err);
        showNotification('Error', err.message, 'error');
    }
}

/**
 * Log admin action
 */
async function logAdminAction(action, targetUserId, targetUsername, details) {
    try {
        await _supabase
            .from('admin_audit_log')
            .insert({
                admin_user_id: adminState.currentUser.id,
                admin_username: adminState.currentUser.user_metadata?.display_name ||
                               adminState.currentUser.email?.split('@')[0],
                action,
                target_user_id: targetUserId,
                target_username: targetUsername,
                details
            });
    } catch (err) {
        console.error('[Admin] Error logging action:', err);
    }
}

/**
 * Show notification
 */
function showNotification(title, message, type) {
    // You can implement a proper notification system
    // For now, using alert
    if (type === 'error') {
        alert(`${title}: ${message}`);
    } else {
        alert(`${title}: ${message}`);
    }
}

/**
 * Initialize broadcast and activity functions
 */
export function initBroadcastAndActivity() {
    // Setup activity filter listener
    const filterSelect = document.getElementById('activity-filter');
    if (filterSelect) {
        filterSelect.addEventListener('change', applyActivityFilter);
    }

    // Hide clear button for non-super admins
    const clearBtn = document.getElementById('clear-activity-btn');
    if (clearBtn && !adminState.isSuperAdmin) {
        clearBtn.style.display = 'none';
    }

    // Load initial activity
    loadRecentActivity();
}

/**
 * Count activity logs in a date range (shows confirmation count before delete)
 */
export async function countActivityByPeriod() {
    const from = document.getElementById('activity-clear-from')?.value;
    const to   = document.getElementById('activity-clear-to')?.value;
    const msg  = document.getElementById('activity-clear-msg');
    const btn  = document.getElementById('activity-clear-confirm-btn');

    if (!from && !to) {
        if (msg) msg.textContent = 'Please select at least a From or To date.';
        return;
    }

    let query = _supabase.from('admin_audit_log').select('id', { count: 'exact', head: true });
    if (from) query = query.gte('created_at', from);
    if (to)   query = query.lte('created_at', to + 'T23:59:59');

    const { count, error } = await query;
    if (error) { showNotification('Error', error.message, 'error'); return; }

    if (msg) msg.textContent = `Found ${count} activity log${count !== 1 ? 's' : ''} in this period.`;
    if (btn) {
        btn.textContent = `Delete ${count} log${count !== 1 ? 's' : ''}`;
        btn.classList.toggle('hidden', !count);
        btn.dataset.count = count;
    }
}

/**
 * Delete activity logs in a date range
 */
export async function clearActivityByPeriod() {
    const from  = document.getElementById('activity-clear-from')?.value;
    const to    = document.getElementById('activity-clear-to')?.value;
    const btn   = document.getElementById('activity-clear-confirm-btn');
    const count = parseInt(btn?.dataset.count || '0', 10);

    if (!confirm(`Permanently delete ${count} activity log${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;

    let query = _supabase.from('admin_audit_log').delete();
    if (from) query = query.gte('created_at', from);
    if (to)   query = query.lte('created_at', to + 'T23:59:59');

    const { error } = await query;
    if (error) { showNotification('Error', error.message, 'error'); return; }

    showNotification('Cleared', `${count} activity logs deleted.`, 'success');
    const msg = document.getElementById('activity-clear-msg');
    if (msg) msg.textContent = '';
    if (btn) btn.classList.add('hidden');
    loadRecentActivity();
}

// Export for global access
export const adminFunctions = {
    postBroadcastMessage,
    loadRecentActivity,
    applyActivityFilter,
    deleteActivityLog,
    clearAllActivity,
    countActivityByPeriod,
    clearActivityByPeriod,
};

// Make functions available globally
window.adminFunctions = adminFunctions;
