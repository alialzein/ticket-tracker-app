import { log, logError, logWarn } from './logger.js';
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

        // Get all user IDs and display names from user_settings table
        const { data: userSettings, error: usersError } = await _supabase
            .from('user_settings')
            .select('user_id, display_name');

        if (usersError) {
            logError('[BadgesTest] Error fetching users:', usersError);
            return;
        }

        if (!userSettings || userSettings.length === 0) return;

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
            logError('[BadgesTest] Error inserting notifications:', insertError);
            return;
        }

        log(`✅ Perfect Day notification sent to ${userSettings.length} users`);

    } catch (err) {
        logError('[BadgesTest] Error in testPerfectDayNotification:', err);
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

        // Award 50 points
        await awardPoints('PERFECT_DAY', {
            userId: userId,
            username: username
        });

        // Send notification
        await testPerfectDayNotification();

        log('✅ Perfect Day test complete (50 points + notifications)');

    } catch (err) {
        logError('[BadgesTest] Error in testPerfectDayWithPoints:', err);
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
            logError(`[BadgesTest] Error awarding badge:`, error);
            return;
        }

        log(`✅ ${badgeId} badge awarded`);

        // Refresh badges display
        if (window.badges && window.badges.refreshBadgesDisplay) {
            window.badges.refreshBadgesDisplay();
        }

    } catch (err) {
        logError('[BadgesTest] Error in awardTestBadge:', err);
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
        await awardTestBadge('speed_demon');
        await new Promise(resolve => setTimeout(resolve, 500));

        await awardTestBadge('sniper');
        await new Promise(resolve => setTimeout(resolve, 500));

        await awardTestBadge('lightning');
        await new Promise(resolve => setTimeout(resolve, 500));

        await awardTestBadge('client_hero');

        log('✅ All 4 positive badges awarded - Perfect Day should trigger');

    } catch (err) {
        logError('[BadgesTest] Error in awardAllPositiveBadges:', err);
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

        const { error } = await _supabase
            .from('user_badges')
            .delete()
            .eq('user_id', userId)
            .gte('achieved_at', `${today}T00:00:00`)
            .lte('achieved_at', `${today}T23:59:59`);

        if (error) {
            logError('[BadgesTest] Error clearing badges:', error);
            return;
        }

        log('✅ Today\'s badges cleared');

        // Refresh badges display
        if (window.badges && window.badges.refreshBadgesDisplay) {
            window.badges.refreshBadgesDisplay();
        }

    } catch (err) {
        logError('[BadgesTest] Error in clearTodaysBadges:', err);
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
            logError('[BadgesTest] Error fetching notifications:', error);
            return;
        }

        log(notifications);
        return notifications;

    } catch (err) {
        logError('[BadgesTest] Error in viewNotifications:', err);
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
            logError('[BadgesTest] Error clearing notifications:', error);
            return;
        }

        log('✅ Badge notifications cleared');

    } catch (err) {
        logError('[BadgesTest] Error in clearNotifications:', err);
    }
}

/**
 * View all badges in database for current user
 *
 * Usage in browser console:
 * window.badgesTest.viewAllBadges()
 */
export async function viewAllBadges() {
    try {
        const userId = appState.currentUser.id;
        const today = new Date().toISOString().split('T')[0];

        const { data: badges, error } = await _supabase
            .from('user_badges')
            .select('*')
            .eq('user_id', userId)
            .gte('achieved_at', `${today}T00:00:00`)
            .lte('achieved_at', `${today}T23:59:59`)
            .order('achieved_at', { ascending: false });

        if (error) {
            logError('[BadgesTest] Error fetching badges:', error);
            return;
        }

        log(badges);
        return badges;

    } catch (err) {
        logError('[BadgesTest] Error in viewAllBadges:', err);
    }
}

/**
 * Manually insert a badge with today's timestamp (bypasses RPC function)
 * Useful when award_badge RPC has timestamp issues
 *
 * Usage in browser console:
 * window.badgesTest.manuallyInsertBadge('client_hero')
 */
export async function manuallyInsertBadge(badgeId) {
    try {
        const userId = appState.currentUser.id;
        const username = appState.currentUser.user_metadata.display_name ||
                        appState.currentUser.email.split('@')[0];

        // First, delete any existing badge of this type for today
        const today = new Date().toISOString().split('T')[0];
        await _supabase
            .from('user_badges')
            .delete()
            .eq('user_id', userId)
            .eq('badge_id', badgeId)
            .gte('achieved_at', `${today}T00:00:00`)
            .lte('achieved_at', `${today}T23:59:59`);

        // Insert with today's timestamp
        const { data, error } = await _supabase
            .from('user_badges')
            .insert({
                user_id: userId,
                username: username,
                badge_id: badgeId,
                achieved_at: new Date().toISOString(),
                reset_period: 'daily',
                metadata: { test: true, manual: true }
            })
            .select();

        if (error) {
            logError(`[BadgesTest] Error manually inserting badge:`, error);
            return;
        }

        log(`✅ ${badgeId} badge manually inserted:`, data);

        // Refresh badges display
        if (window.badges && window.badges.refreshBadgesDisplay) {
            window.badges.refreshBadgesDisplay();
        }

    } catch (err) {
        logError('[BadgesTest] Error in manuallyInsertBadge:', err);
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
    clearNotifications,
    viewAllBadges,
    manuallyInsertBadge
};
