// js/schedule.js

import { _supabase } from './config.js';
import { appState } from './state.js';
import { showNotification, openConfirmModal, formatTime, getUserColor as ui_getUserColor } from './ui.js';
import * as ui from './ui.js';
import { awardPoints, logActivity } from './main.js';
import { detectDeviceType } from './device-detection.js';
import { log, logError, logWarn } from './logger.js';

// ✅ FIX: These are now private to this module
let lunchTimerInterval = null;
let shiftReminderInterval = null;
let autoEndShiftInterval = null;
let deviceCheckInterval = null;

// Initialize Shift+Enter functionality for note textarea
export function initScheduleShortcuts() {
    const noteTextarea = document.getElementById('deployment-note-text');
    if (noteTextarea) {
        noteTextarea.addEventListener('keydown', (e) => {
            // Check if Shift+Enter is pressed
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault(); // Prevent default Enter behavior (new line)
                saveScheduleItem(); // Trigger save
            }
        });
    }
}

// ✅ FIX: Added 'export' to make these functions public
export function startLunchTimer(lunchStartTime, user) {
    if (lunchTimerInterval) clearInterval(lunchTimerInterval);
    lunchTimerInterval = setInterval(() => {
        const nowInner = new Date();
        const diffSecondsInner = Math.floor((nowInner - lunchStartTime) / 1000);
        const secondsRemaining = (30 * 60) - diffSecondsInner;
        if (secondsRemaining < 0) {
            clearInterval(lunchTimerInterval);
            return;
        }
        const minutes = Math.floor(secondsRemaining / 60);
        const seconds = secondsRemaining % 60;
        const timerEl = document.getElementById(`lunch-timer-${user.replace(/\./g, '-')}`);
        if (timerEl) {
            timerEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
    }, 1000);
}

export function clearLunchTimer() {
    if (lunchTimerInterval) clearInterval(lunchTimerInterval);
}


// --- SCHEDULE ITEM FUNCTIONS (Deployments/Meetings) ---
export async function saveScheduleItem() {
    const noteTextEl = document.getElementById('deployment-note-text');
    const itemDateEl = document.getElementById('deployment-date');
    const itemTimeEl = document.getElementById('deployment-time');
    const itemTypeEl = document.getElementById('item-type-select');

    const noteText = noteTextEl?.value.trim() || '';
    const itemDate = itemDateEl?.value || '';
    const itemTime = itemTimeEl?.value || '';
    const itemType = itemTypeEl?.value || '';

    if (!noteText || !itemDate) {
        return showNotification('Missing Information', 'Please enter note text and date.', 'error');
    }

    if (!itemTime || itemTime.length === 0) {
        return showNotification('Missing Time', 'Please select a time for the meeting/deployment.', 'error');
    }

    try {
        const insertData = {
            user_id: appState.currentUser.id,
            username: appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0],
            note_text: noteText,
            deployment_date: itemDate,
            deployment_time: itemTime || null,
            type: itemType
        };

        const { error } = await _supabase.from('deployment_notes').insert(insertData);

        if (error) throw error;
        awardPoints('SCHEDULE_ITEM_ADDED', { itemType: itemType });
        showNotification('Success', `${itemType} added successfully.`, 'success');
        window.ui.toggleItemForm();
        await fetchScheduleItems();
    } catch (err) {
        logError('Error saving item:', err);
        showNotification('Error', 'Failed to save item.', 'error');
    }
}

export async function fetchScheduleItems() {
    try {
        const { data, error } = await _supabase.from('deployment_notes')
            .select('*').eq('is_completed', false)
            .order('deployment_date', { ascending: true })
            .order('deployment_time', { ascending: true });
        if (error) throw error;
        appState.deploymentNotes = data || [];
        renderScheduleItems();
    } catch (err) {
        logError('Error fetching schedule items:', err);
    }
}

export function renderScheduleItems() {
    const container = document.getElementById('deployment-notes-list');
    if (!container) return;
    if (!appState.deploymentNotes || appState.deploymentNotes.length === 0) {
        container.innerHTML = '<p class="text-sm text-center text-gray-400">No upcoming deployments or meetings.</p>';
        return;
    }
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    container.innerHTML = '';

    appState.deploymentNotes.forEach(note => {
        const itemDate = new Date(note.deployment_date + 'T00:00:00');
        const isToday = itemDate.getTime() === today.getTime();
        const isTomorrow = itemDate.getTime() === tomorrow.getTime();
        const isPast = itemDate < today;
        let dateString; let alertClass = ''; let alertIcon = '';
        if (isPast) { dateString = 'OVERDUE'; alertClass = 'bg-red-500/30 border-l-4 border-red-500'; alertIcon = '⚠️'; }
        else if (isToday) { dateString = 'TODAY'; alertClass = 'bg-yellow-500/30 border-l-4 border-yellow-500'; alertIcon = '🚨'; }
        else if (isTomorrow) { dateString = 'Tomorrow'; alertClass = 'bg-blue-500/20 border-l-4 border-blue-500'; alertIcon = '📅'; }
        else { dateString = itemDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); alertClass = 'glassmorphism border border-gray-600/30'; }

        const typeIcon = note.type === 'Meeting' ? '🤝' : '🚀';
        const timeString = note.deployment_time ? ` at ${formatTime(note.deployment_time)}` : '';
        const isMyNote = note.user_id === appState.currentUser.id;
        const isMeeting = note.type === 'Meeting';

        // Check if current user is already a collaborator
        const collaborators = note.collaborators || [];
        const currentUsername = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
        const isCollaborator = collaborators.some(c => c.username === currentUsername);
        const hasPendingRequest = collaborators.some(c => c.username === currentUsername && c.status === 'pending');
        const isApproved = collaborators.some(c => c.username === currentUsername && c.status === 'approved');

        // Build collaborators display
        let collaboratorsHTML = '';
        let pendingRequestsHTML = '';

        if (isMeeting && collaborators.length > 0) {
            const approvedCollaborators = collaborators.filter(c => c.status === 'approved');
            const pendingCollaborators = collaborators.filter(c => c.status === 'pending');

            if (approvedCollaborators.length > 0) {
                collaboratorsHTML = `<div class="flex items-center gap-1 mt-2 flex-wrap">
                    <span class="text-xs text-gray-400">Collaborators:</span>
                    ${approvedCollaborators.map(c => {
                        return `<span class="text-xs font-semibold deployment-collab-username bg-gray-700/50 px-2 py-0.5 rounded-full" data-username="${c.username}">${c.username}</span>`;
                    }).join('')}
                </div>`;
            }

            // Show pending requests to the creator
            if (isMyNote && pendingCollaborators.length > 0) {
                pendingRequestsHTML = `<div class="mt-2 space-y-1">
                    <span class="text-xs text-gray-400">Pending Requests:</span>
                    ${pendingCollaborators.map(c => {
                        return `<div class="flex items-center justify-between bg-gray-700/30 rounded-lg p-2">
                            <span class="text-xs font-semibold deployment-collab-username" data-username="${c.username}">${c.username}</span>
                            <button onclick="schedule.approveCollaboration(${note.id}, '${c.username}')"
                                class="bg-green-600 hover:bg-green-700 text-white text-xs font-semibold py-1 px-3 rounded-lg transition-colors hover-scale">
                                Approve
                            </button>
                        </div>`;
                    }).join('')}
                </div>`;
            }
        }

        container.innerHTML += `
            <div id="item-${note.id}" class="p-3 rounded-lg transition-all ${alertClass}">
                <div class="flex items-start justify-between mb-2">
                    <div class="flex items-center gap-2">
                        <span class="text-lg">${alertIcon || typeIcon}</span>
                        <p class="font-bold deployment-note-username text-sm" data-username="${note.username}">${note.username}</p>
                    </div>
                    <div class="flex items-center gap-1">
                        <button onclick="schedule.markItemComplete(${note.id})" class="text-gray-400 hover:text-green-400 p-1" title="Mark as completed"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M10.97 4.97a.75.75 0 0 1 1.07 1.05l-3.99 4.99a.75.75 0 0 1-1.08.02L4.324 8.384a.75.75 0 1 1 1.06-1.06l2.094 2.093 3.473-4.425a.267.267 0 0 1 .02-.022z"/></svg></button>
                        ${isMyNote ? `<button onclick="ui.openEditScheduleItemModal(${note.id})" class="text-gray-400 hover:text-indigo-400 p-1" title="Edit item"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/></svg></button>` : ''}
                        ${isMyNote ? `<button onclick="schedule.deleteScheduleItem(${note.id})" class="text-gray-400 hover:text-red-400 p-1" title="Delete item"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>` : ''}
                    </div>
                </div>
                <p class="text-white text-sm leading-relaxed mb-2">${note.note_text}</p>
                <p class="text-xs font-semibold ${isToday || isPast ? 'text-white' : 'text-gray-300'}">${dateString}${timeString}</p>
                ${collaboratorsHTML}
                ${pendingRequestsHTML}
                ${isMeeting && !isMyNote && !isCollaborator ? `
                    <button onclick="schedule.requestCollaboration(${note.id})"
                        class="mt-2 w-full bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold py-1.5 px-3 rounded-lg transition-colors hover-scale">
                        Join Meeting 🤝
                    </button>
                ` : ''}
                ${isMeeting && hasPendingRequest ? `
                    <div class="mt-2 w-full bg-yellow-600/20 border border-yellow-500/30 text-yellow-300 text-xs font-semibold py-1.5 px-3 rounded-lg text-center">
                        Pending Approval ⏳
                    </div>
                ` : ''}
                ${isMeeting && isApproved ? `
                    <div class="mt-2 w-full bg-green-600/20 border border-green-500/30 text-green-300 text-xs font-semibold py-1.5 px-3 rounded-lg text-center">
                        Joined ✓
                    </div>
                ` : ''}
            </div>`;
    });

    // Apply colors to deployment note usernames after rendering
    applyDeploymentNoteColors();
}

/**
 * Apply user colors to deployment note usernames dynamically
 * This finds all .deployment-note-username and .deployment-collab-username elements
 */
async function applyDeploymentNoteColors() {
    const noteUsernames = document.querySelectorAll('.deployment-note-username[data-username]');
    for (const element of noteUsernames) {
        const username = element.getAttribute('data-username');
        if (username) {
            const colorObj = await ui.getUserColor(username);
            element.style.color = colorObj.rgb;
        }
    }

    const collabUsernames = document.querySelectorAll('.deployment-collab-username[data-username]');
    for (const element of collabUsernames) {
        const username = element.getAttribute('data-username');
        if (username) {
            const colorObj = await ui.getUserColor(username);
            element.style.color = colorObj.rgb;
        }
    }
}

/**
 * Apply user colors to schedule display usernames dynamically
 */
async function applyScheduleDisplayColors() {
    const usernames = document.querySelectorAll('.schedule-display-username[data-username]');
    for (const element of usernames) {
        const username = element.getAttribute('data-username');
        if (username) {
            const colorObj = await ui.getUserColor(username);
            element.style.color = colorObj.rgb;
        }
    }
}

/**
 * Apply user colors to schedule edit form usernames dynamically
 */
async function applyScheduleEditColors() {
    const usernames = document.querySelectorAll('.schedule-edit-username[data-username]');
    for (const element of usernames) {
        const username = element.getAttribute('data-username');
        if (username) {
            const colorObj = await ui.getUserColor(username);
            element.style.color = colorObj.rgb;
        }
    }
}

/**
 * Apply user colors to default schedule form usernames dynamically
 */
async function applyDefaultScheduleColors() {
    const usernames = document.querySelectorAll('.default-schedule-username[data-username]');
    for (const element of usernames) {
        const username = element.getAttribute('data-username');
        if (username) {
            const colorObj = await ui.getUserColor(username);
            element.style.color = colorObj.rgb;
        }
    }
}

export async function requestCollaboration(meetingId) {
    try {
        const currentUsername = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];

        // Fetch the current meeting
        const { data: meeting, error: fetchError } = await _supabase
            .from('deployment_notes')
            .select('*')
            .eq('id', meetingId)
            .single();

        if (fetchError) throw fetchError;

        // Check if already a collaborator
        const collaborators = meeting.collaborators || [];
        if (collaborators.some(c => c.username === currentUsername)) {
            showNotification('Already Requested', 'You have already requested to join this meeting.', 'info');
            return;
        }

        // Add the collaboration request
        const newCollaborator = {
            username: currentUsername,
            user_id: appState.currentUser.id,
            status: 'pending',
            requested_at: new Date().toISOString()
        };

        const updatedCollaborators = [...collaborators, newCollaborator];

        const { error: updateError } = await _supabase
            .from('deployment_notes')
            .update({ collaborators: updatedCollaborators })
            .eq('id', meetingId);

        if (updateError) throw updateError;

        showNotification('Request Sent', 'Your collaboration request has been sent to the meeting creator.', 'success');

        // Send notification to meeting creator
        await sendCollaborationNotification(meeting, currentUsername);

    } catch (err) {
        logError('Error requesting collaboration:', err);
        showNotification('Error', 'Failed to send collaboration request.', 'error');
    }
}

async function sendCollaborationNotification(meeting, requesterUsername) {
    try {
        const { error } = await _supabase.from('activity_log').insert({
            user_id: meeting.user_id,
            username: meeting.username,
            activity_type: 'COLLABORATION_REQUEST',
            details: {
                meeting_id: meeting.id,
                meeting_text: meeting.note_text,
                requester: requesterUsername
            }
        });

        if (error) throw error;
    } catch (err) {
        logError('Error sending collaboration notification:', err);
    }
}

export async function approveCollaboration(meetingId, requesterUsername) {
    try {
        // Fetch the current meeting
        const { data: meeting, error: fetchError } = await _supabase
            .from('deployment_notes')
            .select('*')
            .eq('id', meetingId)
            .single();

        if (fetchError) throw fetchError;

        // Update collaborator status to approved
        const collaborators = meeting.collaborators || [];
        const updatedCollaborators = collaborators.map(c => {
            if (c.username === requesterUsername && c.status === 'pending') {
                return {
                    ...c,
                    status: 'approved',
                    approved_at: new Date().toISOString()
                };
            }
            return c;
        });

        const { error: updateError } = await _supabase
            .from('deployment_notes')
            .update({ collaborators: updatedCollaborators })
            .eq('id', meetingId);

        if (updateError) throw updateError;

        showNotification('Approved', `${requesterUsername} can now collaborate on this meeting.`, 'success');

        // Award points to the collaborator
        const collaborator = collaborators.find(c => c.username === requesterUsername);
        if (collaborator) {
            await awardPoints('MEETING_COLLABORATION', {
                meetingId: meetingId
            }, {
                userId: collaborator.user_id,
                username: requesterUsername
            });
        }

        // Notify the requester
        await sendApprovalNotification(collaborator.user_id, requesterUsername, meeting);

    } catch (err) {
        logError('Error approving collaboration:', err);
        showNotification('Error', 'Failed to approve collaboration request.', 'error');
    }
}

async function sendApprovalNotification(userId, username, meeting) {
    try {
        const { error } = await _supabase.from('activity_log').insert({
            user_id: userId,
            username: username,
            activity_type: 'COLLABORATION_APPROVED',
            details: {
                meeting_id: meeting.id,
                meeting_text: meeting.note_text,
                approved_by: meeting.username
            }
        });

        if (error) throw error;
    } catch (err) {
        logError('Error sending approval notification:', err);
    }
}

export async function markItemComplete(noteId) {
    try {
        const { error } = await _supabase.from('deployment_notes').update({ is_completed: true }).eq('id', noteId);
        if (error) throw error;
        showNotification('Success', 'Item marked as completed.', 'success');
    } catch (err) {
        showNotification('Error', 'Failed to update item status.', 'error');
    }
}

export async function deleteScheduleItem(noteId) {
    openConfirmModal('Delete Item', 'Are you sure you want to delete this item?', async () => {
        try {
            // First, fetch the item to get creator information
            const { data: item, error: fetchError } = await _supabase
                .from('deployment_notes')
                .select('user_id, username')
                .eq('id', noteId)
                .single();

            if (fetchError) throw fetchError;

            // Delete the item
            const { error: deleteError } = await _supabase
                .from('deployment_notes')
                .delete()
                .eq('id', noteId);

            if (deleteError) throw deleteError;

            // Deduct 15 points from the creator
            if (item && item.user_id && item.username) {
                await awardPoints('SCHEDULE_ITEM_DELETED', {}, {
                    userId: item.user_id,
                    username: item.username
                });
            }

            showNotification('Success', 'Item deleted.', 'success');
        } catch (err) {
            logError('Error deleting item:', err);
            showNotification('Error', 'Failed to delete item.', 'error');
        }
    });
}

export async function updateScheduleItem() {
    const itemId = document.getElementById('edit-item-id').value;
    const noteText = document.getElementById('edit-item-text').value.trim();
    const itemType = document.getElementById('edit-item-type').value;
    const itemDate = document.getElementById('edit-item-date').value;
    const itemTime = document.getElementById('edit-item-time').value;

    if (!noteText || !itemDate) {
        return showNotification('Missing Information', 'Please ensure details and a date are provided.', 'error');
    }

    const updatePayload = {
        note_text: noteText,
        type: itemType,
        deployment_date: itemDate,
        deployment_time: itemTime || null
    };

    try {
        const { error } = await _supabase.from('deployment_notes').update(updatePayload).eq('id', itemId);
        if (error) throw error;
        showNotification('Success', 'Item updated successfully.', 'success');
        window.ui.closeEditScheduleItemModal();
    } catch (err) {
        logError('Error updating item:', err);
        showNotification('Error', 'Failed to update the item.', 'error');
    }
}

export async function fetchCompletedItems() {
    const historyList = document.getElementById('history-list');
    if (!historyList) return;
    historyList.innerHTML = '<div class="text-center text-gray-400">Loading history...</div>';

    try {
        const { data, error } = await _supabase.from('deployment_notes')
            .select('*')
            .eq('is_completed', true)
            .order('deployment_date', { ascending: false })
            .limit(50);

        if (error) throw error;

        if (data.length === 0) {
            historyList.innerHTML = '<div class="text-center text-gray-400">No completed items found.</div>';
            return;
        }

        historyList.innerHTML = data.map(item => {
            const itemDate = new Date(item.deployment_date + 'T00:00:00').toLocaleDateString();
            const typeIcon = item.type === 'Meeting' ? '🤝' : '🚀';
            return `
            <div class="bg-gray-800/50 p-3 rounded-lg">
                <div class="flex justify-between items-center">
                    <p class="font-semibold text-white">
                        <span class="mr-2">${typeIcon}</span>${item.note_text}
                    </p>
                    <span class="text-xs text-gray-300">${itemDate}</span>
                </div>
                <p class="text-xs text-gray-400 mt-1 pl-7">Added by ${item.username}</p>
            </div>
        `;
        }).join('');

    } catch (err) {
        historyList.innerHTML = '<div class="text-center text-red-400">Error loading history.</div>';
        logError("Error fetching history:", err);
    }
}


// --- TEAM SCHEDULE FUNCTIONS ---

export async function checkScheduleUpdate() {
    try {
        const { data: lastUpdate, error: updateError } = await _supabase.from('activity_log')
            .select('created_at, details')
            .eq('activity_type', 'SCHEDULE_UPDATED')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (updateError && updateError.code !== 'PGRST116') throw updateError;
        if (!lastUpdate) return;

        const { data: { user } } = await _supabase.auth.getUser();
        const lastViewTime = user.user_metadata.last_schedule_view;
        const scheduleBtn = document.getElementById('schedule-btn');
        const scheduleDot = document.getElementById('schedule-dot');

        if (!scheduleBtn || !scheduleDot) return;

        appState.lastScheduleUpdate = lastUpdate;

        if (!lastViewTime || new Date(lastUpdate.created_at) > new Date(lastViewTime)) {
            scheduleBtn.classList.add('glowing-pulse');
            scheduleDot.classList.remove('hidden');
        } else {
            scheduleBtn.classList.remove('glowing-pulse');
            scheduleDot.classList.add('hidden');
        }
    } catch (err) {
        logError('Error checking schedule update:', err);
    }
}

export async function fetchSchedule() {
    const datePicker = document.getElementById('schedule-date-picker');
    const displayDiv = document.getElementById('schedule-display');
    if (!datePicker || !displayDiv) return;

    const date = datePicker.value;
    const dayOfWeek = new Date(date + 'T00:00:00').getDay();
    displayDiv.innerHTML = '<div class="loading-spinner w-8 h-8 mx-auto"></div>';

    try {
        // ⚡ OPTIMIZATION: Select only needed columns
        const { data: overrides, error: overrideError } = await _supabase
            .from('schedules')
            .select('username, date, status, shift_start_time, shift_end_time')
            .eq('team_id', appState.currentUserTeamId)
            .eq('date', date);
        const { data: defaults, error: defaultError } = await _supabase
            .from('default_schedules')
            .select('username, day_of_week, status, shift_start_time, shift_end_time')
            .eq('team_id', appState.currentUserTeamId);
        if (overrideError || defaultError) {
            showNotification('Error', (overrideError || defaultError).message, 'error');
            return;
        }

        const isRecentlyUpdated = appState.lastScheduleUpdate &&
            appState.lastScheduleUpdate.details &&
            appState.lastScheduleUpdate.details.date === date &&
            new Date(appState.lastScheduleUpdate.created_at) > new Date(Date.now() - 24 * 60 * 60 * 1000);

        let scheduleData = [];
        Array.from(appState.allUsers.keys()).forEach(username => {
            const defaultSched = defaults.find(d => d.username === username && d.day_of_week === (dayOfWeek === 0 ? 7 : dayOfWeek)) || { status: 'Not Set' };
            const overrideSched = overrides.find(o => o.username === username);
            const finalSchedule = overrideSched || defaultSched;
            const isOverride = !!overrideSched && (
                overrideSched.status !== defaultSched.status ||
                overrideSched.shift_start_time !== defaultSched.shift_start_time ||
                overrideSched.shift_end_time !== defaultSched.shift_end_time
            );
            scheduleData.push({ username, schedule: finalSchedule, isOverride });
        });

        scheduleData.sort((a, b) => {
            if (a.schedule.status === 'Working' && b.schedule.status !== 'Working') return -1;
            if (a.schedule.status !== 'Working' && b.schedule.status === 'Working') return 1;
            if (a.schedule.shift_start_time < b.schedule.shift_start_time) return -1;
            if (a.schedule.shift_start_time > b.schedule.shift_start_time) return 1;
            return 0;
        });

        displayDiv.innerHTML = '';
        scheduleData.forEach(({ username, schedule, isOverride }) => {
            let scheduleInfo = '<span class="text-gray-400">Not Set</span>';
            let overrideClass = isOverride ? 'bg-indigo-700/50' : 'glassmorphism';
            const redDot = isRecentlyUpdated && isOverride ? '<span class="inline-block w-2 h-2 bg-red-500 rounded-full ml-2 animate-pulse"></span>' : '';
            if (schedule.status === 'Off') {
                scheduleInfo = `<span class="font-bold text-red-400">Off Day</span>`;
            } else if (schedule.status === 'Working') {
                scheduleInfo = `<span class="font-bold text-green-400">${formatTime(schedule.shift_start_time)} - ${formatTime(schedule.shift_end_time)}</span>`;
            }
            displayDiv.innerHTML += `
                <div class="${overrideClass} p-3 rounded-lg flex items-center justify-between border border-gray-600/30">
                    <span class="font-semibold schedule-display-username flex items-center" data-username="${username}">${username}${redDot}</span>
                    ${scheduleInfo}
                </div>`;
        });

        // Apply colors to schedule display usernames
        applyScheduleDisplayColors();
    } catch (err) {
        logError('Error fetching schedule:', err);
        showNotification('Error', 'Failed to fetch schedule', 'error');
    }
}

export async function toggleScheduleEdit(isEditing) {
    // Admin-only check
    if (!appState.isAdmin) {
        showNotification('Access Denied', 'Only admins can edit schedules.', 'error');
        return;
    }

    document.getElementById('schedule-display').classList.toggle('hidden', isEditing);
    document.getElementById('admin-schedule-buttons').classList.toggle('hidden', isEditing);
    document.getElementById('schedule-edit-form').classList.toggle('hidden', !isEditing);
    document.getElementById('schedule-edit-actions').classList.toggle('hidden', !isEditing);
    document.getElementById('schedule-edit-actions').classList.toggle('flex', isEditing);
    document.getElementById('overridden-dates-info').classList.toggle('hidden', isEditing);

    if (isEditing) {
        const date = document.getElementById('schedule-date-picker').value;
        const dayOfWeek = new Date(date + 'T00:00:00').getDay();
        const formDiv = document.getElementById('schedule-edit-form');
        formDiv.innerHTML = '<div class="loading-spinner w-8 h-8 mx-auto"></div>';
        try {
            // ⚡ OPTIMIZATION: Select only needed columns
            const { data: overrides, error: overrideError } = await _supabase
                .from('schedules')
                .select('username, date, status, shift_start_time, shift_end_time')
                .eq('date', date);
            const { data: defaults, error: defaultError } = await _supabase
                .from('default_schedules')
                .select('username, day_of_week, status, shift_start_time, shift_end_time')
                .eq('day_of_week', dayOfWeek === 0 ? 7 : dayOfWeek);
            if (overrideError || defaultError) throw (overrideError || defaultError);

            const userSchedules = new Map();
            Array.from(appState.allUsers.keys()).forEach(name => {
                const override = overrides.find(o => o.username === name);
                const defaultSched = defaults.find(d => d.username === name);
                userSchedules.set(name, override || defaultSched || { status: 'Off', shift_start_time: '09:00', shift_end_time: '17:00' });
            });

            formDiv.innerHTML = '';
            Array.from(userSchedules.entries()).sort().forEach(([username, schedule]) => {
                formDiv.innerHTML += `
                    <div class="glassmorphism p-3 rounded-lg grid grid-cols-4 gap-2 items-center border border-gray-600/30">
                        <span class="font-semibold schedule-edit-username col-span-4 sm:col-span-1" data-username="${username}">${username}</span>
                        <select data-username="${username}" class="schedule-status bg-gray-600/50 p-2 rounded-lg col-span-2 sm:col-span-1 border border-gray-500">
                            <option ${schedule.status === 'Working' ? 'selected' : ''}>Working</option>
                            <option ${schedule.status === 'Off' ? 'selected' : ''}>Off</option>
                        </select>
                        <input type="time" data-username="${username}" value="${schedule.shift_start_time || '09:00'}" class="schedule-start bg-gray-600/50 p-2 rounded-lg border border-gray-500">
                        <input type="time" data-username="${username}" value="${schedule.shift_end_time || '17:00'}" class="schedule-end bg-gray-600/50 p-2 rounded-lg border border-gray-500">
                    </div>`;
            });

            // Apply colors to schedule edit usernames
            applyScheduleEditColors();
        } catch (err) {
            logError('Error setting up schedule edit:', err);
            showNotification('Error', 'Failed to setup schedule editing', 'error');
        }
    }
}

export async function saveSchedule() {
    // Admin-only check
    if (!appState.isAdmin) {
        showNotification('Access Denied', 'Only admins can save schedule changes.', 'error');
        return;
    }

    const date = document.getElementById('schedule-date-picker').value;
    const statusInputs = document.querySelectorAll('.schedule-status');
    const startInputs = document.querySelectorAll('.schedule-start');
    const endInputs = document.querySelectorAll('.schedule-end');

    const upsertData = Array.from(statusInputs).map((statusEl, index) => {
        const username = statusEl.dataset.username;
        const userId = appState.allUsers.get(username);
        if (!userId) return null;
        return {
            user_id: userId,
            username: username,
            date: date,
            status: statusEl.value,
            shift_start_time: startInputs[index].value || null,
            shift_end_time: endInputs[index].value || null,
        };
    }).filter(Boolean);
    if (upsertData.length === 0) return;
    try {
        const { error } = await _supabase.from('schedules').upsert(upsertData, { onConflict: 'user_id, date' });
        if (error) throw error;
        await logActivity('SCHEDULE_UPDATED', { date: date });
        toggleScheduleEdit(false);
        await fetchSchedule();
        await highlightOverriddenDates();
    } catch (err) {
        showNotification('Error Saving Schedule', err.message, 'error');
    }
}

let currentDayTab = 1;
export async function switchDayTab(tab, day) {
    currentDayTab = day;
    document.querySelectorAll('#default-schedule-modal .tab-button').forEach(t => {
        t.classList.remove('bg-indigo-600', 'text-white');
        t.classList.add('text-gray-400');
    });
    tab.classList.add('bg-indigo-600', 'text-white');
    tab.classList.remove('text-gray-400');
    await fetchDefaultSchedule(day);
}

async function fetchDefaultSchedule(day) {
    const formDiv = document.getElementById('default-schedule-form');
    if (!formDiv) return;
    formDiv.innerHTML = '<div class="loading-spinner w-8 h-8 mx-auto"></div>';
    try {
        // ⚡ OPTIMIZATION: Select only needed columns
        const { data, error } = await _supabase
            .from('default_schedules')
            .select('username, day_of_week, status, shift_start_time, shift_end_time')
            .eq('day_of_week', day);
        if (error) throw error;
        const userSchedules = new Map();
        Array.from(appState.allUsers.keys()).forEach(name => userSchedules.set(name, { status: 'Off', shift_start_time: '09:00', shift_end_time: '17:00' }));
        data.forEach(item => userSchedules.set(item.username, item));
        formDiv.innerHTML = '';
        Array.from(userSchedules.entries()).sort().forEach(([username, schedule]) => {
            formDiv.innerHTML += `
                <div class="glassmorphism p-3 rounded-lg grid grid-cols-4 gap-2 items-center border border-gray-600/30">
                    <span class="font-semibold default-schedule-username col-span-4 sm:col-span-1" data-username="${username}">${username}</span>
                    <select data-username="${username}" class="default-schedule-status bg-gray-600/50 p-2 rounded-lg col-span-2 sm:col-span-1 border border-gray-500">
                        <option ${schedule.status === 'Working' ? 'selected' : ''}>Working</option>
                        <option ${schedule.status === 'Off' ? 'selected' : ''}>Off</option>
                    </select>
                    <input type="time" data-username="${username}" value="${schedule.shift_start_time || '09:00'}" class="default-schedule-start bg-gray-600/50 p-2 rounded-lg border border-gray-500">
                    <input type="time" data-username="${username}" value="${schedule.shift_end_time || '17:00'}" class="default-schedule-end bg-gray-600/50 p-2 rounded-lg border border-gray-500">
                </div>`;
        });

        // Apply colors to default schedule form usernames
        applyDefaultScheduleColors();
    } catch (err) {
        showNotification('Error', err.message, 'error');
    }
}

export async function saveDefaultSchedule() {
    // Admin-only check
    if (!appState.isAdmin) {
        showNotification('Access Denied', 'Only admins can save default schedules.', 'error');
        return;
    }

    const statusInputs = document.querySelectorAll('.default-schedule-status');
    const startInputs = document.querySelectorAll('.default-schedule-start');
    const endInputs = document.querySelectorAll('.default-schedule-end');
    const upsertData = Array.from(statusInputs).map((statusEl, index) => {
        const username = statusEl.dataset.username;
        const userId = appState.allUsers.get(username);
        if (!userId) return null;
        return {
            user_id: userId,
            username: username,
            day_of_week: currentDayTab,
            status: statusEl.value,
            shift_start_time: startInputs[index].value || null,
            shift_end_time: endInputs[index].value || null,
        };
    }).filter(Boolean);
    if (upsertData.length === 0) return;
    try {
        const { error } = await _supabase.from('default_schedules').upsert(upsertData, { onConflict: 'user_id, day_of_week' });
        if (error) throw error;
        const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
        await logActivity('DEFAULT_SCHEDULE_SAVED', { day: dayNames[currentDayTab - 1] });
        showNotification('Success', `Default schedule for ${dayNames[currentDayTab - 1]} saved.`, 'success');
    } catch (err) {
        showNotification('Error Saving Defaults', err.message, 'error');
    }
}

export async function highlightOverriddenDates() {
    const infoDiv = document.getElementById('overridden-dates-info');
    const picker = document.getElementById('schedule-date-picker');
    if (!infoDiv || !picker) return;

    const selectedDate = new Date(picker.value + 'T00:00:00');
    const year = selectedDate.getFullYear();
    const month = selectedDate.getMonth();
    const firstDay = new Date(year, month, 1).toISOString().split('T')[0];
    const lastDay = new Date(year, month + 1, 0).toISOString().split('T')[0];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    infoDiv.classList.add('hidden');
    try {
        // ⚡ OPTIMIZATION: Select only needed columns
        const [overridesResult, defaultsResult] = await Promise.all([
            _supabase.from('schedules')
                .select('username, date, status, shift_start_time, shift_end_time')
                .eq('team_id', appState.currentUserTeamId)
                .gte('date', firstDay)
                .lte('date', lastDay),
            _supabase.from('default_schedules')
                .select('username, day_of_week, status, shift_start_time, shift_end_time')
                .eq('team_id', appState.currentUserTeamId)
        ]);
        const { data: overrides, error: overridesError } = overridesResult;
        const { data: defaults, error: defaultsError } = defaultsResult;
        if (overridesError || defaultsError) throw (overridesError || defaultsError);
        const overriddenDates = new Set();
        overrides.forEach(override => {
            const overrideDate = new Date(override.date + 'T00:00:00');
            if (overrideDate >= today) {
                const dayOfWeek = overrideDate.getDay();
                const supabaseDayOfWeek = dayOfWeek === 0 ? 7 : dayOfWeek;
                const defaultSched = defaults.find(d => d.username === override.username && d.day_of_week === supabaseDayOfWeek);
                let isDifferent = true;
                if (defaultSched) {
                    if (override.status === defaultSched.status &&
                        override.shift_start_time === defaultSched.shift_start_time &&
                        override.shift_end_time === defaultSched.shift_end_time) {
                        isDifferent = false;
                    }
                }
                if (isDifferent) {
                    overriddenDates.add(override.date.split('-')[2]);
                }
            }
        });
        if (overriddenDates.size > 0) {
            const monthName = selectedDate.toLocaleString('default', { month: 'long' });
            const sortedDays = Array.from(overriddenDates).map(d => parseInt(d)).sort((a, b) => a - b);
            infoDiv.textContent = `🗓️ Note: The schedule for ${monthName} has overrides on the following days: ${sortedDays.join(', ')}.`;
            infoDiv.classList.remove('hidden');
        }
    } catch (err) {
        logError('Error highlighting overridden dates:', err);
    }
}


// --- SHIFT & ATTENDANCE FUNCTIONS ---

export function updateShiftButton(isInShift, isShiftDoneForDay) {
    const shiftBtn = document.getElementById("shift-btn");
    const footer = document.getElementById('tickets-footer');
    if (!shiftBtn || !footer) return;

    shiftBtn.disabled = false;
    shiftBtn.classList.remove("bg-gray-600", "cursor-not-allowed", "bg-cyan-600", "hover:bg-cyan-700", "bg-orange-600", "hover:bg-orange-700");
    if (isShiftDoneForDay) {
        shiftBtn.textContent = "Shift Ended";
        shiftBtn.disabled = true;
        shiftBtn.classList.add("bg-gray-600", "cursor-not-allowed");
        footer.classList.add('disabled');
    } else if (isInShift) {
        shiftBtn.textContent = "End Shift";
        shiftBtn.classList.add("bg-orange-600", "hover:bg-orange-700");
        footer.classList.remove('disabled');
    } else {
        shiftBtn.textContent = "Start Shift";
        shiftBtn.classList.add("bg-cyan-600", "hover:bg-cyan-700");
        footer.classList.add('disabled');
    }
}

export async function toggleLunchStatus() {
    if (!appState.currentShiftId) {
        return showNotification('Error', 'You must be in a shift to take a break.', 'error');
    }
    try {
        const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
        const myAttendance = appState.attendance.get(myName) || {};
        const isOnLunch = !!myAttendance.lunch_start_time;
        const { error } = await _supabase.from('attendance')
            .update({ on_lunch: !isOnLunch, lunch_start_time: isOnLunch ? null : new Date().toISOString() })
            .eq('id', appState.currentShiftId);
        if (error) throw error;
    } catch (err) {
        showNotification('Error', 'Could not update lunch status.', 'error');
    }
}

export async function fetchAttendance() {
    try {
        const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
        const { data: users, error: usersError } = await _supabase.rpc('get_team_members');
        if (usersError) throw usersError;

        const uniqueUsernames = [...new Set(users.map(u => u.username).filter(Boolean))];

        // ⚡ OPTIMIZATION: Single query instead of N queries - fetch all recent attendance records
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        const { data: allAttendance, error: attendanceError } = await _supabase
            .from('attendance')
            .select('id, username, shift_start, shift_end, on_lunch, lunch_start_time, break_type, break_reason, expected_duration, is_blocked, blocked_reason, blocked_at, total_break_time_minutes, device_type, created_at')
            .in('username', uniqueUsernames)
            .gte('created_at', threeDaysAgo.toISOString())
            .order('created_at', { ascending: false });

        if (attendanceError) {
            logError('Failed to fetch attendance:', attendanceError);
            return;
        }

        // Group by username and get latest for each
        const latestByUsername = new Map();
        if (allAttendance) {
            allAttendance.forEach(record => {
                if (!latestByUsername.has(record.username)) {
                    latestByUsername.set(record.username, record);
                }
            });
        }

        appState.attendance.clear();
        uniqueUsernames.forEach(username => {
            const latestShift = latestByUsername.get(username);
            if (latestShift) {
                const isOnline = !latestShift.shift_end;
                appState.attendance.set(username, {
                    id: latestShift.id,
                    status: isOnline ? 'online' : 'offline',
                    last_shift_start: latestShift.shift_start,
                    on_lunch: latestShift.on_lunch,
                    lunch_start_time: latestShift.lunch_start_time,
                    break_type: latestShift.break_type,
                    break_reason: latestShift.break_reason,
                    expected_duration: latestShift.expected_duration,
                    is_blocked: latestShift.is_blocked,
                    blocked_reason: latestShift.blocked_reason,
                    blocked_at: latestShift.blocked_at,
                    total_break_time_minutes: latestShift.total_break_time_minutes || 0,
                    device_type: latestShift.device_type || 'desktop'
                });
                if (username === myName && isOnline) {
                    appState.currentShiftId = latestShift.id;
                }
            }
        });

        if (appState.currentUser) {
            const myAttendance = appState.attendance.get(myName);
            const isInShift = myAttendance && myAttendance.status === 'online';
            if (!isInShift) { appState.currentShiftId = null; }
            updateShiftButton(isInShift, false);
        }
    } catch (err) {
        logError('Exception fetching attendance:', err);
    }
}

export function toggleShift() {
    appState.currentShiftId ? openConfirmModal('End Shift', 'Are you sure?', endShift) : startShift();
}

async function startShift() {
    try {
        updateShiftButton(true, false);
        const username = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
        const device = detectDeviceType(); // Use improved device detection
        const newShift = {
            user_id: appState.currentUser.id,
            username: username,
            device_type: device,
            team_id: appState.currentUserTeamId
        };
        log(`[Shift Start] Device detected: ${device}`);
        const { data, error } = await _supabase.from('attendance').insert(newShift).select().single();
        if (error) {
            updateShiftButton(false, false);
            throw error;
        }
        awardPoints('SHIFT_STARTED');
        appState.currentShiftId = data.id;
        logActivity('SHIFT_START', {});

        // Check Turtle badge for late shift start
        await checkLateShiftStart(data.shift_start, username);

        // Start periodic device check (every 5 minutes)
        startDeviceCheck();
    } catch (err) {
        showNotification('Error Starting Shift', err.message, 'error');
    }
}

/**
 * Check if user started shift late and award Turtle badge
 * Also adds delay time (if > 10 minutes) to total_break_time_minutes
 */
async function checkLateShiftStart(actualStartTime, username) {
    try {
        const now = new Date(actualStartTime);
        const today = now.toISOString().split('T')[0];
        const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();

        log(`[Late Shift Check] User: ${username}, Start time: ${actualStartTime}`);

        // Get user's schedule for today
        const { data: scheduleOverride, error: overrideError } = await _supabase
            .from('schedules')
            .select('*')
            .eq('user_id', appState.currentUser.id)
            .eq('date', today)
            .maybeSingle();

        const { data: defaultSchedule, error: defaultError } = await _supabase
            .from('default_schedules')
            .select('*')
            .eq('user_id', appState.currentUser.id)
            .eq('day_of_week', dayOfWeek)
            .maybeSingle();

        if (overrideError) logError('[Late Shift Check] Error fetching schedule override:', overrideError);
        if (defaultError) logError('[Late Shift Check] Error fetching default schedule:', defaultError);

        const schedule = scheduleOverride || defaultSchedule;

        log(`[Late Shift Check] Schedule found:`, schedule);

        // Only check if user is supposed to be working and has a scheduled start time
        if (!schedule || schedule.status !== 'Working' || !schedule.shift_start_time) {
            log('[Late Shift Check] No valid schedule found or not working today');
            return;
        }

        // Calculate scheduled start time
        const [startHour, startMinute] = schedule.shift_start_time.split(':').map(Number);
        const scheduledStart = new Date(now);
        scheduledStart.setHours(startHour, startMinute, 0, 0);

        // Calculate delay in minutes
        const delayMinutes = (now - scheduledStart) / 60000;

        log(`[Late Shift Check] Scheduled: ${scheduledStart.toLocaleTimeString()}, Actual: ${now.toLocaleTimeString()}, Delay: ${Math.floor(delayMinutes)} minutes`);

        // If late by more than 10 minutes, add delay to total_break_time_minutes
        if (delayMinutes > 10) {
            log(`[Late Shift Check] User is more than 10 minutes late! Adding ${Math.floor(delayMinutes)} minutes to break time`);

            // Get current attendance record
            const { data: attendance, error: attendanceError } = await _supabase
                .from('attendance')
                .select('total_break_time_minutes')
                .eq('id', appState.currentShiftId)
                .single();

            if (attendanceError) {
                logError('[Late Shift Check] Error fetching attendance:', attendanceError);
            } else {
                const currentBreakTime = attendance?.total_break_time_minutes || 0;
                const newBreakTime = currentBreakTime + Math.floor(delayMinutes);

                // Update total_break_time_minutes with the delay
                const { error: updateError } = await _supabase
                    .from('attendance')
                    .update({ total_break_time_minutes: newBreakTime })
                    .eq('id', appState.currentShiftId);

                if (updateError) {
                    logError('[Late Shift Check] Error updating break time:', updateError);
                } else {
                    log(`[Late Shift Check] Successfully added ${Math.floor(delayMinutes)} minutes to break time. New total: ${newBreakTime} minutes`);
                    showNotification(
                        'Late Arrival Penalty',
                        `You arrived ${Math.floor(delayMinutes)} minutes late. This has been added to your break time.`,
                        'warning'
                    );
                }
            }
        }

        // If late by more than 15 minutes, award Turtle badge
        if (delayMinutes > 15) {
            log(`[Late Shift Check] User is late! Awarding Turtle badge`);

            // Use optional chaining and wait for badges to be available
            if (window.badges?.checkTurtleBadge) {
                window.badges.checkTurtleBadge(
                    appState.currentUser.id,
                    username,
                    'late_shift',
                    Math.floor(delayMinutes)
                );
            } else {
                logError('[Late Shift Check] window.badges.checkTurtleBadge is not available yet');
                // Retry after a short delay to ensure badges module is loaded
                setTimeout(() => {
                    if (window.badges?.checkTurtleBadge) {
                        window.badges.checkTurtleBadge(
                            appState.currentUser.id,
                            username,
                            'late_shift',
                            Math.floor(delayMinutes)
                        );
                    } else {
                        logError('[Late Shift Check] Still unable to call checkTurtleBadge after retry');
                    }
                }, 1000);
            }
        } else if (delayMinutes > 0 && delayMinutes <= 15) {
            log(`[Late Shift Check] User is late but within grace period (${Math.floor(delayMinutes)} min)`);
        } else {
            log(`[Late Shift Check] User is on time or early`);
        }
    } catch (err) {
        logError('[Schedule] Error checking late shift:', err);
    }
}

async function endShift() {
    clearLunchTimer();
    stopDeviceCheck(); // Stop device checking when shift ends
    try {
        if (!appState.currentShiftId) {
            throw new Error("No active shift found to end.");
        }
        const { error } = await _supabase.from('attendance')
            .update({ shift_end: new Date().toISOString() })
            .eq('id', appState.currentShiftId);
        if (error) throw error;
        logActivity('SHIFT_END', {});
        updateShiftButton(false, false);
        appState.currentShiftId = null;
    } catch (err) {
        showNotification('Error Ending Shift', err.message, 'error');
    }
}

export async function autoEndStaleShifts() {
    try {
        const { data: activeShifts, error: shiftsError } = await _supabase
            .from('attendance').select('id, username, shift_start').is('shift_end', null);

        if (shiftsError) throw shiftsError;
        if (activeShifts.length === 0) return;

        // ⚡ OPTIMIZATION: Only select needed columns and filter by date range
        const today = new Date();
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(today.getDate() - 7);
        const sevenDaysAgoStr = sevenDaysAgo.toISOString().split('T')[0];

        const { data: allOverrides, error: overridesError } = await _supabase
            .from('schedules')
            .select('username, date, status, shift_end_time')
            .eq('team_id', appState.currentUserTeamId)
            .gte('date', sevenDaysAgoStr);
        if (overridesError) throw overridesError;

        const { data: allDefaults, error: defaultsError } = await _supabase
            .from('default_schedules')
            .select('username, day_of_week, status, shift_end_time')
            .eq('team_id', appState.currentUserTeamId);
        if (defaultsError) throw defaultsError;

        const updatesToPerform = [];
        for (const shift of activeShifts) {
            const shiftStartDate = new Date(shift.shift_start);
            const shiftDateStr = shiftStartDate.toISOString().split('T')[0];
            const dayOfWeek = shiftStartDate.getDay() === 0 ? 7 : shiftStartDate.getDay();
            let userSchedule = allOverrides.find(s => s.username === shift.username && s.date === shiftDateStr) ||
                allDefaults.find(d => d.username === shift.username && d.day_of_week === dayOfWeek);

            if (userSchedule && userSchedule.status === 'Working' && userSchedule.shift_end_time) {
                const [endHour, endMinute] = userSchedule.shift_end_time.split(':').map(Number);
                const scheduledEndTime = new Date(shift.shift_start);
                scheduledEndTime.setHours(endHour, endMinute, 0, 0);
                if (shiftStartDate > scheduledEndTime) scheduledEndTime.setDate(scheduledEndTime.getDate() + 1);
                const cutOffTime = new Date(scheduledEndTime.getTime() + 5 * 60 * 60 * 1000);
                if (new Date() > cutOffTime) {
                    updatesToPerform.push({
                        id: shift.id,
                        shift_end: scheduledEndTime.toISOString()
                    });
                }
            }
        }
        if (updatesToPerform.length > 0) {
            for (const update of updatesToPerform) {
                const { error: updateError } = await _supabase
                    .from('attendance')
                    .update({ shift_end: update.shift_end })
                    .eq('id', update.id);
                if (updateError) logError(`Failed to auto-end shift ID ${update.id}:`, updateError);
            }
            showNotification('System Notice', `${updatesToPerform.length} overdue shift(s) have been automatically ended.`, 'info', false);
        }
    } catch (err) {
        logError("Error in autoEndStaleShifts:", err);
    }
}

// js/schedule.js


export async function renderScheduleAdjustments() {
    const adjustmentsContainer = document.getElementById('schedule-adjustments');
    if (!adjustmentsContainer) return;
    adjustmentsContainer.innerHTML = '';

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Get date 30 days from now
    const next30Days = new Date(today);
    next30Days.setDate(next30Days.getDate() + 30);
    const next30DaysStr = next30Days.toISOString().split('T')[0];

    try {
        // ⚡ OPTIMIZATION: Only select needed columns
        const { data: overrides, error: overridesError } = await _supabase
            .from('schedules')
            .select('username, date, status, shift_start_time, shift_end_time')
            .gte('date', todayStr)
            .lte('date', next30DaysStr)
            .order('date', { ascending: true });

        if (overridesError) throw overridesError;

        const { data: defaults, error: defaultsError } = await _supabase
            .from('default_schedules')
            .select('username, day_of_week, status, shift_start_time, shift_end_time');

        if (defaultsError) throw defaultsError;

        const adjustmentsToShow = [];
        (overrides || []).forEach(override => {
            const overrideDate = new Date(override.date + 'T00:00:00');
            const dayOfWeek = overrideDate.getDay() === 0 ? 7 : overrideDate.getDay();
            const defaultSched = defaults.find(d => d.username === override.username && d.day_of_week === dayOfWeek);

            let isDifferent = false;

            // Case 1: No default schedule exists - treat as if default is 'Off'
            if (!defaultSched) {
                // Show only if override is 'Working' (changing from implicit 'Off' to 'Working')
                if (override.status === 'Working') {
                    isDifferent = true;
                }
            } else {
                // Case 2: Default schedule exists - compare all fields
                if (override.status !== defaultSched.status ||
                    override.shift_start_time !== defaultSched.shift_start_time ||
                    override.shift_end_time !== defaultSched.shift_end_time) {
                    isDifferent = true;
                }
            }

            // Show adjustment if it's different AND user is working (only show working adjustments)
            if (isDifferent && override.status === 'Working') {
                adjustmentsToShow.push({
                    username: override.username,
                    date: override.date,
                    startTime: override.shift_start_time,
                    endTime: override.shift_end_time
                });
            }
        });

        if (adjustmentsToShow.length === 0) {
            adjustmentsContainer.innerHTML = '<p class="text-xs text-center text-gray-400">No working time adjustments.</p>';
            return;
        }

        // Sort by date and time
        adjustmentsToShow.sort((a, b) => new Date(a.date) - new Date(b.date) || a.startTime.localeCompare(b.startTime));

        // Group adjustments by date
        const groupedByDate = {};
        adjustmentsToShow.forEach(adj => {
            if (!groupedByDate[adj.date]) {
                groupedByDate[adj.date] = [];
            }
            groupedByDate[adj.date].push(adj);
        });

        // Render grouped adjustments with collapsible dates
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const dates = Object.keys(groupedByDate);
        dates.forEach((date, index) => {
            const adjustments = groupedByDate[date];
            const adjDate = new Date(date + 'T00:00:00');
            const isFirstDate = index === 0; // First date should be expanded

            // Determine date label
            let dateLabel = '';
            let isToday = false;
            let isTomorrow = false;

            if (date === todayStr) {
                dateLabel = '📅 Today';
                isToday = true;
            } else if (date === tomorrowStr) {
                dateLabel = '📅 Tomorrow';
                isTomorrow = true;
            } else {
                dateLabel = '📅 ' + adjDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
            }

            const uniqueId = `schedule-adj-${date}`;

            // Create collapsible date header with adjustments group
            adjustmentsContainer.innerHTML += `
            <div class="mb-3">
                <button
                    onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.collapse-icon').classList.toggle('rotate-180'); const txt = this.querySelector('.collapse-text'); txt.textContent = txt.textContent === 'Collapse' ? 'Expand' : 'Collapse';"
                    class="w-full flex items-center gap-2 mb-2 cursor-pointer hover:opacity-80 transition-opacity">
                    <h4 class="text-xs font-bold ${isToday ? 'text-red-300' : isTomorrow ? 'text-amber-300' : 'text-indigo-300'}">${dateLabel}</h4>
                    <div class="flex-1 h-px ${isToday ? 'bg-red-500/30' : isTomorrow ? 'bg-amber-500/30' : 'bg-indigo-500/30'}"></div>
                    <span class="collapse-text text-[10px] ${isToday ? 'text-red-300' : isTomorrow ? 'text-amber-300' : 'text-indigo-300'}">${isFirstDate ? 'Collapse' : 'Expand'}</span>
                    <span class="collapse-icon text-xs ${isToday ? 'text-red-300' : isTomorrow ? 'text-amber-300' : 'text-indigo-300'} transition-transform ${isFirstDate ? 'rotate-180' : ''}">▼</span>
                </button>
                <div class="space-y-2 pl-2 ${isFirstDate ? '' : 'hidden'}">
                    ${adjustments.map(adj => {
                        const timeInfo = `${formatTime(adj.startTime)} - ${formatTime(adj.endTime)}`;
                        return `
                        <div class="p-2 rounded-lg bg-gray-800/10 border ${isToday ? 'border-red-500/40 border-l-4 border-l-red-500' : isTomorrow ? 'border-amber-500/40 border-l-4 border-l-amber-500' : 'border-indigo-600/30 border-l-4 border-l-indigo-500'} text-xs">
                            <p class="font-semibold schedule-adj-username" data-username="${adj.username}">${adj.username}</p>
                            <p class="text-gray-300"><span class="font-semibold text-indigo-300">${timeInfo}</span></p>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        });

        // Apply user colors to schedule adjustment usernames
        await applyScheduleAdjustmentColors();

    } catch (err) {
        logError('Error fetching schedule adjustments:', err);
        adjustmentsContainer.innerHTML = '<p class="text-xs text-center text-red-400">Error loading adjustments.</p>'; // Changed text size
    }
}

/**
 * Apply user colors to schedule adjustment usernames dynamically
 * This finds all .schedule-adj-username elements and applies their assigned colors
 */
async function applyScheduleAdjustmentColors() {
    const adjustmentUsernames = document.querySelectorAll('.schedule-adj-username[data-username]');

    // ⚡ OPTIMIZATION: Batch fetch all user colors at once
    const usernames = Array.from(adjustmentUsernames).map(el => el.getAttribute('data-username')).filter(Boolean);
    const userColorsMap = await ui.getBatchUserColors(usernames);

    for (const element of adjustmentUsernames) {
        const username = element.getAttribute('data-username');
        if (username) {
            const colorObj = userColorsMap.get(username) || await ui.getUserColor(username);
            element.style.color = colorObj.rgb;
        }
    }
}

export async function checkShiftReminders() {
    if (!appState.currentUser || !appState.allUsers.size) return;
    const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
    const reminderContainer = document.getElementById('shift-reminder-container');
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    const dayOfWeek = today.getDay() === 0 ? 7 : today.getDay();
    // ⚡ OPTIMIZATION: Select only needed columns
    const { data, error: overrideError } = await _supabase
        .from('schedules')
        .select('username, date, status, shift_start_time, shift_end_time')
        .eq('username', myName)
        .eq('date', todayStr);
    if (overrideError) logError("Error fetching schedule override:", overrideError);
    const override = data && data.length > 0 ? data[0] : null;
    let schedule = override;
    if (!schedule) {
        const { data: defaultSched, error: defaultError } = await _supabase
            .from('default_schedules')
            .select('username, day_of_week, status, shift_start_time, shift_end_time')
            .eq('username', myName)
            .eq('day_of_week', dayOfWeek)
            .single();
        if (defaultError && defaultError.code !== 'PGRST116') logError(defaultError);
        schedule = defaultSched;
    }
    if (!schedule || schedule.status !== 'Working' || !schedule.shift_start_time || !schedule.shift_end_time) {
        if (reminderContainer) reminderContainer.textContent = '';
        return;
    }
    const [startHour, startMinute] = schedule.shift_start_time.split(':').map(Number);
    const shiftStartTime = new Date();
    shiftStartTime.setHours(startHour, startMinute, 0, 0);
    const [endHour, endMinute] = schedule.shift_end_time.split(':').map(Number);
    const shiftEndTime = new Date();
    shiftEndTime.setHours(endHour, endMinute, 0, 0);
    const shiftEndReminderTime = new Date(shiftEndTime.getTime() - 10 * 60 * 1000);
    const myAttendance = appState.attendance.get(myName);
    const isInShift = myAttendance && myAttendance.status === 'online';
    if (!isInShift && today >= shiftStartTime && today < shiftEndTime) {
        reminderContainer.textContent = "Time to start your shift!";
    } else if (isInShift && today >= shiftEndReminderTime && today < shiftEndTime) {
        const minutesLeft = Math.round((shiftEndTime - today) / 60000);
        reminderContainer.textContent = `Shift ends in ${minutesLeft} min!`;
    } else {
        if (reminderContainer) reminderContainer.textContent = '';
    }
}

export function startShiftReminders() {
    if (shiftReminderInterval) clearInterval(shiftReminderInterval);
    shiftReminderInterval = setInterval(checkShiftReminders, 60000);
    checkShiftReminders();

    if (autoEndShiftInterval) clearInterval(autoEndShiftInterval);
    autoEndShiftInterval = setInterval(autoEndStaleShifts, 15 * 60 * 1000);
    autoEndStaleShifts();
}

/**
 * Start periodic device check (every 5 minutes)
 * Updates the device_type in attendance table if it changes
 */
function startDeviceCheck() {
    // Clear existing interval if any
    if (deviceCheckInterval) {
        clearInterval(deviceCheckInterval);
    }

    log('%c[Device Check] 🚀 Starting periodic device checks (every 5 minutes)', 'color: #6366f1; font-weight: bold; font-size: 14px');
    log('[Device Check] ⏰ Interval: 300000ms (5 minutes)');
    log('[Device Check] 💾 Database: attendance table | Field: device_type');

    // Check immediately
    log('[Device Check] 🔍 Performing initial device check...');
    checkAndUpdateDevice();

    // Then check every 5 minutes (300000 ms)
    deviceCheckInterval = setInterval(() => {
        log(`%c[Device Check] ⏱️ Periodic check triggered (interval: 5 min)`, 'color: #8b5cf6');
        checkAndUpdateDevice();
    }, 300000);
}

/**
 * Stop periodic device check
 */
function stopDeviceCheck() {
    if (deviceCheckInterval) {
        clearInterval(deviceCheckInterval);
        deviceCheckInterval = null;
        log('[Device Check] Stopped periodic device checks');
    }
}

/**
 * Check current device and update if changed
 */
async function checkAndUpdateDevice() {
    if (!appState.currentShiftId) {
        log('[Device Check] ❌ No active shift, skipping device check');
        return;
    }

    try {
        const currentDevice = detectDeviceType();
        const username = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
        const timestamp = new Date().toLocaleTimeString();

        log(`%c[Device Check] 🔍 Checking device at ${timestamp} for user: ${username}`, 'color: #2563eb; font-weight: bold');
        log(`[Device Check] 📱 Current device detected: ${currentDevice}`);

        // Get current device from database
        log(`[Device Check] 🔄 Fetching device_type from attendance table (ID: ${appState.currentShiftId})`);
        const { data: attendance, error: fetchError } = await _supabase
            .from('attendance')
            .select('device_type, id, username')
            .eq('id', appState.currentShiftId)
            .single();

        if (fetchError) {
            logError('%c[Device Check] ❌ Error fetching from attendance table:', 'color: #ef4444; font-weight: bold', fetchError);
            logError('[Device Check] Error details:', { fetchError, shiftId: appState.currentShiftId });
            return;
        }

        const previousDevice = attendance?.device_type;
        log(`[Device Check] 💾 Previous device in DB: ${previousDevice || 'N/A'}`);

        // Only update if device changed
        if (previousDevice !== currentDevice) {
            log(`%c[Device Check] 🔄 Device CHANGED from '${previousDevice}' → '${currentDevice}' - Updating database...`, 'color: #f59e0b; font-weight: bold');

            const { error: updateError } = await _supabase
                .from('attendance')
                .update({ device_type: currentDevice })
                .eq('id', appState.currentShiftId);

            if (updateError) {
                logError('%c[Device Check] ❌ Error updating attendance table:', 'color: #ef4444; font-weight: bold', updateError);
                logError('[Device Check] Update failed for:', { shiftId: appState.currentShiftId, newDevice: currentDevice, error: updateError });
            } else {
                log(`%c[Device Check] ✅ Successfully updated attendance table: device_type = '${currentDevice}'`, 'color: #10b981; font-weight: bold');
                log('[Device Check] Table: attendance | Field: device_type | Value:', currentDevice);

                // Update local attendance map to trigger UI refresh
                const currentAttendance = appState.attendance.get(username);
                if (currentAttendance) {
                    currentAttendance.device_type = currentDevice;
                    appState.attendance.set(username, currentAttendance);
                    log(`[Device Check] ✅ Updated local state for ${username}: device_type = '${currentDevice}'`);
                } else {
                    logWarn(`[Device Check] ⚠️ Could not find local attendance for user: ${username}`);
                }
            }
        } else {
            log(`%c[Device Check] ✅ Device unchanged: '${currentDevice}'`, 'color: #06b6d4');
            log(`[Device Check] No database update needed`);
        }
    } catch (err) {
        logError('%c[Device Check] ❌ Exception in checkAndUpdateDevice:', 'color: #ef4444; font-weight: bold', err);
        logError('[Device Check] Stack trace:', err.stack);
    }
}

