// User Blocking System for Excessive Break Time
import { _supabase } from './config.js';
import { appState } from './state.js';
import { showNotification } from './ui.js';

const WARNING_BREAK_MINUTES = 60;  // Show warning at 60 minutes
const MAX_BREAK_MINUTES = 80;      // Block at 80 minutes
let blockCheckInterval = null;
let warningShown = false;  // Track if warning has been shown for current break

/**
 * Initialize user blocking system
 * Checks every minute if current user has exceeded break time
 */
export function initializeUserBlocking() {
    console.log('[User Blocking] Initializing...');

    // Check immediately
    checkCurrentUserBreakTime();

    // Check every minute
    if (blockCheckInterval) {
        clearInterval(blockCheckInterval);
    }
    blockCheckInterval = setInterval(checkCurrentUserBreakTime, 60000); // Every minute
}

/**
 * Check if current user has exceeded break time limit
 */
async function checkCurrentUserBreakTime() {
    if (!appState.currentUser || !appState.currentShiftId) {
        return;
    }

    try {
        const { data: attendance, error } = await _supabase
            .from('attendance')
            .select('*')
            .eq('id', appState.currentShiftId)
            .single();

        if (error) {
            console.error('[User Blocking] Error fetching attendance:', error);
            return;
        }

        // Check if user is already blocked
        if (attendance.is_blocked) {
            showBlockedPage(attendance.blocked_reason || 'You have been blocked from the system');
            return;
        }

        // Check if user is on break
        if (attendance.on_lunch && attendance.lunch_start_time) {
            const breakStartTime = new Date(attendance.lunch_start_time);
            const now = new Date();
            const elapsedMinutes = Math.floor((now - breakStartTime) / 60000);

            console.log(`[User Blocking] Current break time: ${elapsedMinutes} minutes`);

            // If exceeded max limit, block the user
            if (elapsedMinutes > MAX_BREAK_MINUTES) {
                await blockCurrentUser(elapsedMinutes);
            }
            // If exceeded warning limit but not yet blocked, show warning
            else if (elapsedMinutes >= WARNING_BREAK_MINUTES && !warningShown) {
                showBreakWarning(elapsedMinutes);
                warningShown = true;  // Mark warning as shown
            }
        } else {
            // User is not on break, reset warning flag
            warningShown = false;
            hideBreakWarning();
        }
    } catch (err) {
        console.error('[User Blocking] Error in checkCurrentUserBreakTime:', err);
    }
}

/**
 * Block the current user
 */
async function blockCurrentUser(totalBreakMinutes) {
    try {
        console.log(`[User Blocking] Blocking user - exceeded ${MAX_BREAK_MINUTES} minutes (actual: ${totalBreakMinutes})`);

        const reason = `Exceeded ${MAX_BREAK_MINUTES} minutes total break time (${totalBreakMinutes} minutes)`;

        const { error } = await _supabase
            .from('attendance')
            .update({
                is_blocked: true,
                blocked_reason: reason,
                blocked_at: new Date().toISOString()
            })
            .eq('id', appState.currentShiftId);

        if (error) throw error;

        // Hide warning if shown
        hideBreakWarning();

        // Show blocked page immediately
        showBlockedPage(reason);
    } catch (err) {
        console.error('[User Blocking] Error blocking user:', err);
        showNotification('System Error', 'Failed to update your status. Please refresh the page.', 'error');
    }
}

/**
 * Show persistent break time warning
 */
function showBreakWarning(currentMinutes) {
    const remainingMinutes = MAX_BREAK_MINUTES - currentMinutes;

    console.log(`[User Blocking] Showing warning - ${currentMinutes} minutes elapsed, ${remainingMinutes} minutes until block`);

    // Create warning banner if it doesn't exist
    let warningBanner = document.getElementById('break-warning-banner');
    if (!warningBanner) {
        warningBanner = document.createElement('div');
        warningBanner.id = 'break-warning-banner';
        warningBanner.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 z-[9998] max-w-2xl mx-4';
        warningBanner.innerHTML = `
            <div class="bg-gradient-to-r from-yellow-600 to-orange-600 border-2 border-yellow-400 rounded-lg shadow-2xl p-4 animate-pulse-slow">
                <div class="flex items-start gap-4">
                    <div class="flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <div class="flex-grow">
                        <h3 class="text-white font-bold text-lg mb-1">⚠️ Break Time Warning</h3>
                        <p class="text-white text-sm mb-2">
                            You have been on break for <strong>${currentMinutes} minutes</strong>.
                            You will be <strong>automatically blocked</strong> in <strong class="text-xl">${remainingMinutes} minutes</strong> if you don't end your break.
                        </p>
                        <p class="text-yellow-100 text-xs">
                            Maximum allowed break time: ${MAX_BREAK_MINUTES} minutes. Please end your break soon to avoid being locked out.
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
        const minutesText = warningBanner.querySelector('strong');
        const remainingText = warningBanner.querySelectorAll('strong')[1];
        if (minutesText) minutesText.textContent = `${currentMinutes} minutes`;
        if (remainingText) remainingText.textContent = `${remainingMinutes} minutes`;
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
        console.error('[User Blocking] Error refreshing status:', err);
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
        console.error('[User Blocking] Error logging out:', err);
        window.location.href = '/';
    }
}

/**
 * Admin: Unblock a user
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
        console.error('[User Blocking] Error unblocking user:', err);
        showNotification('Error', 'Failed to unblock user: ' + err.message, 'error');
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
        console.error('[User Blocking] Error checking block status:', err);
        return null;
    }
}

// Export for window access
window.userBlocking = {
    initialize: initializeUserBlocking,
    logout,
    refreshStatus,
    unblockUser,
    dismissWarning
};
