import { _supabase } from '../../js/config.js';
import { appState } from '../../js/state.js';
import * as ui from '../../js/ui.js';

// Training sessions content
const TRAINING_SESSIONS = {
    1: {
        title: 'Session 1: System Overview & Core Functionalities',
        duration: '1-2 hours'
    },
    2: {
        title: 'Session 2: Advanced Routing & Security',
        duration: '1-2 hours'
    },
    3: {
        title: 'Session 3: Financials, Reporting & Alerts',
        duration: '1-2 hours'
    }
};

// Initialize admin training management
export async function initAdminTraining() {
    console.log('[Admin Training] Initializing admin training management');
    loadAllTrainingSessions();
}

// Load all training sessions
async function loadAllTrainingSessions() {
    try {
        const { data, error } = await _supabase
            .from('training_sessions')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        renderTrainingSessions(data || []);
    } catch (err) {
        console.error('[Admin Training] Error loading sessions:', err);
    }
}

// Render all training sessions in admin panel
function renderTrainingSessions(sessions) {
    const container = document.getElementById('admin-training-sessions-container');
    if (!container) return;

    if (sessions.length === 0) {
        container.innerHTML = '<p class="text-gray-400 text-center py-8">No training sessions assigned yet</p>';
        return;
    }

    container.innerHTML = sessions.map(session => {
        const sessionContent = TRAINING_SESSIONS[session.session_number];
        const statusBadge = session.is_completed
            ? '<span class="bg-green-500/20 text-green-300 text-xs px-2 py-1 rounded-full font-semibold">✅ Completed</span>'
            : '<span class="bg-amber-500/20 text-amber-300 text-xs px-2 py-1 rounded-full font-semibold">In Progress</span>';

        const assignedBadge = session.is_admin_assigned
            ? '<span class="bg-blue-500/20 text-blue-300 text-xs px-2 py-1 rounded-full font-semibold">📌 Admin Assigned</span>'
            : '<span class="bg-gray-500/20 text-gray-300 text-xs px-2 py-1 rounded-full font-semibold">Self-Created</span>';

        return `
            <div class="bg-gray-700/50 rounded-lg p-4 border border-gray-600/50 hover:border-gray-600 transition-colors">
                <div class="flex items-start justify-between mb-3">
                    <div>
                        <h4 class="font-bold text-white">${session.client_name}</h4>
                        <p class="text-sm text-gray-400">${sessionContent.title}</p>
                    </div>
                    <div class="flex gap-2">
                        ${statusBadge}
                        ${assignedBadge}
                    </div>
                </div>

                <div class="flex items-center justify-between text-xs text-gray-400 mb-3">
                    <span>User: <span class="text-indigo-400 font-semibold">${session.user_email || 'Loading...'}</span></span>
                    <span>${session.created_at ? new Date(session.created_at).toLocaleDateString() : ''}</span>
                </div>

                <div class="flex gap-2">
                    <button onclick="adminTraining.sendTrainingBroadcast('${session.id}', '${session.client_name}', '${session.session_number}')"
                        class="flex-1 text-sm bg-blue-600/80 hover:bg-blue-700 text-white px-3 py-1 rounded transition-colors">
                        📢 Broadcast Assignment
                    </button>
                    <button onclick="adminTraining.deleteAssignment('${session.id}')"
                        class="text-sm bg-red-600/80 hover:bg-red-700 text-white px-3 py-1 rounded transition-colors">
                        🗑️
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Open assign training modal
export function openAssignTrainingModal() {
    document.getElementById('assign-training-modal').classList.remove('hidden');
    loadUsersForAssignment();
}

// Close assign training modal
export function closeAssignTrainingModal() {
    document.getElementById('assign-training-modal').classList.add('hidden');
}

// Load users for assignment
async function loadUsersForAssignment() {
    try {
        const { data, error } = await _supabase
            .from('user_settings')
            .select('user_id, system_username, email')
            .order('system_username', { ascending: true });

        if (error) throw error;

        const userSelect = document.getElementById('assign-user-select');
        userSelect.innerHTML = '<option value="">Select a user...</option>' +
            (data || []).map(user => `
                <option value="${user.user_id}|${user.email}">${user.system_username} (${user.email})</option>
            `).join('');
    } catch (err) {
        console.error('[Admin Training] Error loading users:', err);
        ui.showNotification('Error', 'Failed to load users', 'error');
    }
}

// Assign training to user
export async function assignTrainingToUser() {
    const userValue = document.getElementById('assign-user-select').value;
    const clientName = document.getElementById('assign-client-name').value.trim();
    const sessionNumber = document.getElementById('assign-session-number').value;

    if (!userValue) {
        ui.showNotification('Error', 'Please select a user', 'error');
        return;
    }

    if (!clientName) {
        ui.showNotification('Error', 'Please enter a client name', 'error');
        return;
    }

    if (!sessionNumber) {
        ui.showNotification('Error', 'Please select a training session', 'error');
        return;
    }

    try {
        ui.showLoading();
        const [userId, userEmail] = userValue.split('|');

        // Create training session
        const { data: newSession, error: createError } = await _supabase
            .from('training_sessions')
            .insert({
                user_id: userId,
                assigned_by_admin: appState.currentUser.id,
                client_name: clientName,
                session_number: parseInt(sessionNumber),
                is_admin_assigned: true,
                assigned_at: new Date().toISOString(),
                completed_subjects: JSON.stringify([]),
                session_notes: '',
                is_completed: false
            })
            .select()
            .single();

        if (createError) throw createError;

        // Get session details
        const sessionContent = TRAINING_SESSIONS[sessionNumber];

        // Send broadcast message
        const broadcastMessage = `📚 NEW TRAINING ASSIGNMENT\n\n👤 ${userEmail.split('@')[0]} has been assigned to complete:\n\n📖 ${sessionContent.title}\n👥 Client: ${clientName}\n\nPlease check your training dashboard for details!`;

        const { error: broadcastError } = await _supabase
            .from('broadcast_messages')
            .update({ is_active: false })
            .eq('is_active', true);

        if (!broadcastError) {
            await _supabase.from('broadcast_messages').insert({
                message: broadcastMessage,
                user_id: appState.currentUser.id,
                is_active: true,
                message_type: 'training_assignment'
            });
        }

        // Log activity
        const { error: logError } = await _supabase
            .from('admin_audit_log')
            .insert({
                admin_username: appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0],
                action: 'training_assigned',
                target_username: userEmail.split('@')[0],
                details: `Assigned ${sessionContent.title} for ${clientName}`
            });

        if (!logError) {
            console.log('[Admin Training] Activity logged');
        }

        ui.showNotification('Success', `Training assigned to ${userEmail.split('@')[0]} and broadcasted!`, 'success');
        closeAssignTrainingModal();

        // Clear form
        document.getElementById('assign-client-name').value = '';
        document.getElementById('assign-session-number').value = '';
        document.getElementById('assign-user-select').value = '';

        // Refresh the list
        loadAllTrainingSessions();
    } catch (err) {
        console.error('[Admin Training] Error assigning training:', err);
        ui.showNotification('Error', err.message || 'Failed to assign training', 'error');
    } finally {
        ui.hideLoading();
    }
}

// Send training broadcast (for existing sessions)
export async function sendTrainingBroadcast(sessionId, clientName, sessionNumber) {
    try {
        ui.showLoading();

        // Get user info for the broadcast
        const { data: session, error: getError } = await _supabase
            .from('training_sessions')
            .select('user_settings(email)')
            .eq('id', sessionId)
            .single();

        if (getError) throw getError;

        const sessionContent = TRAINING_SESSIONS[sessionNumber];
        const userEmail = session?.user_settings?.email || 'User';
        const username = userEmail.split('@')[0];

        const broadcastMessage = `📚 TRAINING REMINDER\n\n👤 ${username}, don't forget to complete:\n\n📖 ${sessionContent.title}\n👥 Client: ${clientName}\n\nCheck your training dashboard now!`;

        // Deactivate old broadcasts
        await _supabase
            .from('broadcast_messages')
            .update({ is_active: false })
            .eq('is_active', true);

        // Create new broadcast
        const { error: broadcastError } = await _supabase
            .from('broadcast_messages')
            .insert({
                message: broadcastMessage,
                user_id: appState.currentUser.id,
                is_active: true,
                message_type: 'training_reminder'
            });

        if (broadcastError) throw broadcastError;

        // Log activity
        await _supabase
            .from('admin_audit_log')
            .insert({
                admin_username: appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0],
                action: 'training_broadcast',
                target_username: username,
                details: `Broadcasted training reminder for ${clientName}`
            });

        ui.showNotification('Success', 'Training broadcast sent to all users!', 'success');
    } catch (err) {
        console.error('[Admin Training] Error sending broadcast:', err);
        ui.showNotification('Error', 'Failed to send broadcast', 'error');
    } finally {
        ui.hideLoading();
    }
}

// Delete assignment
export async function deleteAssignment(sessionId) {
    if (!confirm('Are you sure you want to delete this training assignment?')) return;

    try {
        ui.showLoading();

        const { error } = await _supabase
            .from('training_sessions')
            .delete()
            .eq('id', sessionId);

        if (error) throw error;

        ui.showNotification('Success', 'Training assignment deleted', 'success');
        loadAllTrainingSessions();
    } catch (err) {
        console.error('[Admin Training] Error deleting assignment:', err);
        ui.showNotification('Error', 'Failed to delete assignment', 'error');
    } finally {
        ui.hideLoading();
    }
}

// Export as object
export const adminTraining = {
    initAdminTraining,
    openAssignTrainingModal,
    closeAssignTrainingModal,
    assignTrainingToUser,
    sendTrainingBroadcast,
    deleteAssignment
};
