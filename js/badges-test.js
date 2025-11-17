// Badges Testing Utilities
// Use these functions in the browser console to test badge functionality

import { _supabase } from './config.js';
import { appState } from './state.js';
import { awardPoints } from './main.js';

/**
 * Test Perfect Day notification
 * Sends a Perfect Day notification to all users without requiring badges
 *
 * Usage in browser console:
 * window.badgesTest.testPerfectDayNotification()
 */
export async function testPerfectDayNotification() {
    try {
        const username = appState.currentUser.user_metadata.display_name ||
                        appState.currentUser.email.split('@')[0];

        console.log('[BadgesTest] Sending Perfect Day notification for:', username);

        // Get all user IDs and display names from user_settings table
        const { data: userSettings, error: usersError } = await _supabase
            .from('user_settings')
            .select('user_id, display_name');

        if (usersError) {
            console.error('[BadgesTest] Error fetching users:', usersError);
            return;
        }

        if (!userSettings || userSettings.length === 0) {
            console.warn('[BadgesTest] No users found to notify');
            return;
        }

        console.log(`[BadgesTest] Found ${userSettings.length} users to notify`);

        // Create notification for each user (with required username and badge_name fields)
        const notifications = userSettings.map(setting => ({
            user_id: setting.user_id,
            username: setting.display_name,
            badge_id: 'perfect_day',
            badge_name: 'Perfect Day',
            badge_emoji: '🌟✨🏆⚡',
            message: `${username} achieved a PERFECT DAY! All badges earned with no Turtle badge! 🎉`,
            is_read: false,
            created_at: new Date().toISOString()
        }));

        const { error: insertError } = await _supabase
            .from('badge_notifications')
            .insert(notifications);

        if (insertError) {
            console.error('[BadgesTest] Error inserting notifications:', insertError);
            return;
        }

        console.log(`[BadgesTest] ✅ Successfully sent Perfect Day notification to ${userSettings.length} users!`);

        // Also show a toast if available
        if (window.tickets && window.tickets.showToast) {
            window.tickets.showToast(`Perfect Day notification sent to ${userSettings.length} users!`, 'success');
        }

    } catch (err) {
        console.error('[BadgesTest] Error in testPerfectDayNotification:', err);
    }
}

/**
 * Test Perfect Day with points
 * Awards 50 points and sends notification
 *
 * Usage in browser console:
 * window.badgesTest.testPerfectDayWithPoints()
 */
export async function testPerfectDayWithPoints() {
    try {
        const userId = appState.currentUser.id;
        const username = appState.currentUser.user_metadata.display_name ||
                        appState.currentUser.email.split('@')[0];

        console.log('[BadgesTest] Testing Perfect Day with points for:', username);

        // Award 50 points
        await awardPoints('PERFECT_DAY', {
            userId: userId,
            username: username
        });

        console.log('[BadgesTest] ✅ Awarded 50 points');

        // Send notification
        await testPerfectDayNotification();

    } catch (err) {
        console.error('[BadgesTest] Error in testPerfectDayWithPoints:', err);
    }
}

/**
 * Award a specific badge to current user for testing
 *
 * Usage in browser console:
 * window.badgesTest.awardTestBadge('speed_demon')
 * window.badgesTest.awardTestBadge('sniper')
 * window.badgesTest.awardTestBadge('lightning')
 * window.badgesTest.awardTestBadge('client_hero')
 * window.badgesTest.awardTestBadge('turtle')
 */
export async function awardTestBadge(badgeId) {
    try {
        const userId = appState.currentUser.id;
        const username = appState.currentUser.user_metadata.display_name ||
                        appState.currentUser.email.split('@')[0];

        console.log(`[BadgesTest] Awarding ${badgeId} badge to ${username}...`);

        const { data, error } = await _supabase.rpc('award_badge', {
            p_user_id: userId,
            p_username: username,
            p_badge_id: badgeId,
            p_metadata: {
                test: true,
                awarded_at: new Date().toISOString()
            }
        });

        if (error) {
            console.error(`[BadgesTest] Error awarding badge:`, error);
            return;
        }

        console.log(`[BadgesTest] ✅ Successfully awarded ${badgeId} badge!`);

        // Refresh badges display
        if (window.badges && window.badges.refreshBadgesDisplay) {
            window.badges.refreshBadgesDisplay();
        }

        // Show toast
        if (window.tickets && window.tickets.showToast) {
            window.tickets.showToast(`${badgeId} badge awarded!`, 'success');
        }

    } catch (err) {
        console.error('[BadgesTest] Error in awardTestBadge:', err);
    }
}

/**
 * Award all 4 positive badges for Perfect Day testing
 *
 * Usage in browser console:
 * window.badgesTest.awardAllPositiveBadges()
 */
export async function awardAllPositiveBadges() {
    try {
        console.log('[BadgesTest] Awarding all 4 positive badges...');

        await awardTestBadge('speed_demon');
        await new Promise(resolve => setTimeout(resolve, 500));

        await awardTestBadge('sniper');
        await new Promise(resolve => setTimeout(resolve, 500));

        await awardTestBadge('lightning');
        await new Promise(resolve => setTimeout(resolve, 500));

        await awardTestBadge('client_hero');

        console.log('[BadgesTest] ✅ All 4 positive badges awarded! Check if Perfect Day triggered.');

    } catch (err) {
        console.error('[BadgesTest] Error in awardAllPositiveBadges:', err);
    }
}

/**
 * Clear all badges for current user today
 *
 * Usage in browser console:
 * window.badgesTest.clearTodaysBadges()
 */
export async function clearTodaysBadges() {
    try {
        const userId = appState.currentUser.id;
        const today = new Date().toISOString().split('T')[0];

        console.log('[BadgesTest] Clearing today\'s badges...');

        const { error } = await _supabase
            .from('user_badges')
            .delete()
            .eq('user_id', userId)
            .gte('achieved_at', `${today}T00:00:00`)
            .lte('achieved_at', `${today}T23:59:59`);

        if (error) {
            console.error('[BadgesTest] Error clearing badges:', error);
            return;
        }

        console.log('[BadgesTest] ✅ Cleared all badges for today');

        // Refresh badges display
        if (window.badges && window.badges.refreshBadgesDisplay) {
            window.badges.refreshBadgesDisplay();
        }

        // Show toast
        if (window.tickets && window.tickets.showToast) {
            window.tickets.showToast('Today\'s badges cleared!', 'success');
        }

    } catch (err) {
        console.error('[BadgesTest] Error in clearTodaysBadges:', err);
    }
}

/**
 * View all badge notifications for current user
 *
 * Usage in browser console:
 * window.badgesTest.viewNotifications()
 */
export async function viewNotifications() {
    try {
        const userId = appState.currentUser.id;

        const { data: notifications, error } = await _supabase
            .from('badge_notifications')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) {
            console.error('[BadgesTest] Error fetching notifications:', error);
            return;
        }

        console.log('[BadgesTest] Recent notifications:');
        console.table(notifications);

        return notifications;

    } catch (err) {
        console.error('[BadgesTest] Error in viewNotifications:', err);
    }
}

/**
 * Clear all badge notifications for current user
 *
 * Usage in browser console:
 * window.badgesTest.clearNotifications()
 */
export async function clearNotifications() {
    try {
        const userId = appState.currentUser.id;

        const { error } = await _supabase
            .from('badge_notifications')
            .delete()
            .eq('user_id', userId);

        if (error) {
            console.error('[BadgesTest] Error clearing notifications:', error);
            return;
        }

        console.log('[BadgesTest] ✅ Cleared all badge notifications');

    } catch (err) {
        console.error('[BadgesTest] Error in clearNotifications:', err);
    }
}

// Export to window for console access
window.badgesTest = {
    testPerfectDayNotification,
    testPerfectDayWithPoints,
    awardTestBadge,
    awardAllPositiveBadges,
    clearTodaysBadges,
    viewNotifications,
    clearNotifications
};

console.log(`
🎯 Badges Testing Utilities Loaded!

Available commands:
- window.badgesTest.testPerfectDayNotification()     - Test Perfect Day notification only
- window.badgesTest.testPerfectDayWithPoints()       - Test Perfect Day with 50 points + notification
- window.badgesTest.awardTestBadge('badge_id')       - Award specific badge (speed_demon, sniper, lightning, client_hero, turtle)
- window.badgesTest.awardAllPositiveBadges()         - Award all 4 positive badges (triggers Perfect Day)
- window.badgesTest.clearTodaysBadges()              - Clear all badges earned today
- window.badgesTest.viewNotifications()              - View recent badge notifications
- window.badgesTest.clearNotifications()             - Clear all badge notifications

Example:
  window.badgesTest.testPerfectDayNotification()
`);
