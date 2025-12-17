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
    console.log('='.repeat(80));
    console.log('[User Blocking] INITIALIZATION STARTED');
    console.log('[User Blocking] WARNING_BREAK_MINUTES:', WARNING_BREAK_MINUTES);
    console.log('[User Blocking] MAX_BREAK_MINUTES:', MAX_BREAK_MINUTES);
    console.log('[User Blocking] Current user:', appState.currentUser?.email);
    console.log('[User Blocking] Current shift ID:', appState.currentShiftId);
    console.log('='.repeat(80));

    // Check immediately
    checkCurrentUserBreakTime();

    // Check every minute
    if (blockCheckInterval) {
        clearInterval(blockCheckInterval);
    }
    blockCheckInterval = setInterval(checkCurrentUserBreakTime, 60000); // Every minute
    console.log('[User Blocking] Interval set - will check every 60 seconds');
}

/**
 * Check if current user has exceeded break time limit
 */
async function checkCurrentUserBreakTime() {
    const checkTime = new Date().toLocaleTimeString();
    console.log(`\n${'─'.repeat(80)}`);
    console.log(`[User Blocking] CHECK STARTED at ${checkTime}`);

    if (!appState.currentUser || !appState.currentShiftId) {
        console.log('[User Blocking] ❌ SKIPPED - No current user or shift');
        console.log('[User Blocking]    - currentUser:', !!appState.currentUser);
        console.log('[User Blocking]    - currentShiftId:', appState.currentShiftId);
        console.log(`${'─'.repeat(80)}\n`);
        return;
    }

    console.log('[User Blocking] ✓ User and shift found');
    console.log('[User Blocking]    - User:', appState.currentUser.email);
    console.log('[User Blocking]    - Shift ID:', appState.currentShiftId);

    try {
        console.log('[User Blocking] 📡 Fetching attendance from database...');
        const { data: attendance, error } = await _supabase
            .from('attendance')
            .select('*')
            .eq('id', appState.currentShiftId)
            .single();

        if (error) {
            console.error('[User Blocking] ❌ ERROR fetching attendance:', error);
            console.log(`${'─'.repeat(80)}\n`);
            return;
        }

        console.log('[User Blocking] ✓ Attendance fetched successfully');
        console.log('[User Blocking]    - on_lunch:', attendance.on_lunch);
        console.log('[User Blocking]    - lunch_start_time:', attendance.lunch_start_time);
        console.log('[User Blocking]    - total_break_time_minutes:', attendance.total_break_time_minutes);
        console.log('[User Blocking]    - is_blocked:', attendance.is_blocked);

        // Check if user has already been penalized
        if (attendance.is_blocked) {
            console.log('[User Blocking] ⚠️ ALREADY PENALIZED - Skipping check');
            console.log('[User Blocking]    - blocked_at:', attendance.blocked_at);
            console.log('[User Blocking]    - blocked_reason:', attendance.blocked_reason);
            console.log(`${'─'.repeat(80)}\n`);
            return;
        }

        console.log('[User Blocking] 🧮 Calculating total break time...');

        // Calculate total break time (including current break if on break)
        let totalBreakTime = attendance.total_break_time_minutes || 0;
        let currentBreakMinutes = 0;

        console.log('[User Blocking]    - Base break time:', totalBreakTime, 'min');

        // If user is currently on break, add current break time
        if (attendance.on_lunch && attendance.lunch_start_time) {
            console.log('[User Blocking] 🔴 USER IS ON BREAK');
            const breakStartTime = new Date(attendance.lunch_start_time);
            const now = new Date();
            currentBreakMinutes = Math.floor((now - breakStartTime) / 60000);
            totalBreakTime += currentBreakMinutes;

            console.log('[User Blocking]    - Break started at:', breakStartTime.toLocaleTimeString());
            console.log('[User Blocking]    - Current time:', now.toLocaleTimeString());
            console.log('[User Blocking]    - Current break duration:', currentBreakMinutes, 'min');
            console.log('[User Blocking]    - TOTAL break time:', totalBreakTime, 'min');
            console.log('[User Blocking]    - WARNING threshold:', WARNING_BREAK_MINUTES, 'min');
            console.log('[User Blocking]    - MAX threshold:', MAX_BREAK_MINUTES, 'min');

            // Show warning if on break and approaching limit
            if (totalBreakTime >= WARNING_BREAK_MINUTES && !warningShown) {
                console.log('[User Blocking] ⚠️ SHOWING WARNING - Approaching limit');
                showBreakWarning(totalBreakTime);
                warningShown = true;
            } else if (totalBreakTime >= WARNING_BREAK_MINUTES) {
                console.log('[User Blocking] ⚠️ Warning threshold reached (already shown)');
            }
        } else {
            console.log('[User Blocking] 🟢 USER NOT ON BREAK');
            console.log('[User Blocking]    - Total break time today:', totalBreakTime, 'min');

            // User is not on break, reset warning flag
            warningShown = false;
            hideBreakWarning();
        }

        // Check if exceeded max limit (whether on break or not)
        console.log('[User Blocking] 🔍 Checking if limit exceeded...');
        console.log('[User Blocking]    - Total:', totalBreakTime, 'min');
        console.log('[User Blocking]    - Max:', MAX_BREAK_MINUTES, 'min');
        console.log('[User Blocking]    - Exceeded?', totalBreakTime > MAX_BREAK_MINUTES);

        if (totalBreakTime >= MAX_BREAK_MINUTES) {
            console.log('[User Blocking] 🚨 LIMIT REACHED/EXCEEDED! APPLYING PENALTY!');
            console.log(`[User Blocking]    - Total: ${totalBreakTime} min >= Max: ${MAX_BREAK_MINUTES} min`);
            await blockCurrentUser(totalBreakTime);
        } else {
            console.log('[User Blocking] ✓ Within limits - No penalty needed');
        }

        console.log(`${'─'.repeat(80)}\n`);
    } catch (err) {
        console.error('[User Blocking] ❌ EXCEPTION in checkCurrentUserBreakTime:', err);
        console.error('[User Blocking] Stack trace:', err.stack);
        console.log(`${'─'.repeat(80)}\n`);
    }
}

/**
 * Penalize the current user with -100 score (instead of blocking)
 */
async function blockCurrentUser(totalBreakMinutes) {
    try {
        console.log('='.repeat(80));
        console.log('[User Blocking] 💥 PENALTY APPLICATION STARTED');
        console.log(`[User Blocking] User exceeded ${MAX_BREAK_MINUTES} minutes (actual: ${totalBreakMinutes})`);

        const reason = `Exceeded ${MAX_BREAK_MINUTES} minutes total break time (${totalBreakMinutes} minutes)`;

        // Award -100 points as penalty
        console.log('[User Blocking] 📝 Inserting -100 points penalty into database...');
        const username = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];

        const { data: pointsData, error: pointsError } = await _supabase
            .from('user_points')
            .insert({
                user_id: appState.currentUser.id,
                username: username,
                event_type: 'BREAK_TIME_PENALTY',
                points_awarded: -100,
                details: {
                    reason: `Break time penalty: ${reason}`,
                    total_break_minutes: totalBreakMinutes,
                    awarded_by: 'system'
                }
            })
            .select();

        if (pointsError) {
            console.error('[User Blocking] ❌ ERROR awarding penalty points:', pointsError);
            console.error('[User Blocking] Error details:', JSON.stringify(pointsError, null, 2));
        } else {
            console.log('[User Blocking] ✅ Successfully inserted -100 points penalty');
            console.log('[User Blocking] Inserted data:', pointsData);
        }

        // Update attendance record to mark penalty applied (for tracking)
        console.log('[User Blocking] 📝 Updating attendance record with penalty flags...');
        const { error: attendanceError } = await _supabase
            .from('attendance')
            .update({
                is_blocked: true, // Keep flag for admin UI tracking
                blocked_reason: reason,
                blocked_at: new Date().toISOString()
            })
            .eq('id', appState.currentShiftId);

        if (attendanceError) {
            console.error('[User Blocking] ❌ ERROR updating attendance:', attendanceError);
            throw attendanceError;
        } else {
            console.log('[User Blocking] ✅ Successfully updated attendance with penalty flags');
        }

        // Hide warning if shown
        hideBreakWarning();

        // Show penalty notification instead of blocking page
        console.log('[User Blocking] 🔔 Showing penalty notification to user...');
        showPenaltyNotification(reason, totalBreakMinutes);

        console.log('[User Blocking] 💥 PENALTY APPLICATION COMPLETED');
        console.log('='.repeat(80));
    } catch (err) {
        console.error('[User Blocking] ❌ FATAL ERROR in blockCurrentUser:', err);
        console.error('[User Blocking] Stack trace:', err.stack);
        showNotification('System Error', 'Failed to update your status. Please refresh the page.', 'error');
    }
}

/**
 * Show persistent break time warning
 */
function showBreakWarning(currentMinutes) {
    const remainingMinutes = MAX_BREAK_MINUTES - currentMinutes;

    console.log(`[User Blocking] Showing warning - ${currentMinutes} minutes elapsed, ${remainingMinutes} minutes until penalty`);

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
            ? `You have reached ${currentMinutes} minutes of total break time (limit: ${MAX_BREAK_MINUTES} minutes).<br><strong class="text-red-200 text-lg">-100 points will be deducted immediately!</strong>`
            : `You have been on break for <strong>${currentMinutes} minutes</strong>.<br><strong class="text-red-200">-100 points</strong> will be deducted in <strong class="text-xl">${remainingMinutes} minutes</strong> if you don't end your break.`;

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
            ? `You have reached ${currentMinutes} minutes of total break time (limit: ${MAX_BREAK_MINUTES} minutes).<br><strong class="text-red-200 text-lg">-100 points will be deducted immediately!</strong>`
            : `You have been on break for <strong>${currentMinutes} minutes</strong>.<br><strong class="text-red-200">-100 points</strong> will be deducted in <strong class="text-xl">${remainingMinutes} minutes</strong> if you don't end your break.`;

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
 * Show penalty notification (replaces blocking page)
 */
function showPenaltyNotification(reason, totalBreakMinutes) {
    console.log('[User Blocking] Showing penalty notification');

    // Show a notification instead of blocking the page
    showNotification(
        '🚨 Break Time Limit Reached - Penalty Applied!',
        `You have reached ${totalBreakMinutes} minutes of total break time (limit: ${MAX_BREAK_MINUTES} minutes).\n\n` +
        `❌ -100 points have been deducted from your score immediately.\n\n` +
        `You may continue working. Contact your admin if you need the points restored.`,
        'error',
        20000 // Show for 20 seconds
    );

    // Also play a sound alert if available
    if (window.Audio) {
        try {
            const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBDGH0fPTgjMGHW7A7+OZSA0OVKzo665aGwg+ldbxzn0pBSh+zPDajDwIEmCy6OKdTgwKU6vm7qVXGgk8k9XxyH0pBSiCzvDZiTYGGme56+GaTQwKUqvl7aVYGgk7ks/wyX8rBSiBzPDYiToGGGe46uCZSw0LU67m7qNWGQk7kc7wzIE=');
            audio.play().catch(e => console.log('Could not play alert sound:', e));
        } catch (e) {
            console.log('Audio not supported');
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
        console.error('[User Blocking] Error unblocking user:', err);
        showNotification('Error', 'Failed to unblock user: ' + err.message, 'error');
        return false;
    }
}

/**
 * Admin: Give back 100 points to user (replaces unblock functionality)
 * Shows confirmation dialog before restoring points
 * Always clears penalty flags, but only restores points if confirmed
 */
export async function giveBackScore(attendanceId) {
    try {
        console.log(`[User Blocking] Requesting to give back 100 points for attendance ID: ${attendanceId}`);

        // Get the user_id from attendance record first to show username in confirmation
        const { data: attendance, error: fetchError } = await _supabase
            .from('attendance')
            .select('user_id, username, blocked_reason')
            .eq('id', attendanceId)
            .single();

        if (fetchError) throw fetchError;

        // Show confirmation dialog
        const confirmed = confirm(
            `Restore 100 points to ${attendance.username}?\n\n` +
            `Reason: ${attendance.blocked_reason || 'Break time penalty'}\n\n` +
            `This will:\n` +
            `• Award +100 points back to the user\n` +
            `• Clear the penalty flags\n\n` +
            `Click OK to restore points, or Cancel to only clear the penalty flags.`
        );

        // If confirmed, award +100 points back to the user
        if (confirmed) {
            const { error: pointsError } = await _supabase
                .from('user_points')
                .insert({
                    user_id: attendance.user_id,
                    username: attendance.username,
                    event_type: 'PENALTY_RESTORED',
                    points_awarded: 100,
                    details: {
                        reason: 'Break penalty points restored by admin',
                        awarded_by: appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0]
                    }
                });

            if (pointsError) throw pointsError;
            console.log('[User Blocking] +100 points awarded');
        } else {
            console.log('[User Blocking] Admin cancelled score restoration, but clearing penalty flags');
        }

        // Always clear the penalty flags (regardless of confirmation)
        const { error: updateError } = await _supabase
            .from('attendance')
            .update({
                is_blocked: false,
                blocked_reason: null,
                blocked_at: null
            })
            .eq('id', attendanceId);

        if (updateError) throw updateError;

        // Show appropriate notification
        if (confirmed) {
            showNotification(
                '✅ Points Restored',
                `Successfully restored +100 points to ${attendance.username}!\n\nThe penalty has been cleared and the user can continue working normally.`,
                'success',
                8000
            );
        } else {
            showNotification(
                'ℹ️ Penalty Flags Cleared',
                `Penalty flags cleared for ${attendance.username}.\n\nNo points were restored, but the warning indicators have been removed.`,
                'info',
                6000
            );
        }

        return true;
    } catch (err) {
        console.error('[User Blocking] Error giving back score:', err);
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
    giveBackScore,
    dismissWarning
};
