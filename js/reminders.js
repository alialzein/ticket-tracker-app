// js/reminders.js - Reminder notification system for deployment notes

import { _supabase } from './config.js';
import { showNotification } from './ui.js';
import { log, logError } from './logger.js';
import { appState } from './state.js';

let reminderChannel = null;
let reminderRetryTimer = null;
let reminderRetryAttempt = 0;

function scheduleReminderReconnect(currentUserId, reason) {
    if (reminderRetryTimer) return;
    const backoffMs = Math.min(3000 * Math.pow(2, reminderRetryAttempt), 30000);
    const jitterMs = Math.floor(Math.random() * 1000);
    const delayMs = backoffMs + jitterMs;

    reminderRetryTimer = setTimeout(async () => {
        reminderRetryTimer = null;
        reminderRetryAttempt = Math.min(reminderRetryAttempt + 1, 5);
        log(`[Reminders] Reconnecting (${reason}) after ${delayMs}ms`);
        await initializeReminders(currentUserId, true);
    }, delayMs);
}

/**
 * Initialize reminders system - listen for incoming reminders
 */
export async function initializeReminders(currentUserId, isRetry = false) {
    log('[Reminders] Initializing reminder system');
    if (!currentUserId) return;

    // Ensure stale channel is fully removed before creating a new one.
    if (reminderChannel) {
        await _supabase.removeChannel(reminderChannel);
        reminderChannel = null;
    }

    const topic = `reminder-notifications:${currentUserId}:${Date.now()}`;
    reminderChannel = _supabase
        .channel(topic)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'status_changes',
            filter: 'status_type=eq.reminder'
        }, (payload) => {
            log('[Reminders] New reminder received:', payload);
            handleIncomingReminder(payload.new);
        })
        .subscribe((status, err) => {
            log('[Reminders] Subscription status:', status);
            if (status === 'SUBSCRIBED') {
                reminderRetryAttempt = 0;
                return;
            }
            if (status === 'CHANNEL_ERROR') {
                logError('[Reminders] Failed to subscribe - channel error', err || '');
                scheduleReminderReconnect(currentUserId, 'channel_error');
                return;
            }
            if (status === 'TIMED_OUT') {
                logError('[Reminders] Subscription timed out');
                scheduleReminderReconnect(currentUserId, 'timed_out');
            }
        });

    if (!window.auxSupabaseSubscriptions) window.auxSupabaseSubscriptions = [];
    if (!window.auxSupabaseSubscriptions.includes(reminderChannel)) {
        window.auxSupabaseSubscriptions.push(reminderChannel);
    }

    if (!isRetry) {
        log('[Reminders] Subscription initiated');
    }
}

export async function cleanupReminders() {
    if (reminderRetryTimer) {
        clearTimeout(reminderRetryTimer);
        reminderRetryTimer = null;
    }
    reminderRetryAttempt = 0;

    if (reminderChannel) {
        await _supabase.removeChannel(reminderChannel);
        reminderChannel = null;
    }
}

function dismissReminder(reminderId) {
    const modal = document.getElementById(reminderId);
    if (modal) {
        modal.remove();
        log('[Reminders] Reminder dismissed:', reminderId);
    }
}

window.dismissReminder = dismissReminder;

async function handleIncomingReminder(statusChange) {
    try {
        const reminderData = JSON.parse(statusChange.message);
        const { title, type, minutes_before, note_id } = reminderData;

        let rawTime = null;
        if (note_id) {
            const { data: note } = await _supabase
                .from('deployment_notes')
                .select('team_id, deployment_time')
                .eq('id', note_id)
                .maybeSingle();

            if (note) {
                if (appState.currentUserTeamId && note.team_id !== appState.currentUserTeamId) {
                    log('[Reminders] Reminder skipped - belongs to a different team');
                    return;
                }
                rawTime = note.deployment_time;
            }
        }

        let timeString;
        if (rawTime && /^\d{2}:\d{2}/.test(rawTime)) {
            const [h, m] = rawTime.split(':');
            const hour = parseInt(h, 10);
            const ampm = hour >= 12 ? 'PM' : 'AM';
            const display = (hour % 12) || 12;
            timeString = `${display}:${m.padStart(2, '0')} ${ampm}`;
        } else {
            timeString = `in ${minutes_before} min`;
        }

        const typeIcon = type === 'Meeting' ? '📅' : '🚀';
        const typeLabel = type || 'Event';
        const reminderId = `reminder-${note_id}-${minutes_before}`;

        showReminderModal(reminderId, {
            title: `${typeIcon} ${typeLabel} Reminder`,
            subtitle: title,
            time: `Starting at ${timeString}`,
            minutesBefore: minutes_before
        });

        showNotification(
            `${typeIcon} ${typeLabel} in ${minutes_before} minutes`,
            `${title} - Starting at ${timeString}`,
            'info'
        );
    } catch (err) {
        logError('[Reminders] Error handling incoming reminder:', err);
    }
}

function showReminderModal(reminderId, { title, subtitle, time, minutesBefore }) {
    const modal = document.createElement('div');
    modal.id = reminderId;
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg shadow-2xl max-w-md w-full mx-4 transform scale-95 animate-scale-in">
            <div class="p-6">
                <div class="flex items-start justify-between mb-4">
                    <div class="flex-1">
                        <h2 class="text-2xl font-bold text-white mb-1">${title}</h2>
                        <p class="text-lg text-blue-400 font-semibold">${subtitle}</p>
                    </div>
                    <button onclick="window.dismissReminder('${reminderId}')" class="text-gray-400 hover:text-white transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div class="bg-gray-700 rounded-lg p-4 mb-4">
                    <div class="flex items-center justify-between">
                        <span class="text-gray-400">Starts in:</span>
                        <span class="text-2xl font-bold text-yellow-400">${minutesBefore} minutes</span>
                    </div>
                    <div class="flex items-center justify-between mt-2">
                        <span class="text-gray-400">Time:</span>
                        <span class="text-white font-semibold">${time}</span>
                    </div>
                </div>

                <button onclick="window.dismissReminder('${reminderId}')" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors">
                    Got it!
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    if (!document.getElementById('reminder-animation-style')) {
        const style = document.createElement('style');
        style.id = 'reminder-animation-style';
        style.textContent = `
            @keyframes scale-in {
                from { transform: scale(0.9); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
            }
            .animate-scale-in {
                animation: scale-in 0.3s ease-out;
            }
        `;
        document.head.appendChild(style);
    }
}

export default {
    initializeReminders,
    cleanupReminders
};
