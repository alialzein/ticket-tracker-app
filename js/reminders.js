// js/reminders.js - Reminder notification system for deployment notes (meetings and deployments)
// This system automatically sends reminders 30 and 15 minutes before scheduled deployment notes

import { _supabase } from './config.js';
import { showNotification } from './ui.js';
import { log, logError } from './logger.js';
import { appState } from './state.js';

/**
 * Initialize reminders system - listen for incoming reminders
 */
export function initializeReminders(currentUserId) {
    log('[Reminders] Initializing reminder system');

    // Subscribe to status_changes for reminders - all users receive broadcast reminders
    const channel = _supabase
        .channel('reminder-notifications')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'status_changes',
            filter: `status_type=eq.reminder`
        }, (payload) => {
            log('[Reminders] New reminder received:', payload);
            handleIncomingReminder(payload.new);
        })
        .subscribe((status) => {
            log('[Reminders] Subscription status:', status);
            if (status === 'SUBSCRIBED') {
                log('[Reminders] ✓ Successfully subscribed to reminder notifications');
            } else if (status === 'CHANNEL_ERROR') {
                logError('[Reminders] ✗ Failed to subscribe - channel error');
            } else if (status === 'TIMED_OUT') {
                logError('[Reminders] ✗ Subscription timed out');
            }
        });

    log('[Reminders] Subscription initiated');
}

/**
 * Dismiss a reminder by ID
 */
function dismissReminder(reminderId) {
    const modal = document.getElementById(reminderId);
    if (modal) {
        modal.remove();
        log('[Reminders] Reminder dismissed:', reminderId);
    }
}

// Expose dismissReminder globally for onclick handlers
window.dismissReminder = dismissReminder;

/**
 * Handle incoming reminder notification
 */
async function handleIncomingReminder(statusChange) {
    try {
        const reminderData = JSON.parse(statusChange.message);
        const { title, type, scheduled_time, minutes_before, note_id } = reminderData;

        // Team-scope check: only show reminders that belong to this user's team
        if (note_id && appState.currentUserTeamId) {
            const { data: note } = await _supabase
                .from('deployment_notes')
                .select('team_id')
                .eq('id', note_id)
                .maybeSingle();
            if (note && note.team_id !== appState.currentUserTeamId) {
                log('[Reminders] Reminder skipped — belongs to a different team');
                return;
            }
        }

        // Parse the scheduled_time and add 2 hours to convert from UTC back to GMT+2
        // The edge function subtracts 2 hours for comparison, so we need to add it back for display
        const scheduledDate = new Date(scheduled_time);
        const localTime = new Date(scheduledDate.getTime() + (2 * 60 * 60 * 1000));
        const timeString = localTime.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });

        const typeIcon = type === 'Meeting' ? '📅' : '🚀';
        const typeLabel = type || 'Event';

        // Create unique reminder ID
        const reminderId = `reminder-${note_id}-${minutes_before}`;

        // Show notification in center of screen
        showReminderModal(reminderId, {
            title: `${typeIcon} ${typeLabel} Reminder`,
            subtitle: title,
            time: `Starting at ${timeString}`,
            minutesBefore: minutes_before
        });

        // Also show regular notification
        showNotification(
            `${typeIcon} ${typeLabel} in ${minutes_before} minutes`,
            `${title} - Starting at ${timeString}`,
            'info'
        );

    } catch (err) {
        logError('[Reminders] Error handling incoming reminder:', err);
    }
}

/**
 * Show reminder modal in center of screen
 */
function showReminderModal(reminderId, { title, subtitle, time, minutesBefore }) {
    // Create modal overlay
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

    // Add animation style if not exists
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

    // Play sound alert (if available)
    try {
        const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBjGH0fPTgjMGHm7A7+OZVRALBVU');
        audio.volume = 0.3;
        audio.play().catch(() => {});
    } catch (err) {}
}

export default {
    initializeReminders
};
