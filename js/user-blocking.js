import { log, logError, logWarn } from './logger.js';
// User Blocking System for Excessive Break Time
import { _supabase } from './config.js';
import { appState } from './state.js';
import { showNotification } from './ui.js';

const WARNING_BREAK_MINUTES = 60;  // Show warning at 60 minutes
const MAX_BREAK_MINUTES = 80;      // Penalty at 80 minutes
const PENALTY_POINTS = -50;        // Penalty amount
let blockCheckInterval = null;
let warningShown = false;  // Track if warning has been shown for current break

/**
 * Initialize user blocking system
 * Checks every minute if current user has exceeded break time
 */
export function initializeUserBlocking() {
    // Blocking system disabled
}

/**
 * Check if current user has exceeded break time limit
 */
async function checkCurrentUserBreakTime() {
    // Blocking system disabled
}

/**
 * Penalize the current user with points penalty
 */
async function blockCurrentUser(totalBreakMinutes) {
    // Blocking system disabled
}

/**
 * Show persistent break time warning
 */
function showBreakWarning(currentMinutes) {
    const remainingMinutes = MAX_BREAK_MINUTES - currentMinutes;

    // Create warning banner if it doesn't exist
    let warningBanner = document.getElementById('break-warning-banner');
    if (!warningBanner) {
        warningBanner = document.createElement('div');
        warningBanner.id = 'break-warning-banner';
        warningBanner.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-[9998] max-w-2xl mx-4';

        // Change message based on whether we're at the limit or approaching it
        const isAtLimit = remainingMinutes <= 0;
        const warningClass = isAtLimit ? 'from-red-600 to-red-700 border-red-400' : 'from-yellow-600 to-orange-600 border-yellow-400';
        const warningTitle = isAtLimit ? '🚨 LIMIT REACHED!' : '⚠️ Break Time Warning';
        const warningMessage = isAtLimit
            ? `You have reached ${currentMinutes} minutes of total break time (limit: ${MAX_BREAK_MINUTES} minutes).<br><strong class="text-red-200 text-lg">${PENALTY_POINTS} points will be deducted immediately!</strong>`
            : `You have been on break for <strong>${currentMinutes} minutes</strong>.<br><strong class="text-red-200">${PENALTY_POINTS} points</strong> will be deducted in <strong class="text-xl">${remainingMinutes} minutes</strong> if you don't end your break.`;

        warningBanner.innerHTML = `
            <div class="bg-gradient-to-r ${warningClass} border-2 rounded-lg shadow-2xl p-4 animate-pulse-slow">
                <div class="flex items-start gap-4">
                    <div class="flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div class="flex-grow">
                        <h3 class="text-white font-bold text-lg mb-1">${warningTitle}</h3>
                        <p class="text-white text-sm mb-2">
                            ${warningMessage}
                        </p>
                        <p class="text-yellow-100 text-xs">
                            Maximum allowed break time: ${MAX_BREAK_MINUTES} minutes. ${isAtLimit ? 'End your break NOW!' : 'Please end your break soon to avoid the score penalty.'}
                        </p>
                    </div>
                    <button onclick="window.userBlocking.dismissWarning()" class="flex-shrink-0 text-white hover:text-gray-200 transition-colors p-1" title="Close warning">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(warningBanner);

        // Add custom animation style
        if (!document.getElementById('warning-animation-style')) {
            const style = document.createElement('style');
            style.id = 'warning-animation-style';
            style.textContent = `
                @keyframes pulse-slow {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.02); }
                }
                .animate-pulse-slow {
                    animation: pulse-slow 2s ease-in-out infinite;
                }
            `;
            document.head.appendChild(style);
        }
    } else {
        // Update existing warning with current time
        const isAtLimit = remainingMinutes <= 0;
        const warningClass = isAtLimit ? 'from-red-600 to-red-700 border-red-400' : 'from-yellow-600 to-orange-600 border-yellow-400';
        const warningTitle = isAtLimit ? '🚨 LIMIT REACHED!' : '⚠️ Break Time Warning';
        const warningMessage = isAtLimit
            ? `You have reached ${currentMinutes} minutes of total break time (limit: ${MAX_BREAK_MINUTES} minutes).<br><strong class="text-red-200 text-lg">${PENALTY_POINTS} points will be deducted immediately!</strong>`
            : `You have been on break for <strong>${currentMinutes} minutes</strong>.<br><strong class="text-red-200">${PENALTY_POINTS} points</strong> will be deducted in <strong class="text-xl">${remainingMinutes} minutes</strong> if you don't end your break.`;

        const warningDiv = warningBanner.querySelector('div');
        if (warningDiv) {
            warningDiv.className = `bg-gradient-to-r ${warningClass} border-2 rounded-lg shadow-2xl p-4 animate-pulse-slow`;
        }

        const titleElement = warningBanner.querySelector('h3');
        const messageElement = warningBanner.querySelector('p.text-white');
        const footerElement = warningBanner.querySelector('p.text-yellow-100');

        if (titleElement) titleElement.innerHTML = warningTitle;
        if (messageElement) messageElement.innerHTML = warningMessage;
        if (footerElement) footerElement.textContent = `Maximum allowed break time: ${MAX_BREAK_MINUTES} minutes. ${isAtLimit ? 'End your break NOW!' : 'Please end your break soon to avoid the score penalty.'}`;

        warningBanner.classList.remove('hidden');
    }
}

/**
 * Hide break time warning
 */
function hideBreakWarning() {
    const warningBanner = document.getElementById('break-warning-banner');
    if (warningBanner) {
        warningBanner.classList.add('hidden');
    }
}

/**
 * Show penalty notification
 */
function showPenaltyNotification(reason, totalBreakMinutes) {
    // Show a notification instead of blocking the page
    showNotification(
        '🚨 Break Time Limit Reached - Penalty Applied!',
        `You have reached ${totalBreakMinutes} minutes of total break time (limit: ${MAX_BREAK_MINUTES} minutes).\n\n` +
        `❌ ${PENALTY_POINTS} points have been deducted from your score.\n\n` +
        `You may continue working. Please contact your administrator.`,
        'error',
        20000 // Show for 20 seconds
    );

    // Also play a sound alert if available
    if (window.Audio) {
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDGH0fPTgjMGHW7A7+OZSA0OVKzo665aGwg+ldbxzn0pBSh+zPDajDwIEmCy6OKdTgwKU6vm7qVXGgk8k9XxyH0pBSiCzvDZiTYGGme56+GaTQwKUqvl7aVYGgk7ks/wyX8rBSiBzPDYiToGGGe46uCZSw0LU67m7qNWGQk7kc7wzIE=');
            audio.play().catch(e => log('Could not play alert sound:', e));
        } catch (e) {
            log('Audio not supported');
        }
    }
}

/**
 * Dismiss warning (user manually closes it)
 */
function dismissWarning() {
    hideBreakWarning();
    // Warning will reappear on next check cycle if still over limit
}

/**
 * Show blocked page overlay
 */
function showBlockedPage(reason) {
    // Create overlay if it doesn't exist
    let overlay = document.getElementById('blocked-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'blocked-overlay';
        overlay.className = 'fixed inset-0 bg-gray-900 bg-opacity-95 backdrop-blur-sm z-[9999] flex items-center justify-center';
        overlay.innerHTML = `
            <div class="bg-gray-800 border-2 border-red-500 rounded-lg p-8 max-w-md mx-4 text-center shadow-2xl">
                <div class="mb-6">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-24 w-24 text-red-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <h2 class="text-2xl font-bold text-red-400 mb-2">Access Blocked</h2>
                </div>
                <div class="mb-6">
                    <p class="text-gray-300 mb-4">Your access to the system has been temporarily blocked.</p>
                    <div class="bg-gray-700/50 border border-gray-600 rounded-lg p-4 mb-4">
                        <p class="text-sm text-gray-400 mb-1">Reason:</p>
                        <p class="text-white font-semibold" id="blocked-reason-text">${reason}</p>
                    </div>
                    <p class="text-sm text-gray-400">Please contact your administrator to regain access to the system.</p>
                </div>
                <div class="flex justify-center space-x-3">
                    <button onclick="window.userBlocking.logout()" class="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-6 rounded-lg transition-colors">
                        Logout
                    </button>
                    <button onclick="window.userBlocking.refreshStatus()" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-6 rounded-lg transition-colors">
                        Refresh Status
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    } else {
        // Update reason if overlay already exists
        const reasonText = overlay.querySelector('#blocked-reason-text');
        if (reasonText) {
            reasonText.textContent = reason;
        }
        overlay.classList.remove('hidden');
    }

    // Disable all interactions with the main page
    document.body.style.overflow = 'hidden';
}

/**
 * Hide blocked page overlay
 */
function hideBlockedPage() {
    const overlay = document.getElementById('blocked-overlay');
    if (overlay) {
        overlay.classList.add('hidden');
    }
    document.body.style.overflow = '';
}

/**
 * Refresh user's blocked status
 */
async function refreshStatus() {
    if (!appState.currentShiftId) {
        return;
    }

    try {
        const { data: attendance, error } = await _supabase
            .from('attendance')
            .select('is_blocked, blocked_reason')
            .eq('id', appState.currentShiftId)
            .single();

        if (error) throw error;

        if (attendance.is_blocked) {
            showNotification('Still Blocked', 'Your account is still blocked. Please contact admin.', 'error');
        } else {
            hideBlockedPage();
            showNotification('Access Restored', 'Your access has been restored!', 'success');
            // Refresh the page to reset state
            setTimeout(() => window.location.reload(), 1000);
        }
    } catch (err) {
        logError('[User Blocking] Error refreshing status:', err);
        showNotification('Error', 'Failed to check your status. Please try again.', 'error');
    }
}

/**
 * Logout function
 */
async function logout() {
    try {
        const { error } = await _supabase.auth.signOut();
        if (error) throw error;
        window.location.href = '/';
    } catch (err) {
        logError('[User Blocking] Error logging out:', err);
        window.location.href = '/';
    }
}

/**
 * Admin: Unblock a user (kept for backward compatibility)
 */
export async function unblockUser(attendanceId) {
    try {
        const { data, error } = await _supabase.rpc('unblock_user', {
            p_attendance_id: attendanceId
        });

        if (error) throw error;

        showNotification('Success', 'User has been unblocked successfully!', 'success');
        return true;
    } catch (err) {
        logError('[User Blocking] Error unblocking user:', err);
        showNotification('Error', 'Failed to unblock user: ' + err.message, 'error');
        return false;
    }
}

/**
 * Admin: Give back 50 points to user (replaces unblock functionality)
 * Shows confirmation dialog before restoring points
 * Always clears penalty flags, but only restores points if confirmed
 */
export async function giveBackScore(attendanceId) {
    try {
        // Get the user_id from attendance record first to show username in confirmation
        const { data: attendance, error: fetchError } = await _supabase
            .from('attendance')
            .select('user_id, username, blocked_reason')
            .eq('id', attendanceId)
            .single();

        if (fetchError) throw fetchError;

        // Show confirmation dialog
        const confirmed = confirm(
            `Restore 50 points to ${attendance.username}?\n\n` +
            `Reason: ${attendance.blocked_reason || 'Break time penalty'}\n\n` +
            `This will:\n` +
            `• Award +50 points back to the user\n` +
            `• Clear the penalty flags\n` +
            `• Reset break time to 79 minutes (prevents re-penalty)\n\n` +
            `Click OK to restore points, or Cancel to only clear penalty flags & reset break time.`
        );

        // If confirmed, award +100 points back to the user via edge function
        if (confirmed) {
            const awardedBy = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];

            const { data: pointsData, error: pointsError } = await _supabase.functions.invoke('award-points', {
                body: {
                    eventType: 'PENALTY_RESTORED',
                    userId: attendance.user_id,
                    username: attendance.username,
                    data: {
                        awardedBy: awardedBy
                    }
                }
            });

            if (pointsError) {
                throw pointsError;
            }
        }

        // Always clear the penalty flags AND reset break time to prevent immediate re-blocking
        // Set total_break_time_minutes to 79 (just below the 80 min threshold)
        const { error: updateError } = await _supabase
            .from('attendance')
            .update({
                is_blocked: false,
                blocked_reason: null,
                blocked_at: null,
                total_break_time_minutes: 79  // Reset to 79 to prevent immediate re-blocking
            })
            .eq('id', attendanceId);

        if (updateError) throw updateError;

        // Show appropriate notification
        if (confirmed) {
            showNotification(
                '✅ Points Restored',
                `Successfully restored +50 points to ${attendance.username}!\n\n` +
                `✓ Penalty cleared\n` +
                `✓ Break time reset to 79 minutes\n` +
                `✓ User can continue working normally`,
                'success',
                8000
            );
        } else {
            showNotification(
                'ℹ️ Penalty Flags Cleared',
                `Penalty flags cleared for ${attendance.username}.\n\n` +
                `✓ Break time reset to 79 minutes\n` +
                `✓ Warning indicators removed\n` +
                `Note: Points were NOT restored (user still has -50 penalty)`,
                'info',
                7000
            );
        }

        return true;
    } catch (err) {
        logError('[User Blocking] Error giving back score:', err);
        showNotification('Error', 'Failed to restore points: ' + err.message, 'error');
        return false;
    }
}

/**
 * Check if user is currently blocked (for admin view)
 */
export async function checkUserBlockStatus(attendanceId) {
    try {
        const { data, error } = await _supabase
            .from('attendance')
            .select('is_blocked, blocked_reason, blocked_at')
            .eq('id', attendanceId)
            .single();

        if (error) throw error;
        return data;
    } catch (err) {
        logError('[User Blocking] Error checking block status:', err);
        return null;
    }
}

// Export for window access
window.userBlocking = {
    initialize: initializeUserBlocking,
    logout,
    refreshStatus,
    unblockUser,
    giveBackScore,
    dismissWarning
};
