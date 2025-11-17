// Badges and Achievements System
import { _supabase } from './config.js';
import { appState } from './state.js';
import { awardPoints } from './main.js';

// Badge configuration
export const BADGES = {
    speed_demon: {
        id: 'speed_demon',
        name: 'Speed Demon',
        emoji: '🏆',
        description: 'Close 6 tickets within 60 minutes',
        reset: 'daily'
    },
    sniper: {
        id: 'sniper',
        name: 'Sniper',
        emoji: '🎯',
        description: 'Take 4+ tickets in a row before any other user',
        reset: 'daily'
    },
    client_hero: {
        id: 'client_hero',
        name: 'Client Hero',
        emoji: '🌟',
        description: 'Highest points earned yesterday',
        reset: 'daily'
    },
    lightning: {
        id: 'lightning',
        name: 'Lightning',
        emoji: '⚡',
        description: 'Fastest average response time (<5 min)',
        reset: 'daily'
    },
    turtle: {
        id: 'turtle',
        name: 'Turtle',
        emoji: '🐢',
        description: 'Late shift start (>15 min) or slow response (>30 min)',
        reset: 'daily'
    }
};

// Track last ticket action per user for sniper badge
let lastTicketAction = {
    username: null,
    count: 0,
    timestamp: Date.now()
};

/**
 * Initialize badges system
 */
export async function initializeBadges() {
    // Subscribe to badge notifications
    subscribeToBadgeNotifications();

    // Load active badges for all users
    await loadActiveBadges();

    // Setup daily reset check (runs at midnight)
    setupDailyReset();
}

/**
 * Load all active badges
 */
export async function loadActiveBadges() {
    try {
        const { data: badges, error } = await _supabase
            .from('user_badges')
            .select('*')
            .eq('is_active', true)
            .order('achieved_at', { ascending: false });

        if (error) throw error;

        // Group badges by user
        const badgesByUser = {};
        badges?.forEach(badge => {
            if (!badgesByUser[badge.username]) {
                badgesByUser[badge.username] = [];
            }
            badgesByUser[badge.username].push(badge);
        });

        return badgesByUser;
    } catch (err) {
        console.error('[Badges] Error loading badges:', err);
        return {};
    }
}

/**
 * Get user's badge stats for today
 */
async function getUserBadgeStats(userId, username) {
    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await _supabase
        .from('badge_stats')
        .select('*')
        .eq('user_id', userId)
        .eq('stat_date', today)
        .single();

    if (error && error.code !== 'PGRST116') {
        console.error('[Badges] Error fetching stats:', error);
        return null;
    }

    // Create initial stats if not exists
    if (!data) {
        const { data: newStats, error: insertError } = await _supabase
            .from('badge_stats')
            .insert({
                user_id: userId,
                username: username,
                stat_date: today
            })
            .select()
            .single();

        if (insertError) {
            console.error('[Badges] Error creating stats:', insertError);
            return null;
        }

        return newStats;
    }

    return data;
}

/**
 * Check Speed Demon Badge
 * Triggered when a ticket is closed
 * Awards badge if 6 tickets are closed within 60 minutes
 */
export async function checkSpeedDemonBadge(userId, username, ticketId, actionTime) {
    try {
        const now = new Date(actionTime);
        const sixtyMinutesAgo = new Date(now.getTime() - 60 * 60 * 1000);

        // Count tickets closed by this user in the last 60 minutes (including this one)
        const { data: recentClosures, error } = await _supabase
            .from('tickets')
            .select('id, completed_at')
            .eq('completed_by_name', username)
            .eq('status', 'Done')
            .gte('completed_at', sixtyMinutesAgo.toISOString())
            .lte('completed_at', now.toISOString());

        if (error) {
            console.error('[Badges] Error fetching recent closures:', error);
            return;
        }

        const closureCount = recentClosures?.length || 0;

        // Update stats with current closure count
        const stats = await getUserBadgeStats(userId, username);
        if (stats) {
            await _supabase
                .from('badge_stats')
                .update({
                    tickets_closed_fast: closureCount,
                    updated_at: new Date().toISOString()
                })
                .eq('id', stats.id);
        }

        // Award badge if 6 or more tickets closed in 60 minutes
        if (closureCount >= 6) {
            await awardBadge(userId, username, 'speed_demon', {
                count: closureCount,
                window_minutes: 60,
                achieved_at: new Date().toISOString()
            });
        }
    } catch (err) {
        console.error('[Badges] Error checking Speed Demon:', err);
    }
}

/**
 * Check Sniper Badge
 * Triggered when a ticket is created or assigned
 */
export async function checkSniperBadge(userId, username) {
    try {
        const now = Date.now();

        // If same user, increment count
        if (lastTicketAction.username === username) {
            lastTicketAction.count++;
            lastTicketAction.timestamp = now;

            // Update stats
            const stats = await getUserBadgeStats(userId, username);
            if (stats) {
                const maxStreak = Math.max(stats.max_consecutive_tickets, lastTicketAction.count);

                await _supabase
                    .from('badge_stats')
                    .update({
                        consecutive_tickets: lastTicketAction.count,
                        max_consecutive_tickets: maxStreak,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', stats.id);

                // Award badge if 4+ consecutive
                if (lastTicketAction.count >= 4) {
                    await awardBadge(userId, username, 'sniper', {
                        streak: lastTicketAction.count,
                        achieved_at: new Date().toISOString()
                    });
                }
            }
        } else {
            // Different user, reset
            lastTicketAction.username = username;
            lastTicketAction.count = 1;
            lastTicketAction.timestamp = now;
        }
    } catch (err) {
        console.error('[Badges] Error checking Sniper:', err);
    }
}

/**
 * Check Lightning Badge
 * Triggered when first note is added to a ticket
 */
export async function checkLightningBadge(userId, username, ticketId, noteTime, ticketData = null) {
    try {
        // Use provided ticket data or fetch it
        let ticket = ticketData;
        if (!ticket) {
            const { data, error } = await _supabase
                .from('tickets')
                .select('created_at, assigned_at, assigned_to')
                .eq('id', ticketId)
                .single();

            if (error) {
                console.error('[Badges] Error fetching ticket:', error);
                return;
            }
            ticket = data;
        }

        // Only check if this is the assigned user
        if (ticket.assigned_to !== userId) return;

        const startTime = new Date(ticket.assigned_at || ticket.created_at);
        const endTime = new Date(noteTime);
        const diffSeconds = (endTime - startTime) / 1000;
        const diffMinutes = diffSeconds / 60;

        // Update stats
        const stats = await getUserBadgeStats(userId, username);
        if (!stats) return;

        const newTotal = stats.total_response_time + diffSeconds;
        const newCount = stats.response_count + 1;
        const newAvg = newTotal / newCount;
        const isFast = diffSeconds <= 300; // 5 minutes
        const isSlow = diffMinutes > 30; // 30 minutes

        await _supabase
            .from('badge_stats')
            .update({
                total_response_time: newTotal,
                response_count: newCount,
                avg_response_time: Math.floor(newAvg),
                fast_responses: stats.fast_responses + (isFast ? 1 : 0),
                slow_responses: stats.slow_responses + (isSlow ? 1 : 0),
                updated_at: new Date().toISOString()
            })
            .eq('id', stats.id);

        // Check for slow response (Turtle badge)
        if (isSlow) {
            await checkTurtleBadge(userId, username, 'slow_response', diffMinutes);
        }

        // Award Lightning badge if average response time is under 5 minutes and has at least 3 responses
        if (newAvg <= 300 && newCount >= 3) {
            await awardBadge(userId, username, 'lightning', {
                avg_response_time: Math.floor(newAvg),
                fast_responses: stats.fast_responses + (isFast ? 1 : 0),
                achieved_at: new Date().toISOString()
            });
        }
    } catch (err) {
        console.error('[Badges] Error checking Lightning:', err);
    }
}

/**
 * Check Turtle Badge
 * Triggered when shift starts late or first note is slow
 */
export async function checkTurtleBadge(userId, username, type, delayMinutes) {
    try {
        const stats = await getUserBadgeStats(userId, username);
        if (!stats) return;

        if (type === 'late_shift') {
            if (delayMinutes > 15) {
                await _supabase
                    .from('badge_stats')
                    .update({
                        late_shift_starts: stats.late_shift_starts + 1,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', stats.id);

                // Award turtle badge immediately for late shift
                await awardBadge(userId, username, 'turtle', {
                    reason: 'late_shift',
                    delay_minutes: delayMinutes,
                    achieved_at: new Date().toISOString()
                });
            }
        } else if (type === 'slow_response') {
            // Note: slow_responses stat is already updated in checkLightningBadge
            // Just check if we should award the badge (3+ slow responses)
            if (stats.slow_responses + 1 >= 3) {
                await awardBadge(userId, username, 'turtle', {
                    reason: 'slow_responses',
                    count: stats.slow_responses + 1,
                    achieved_at: new Date().toISOString()
                });
            }
        }
    } catch (err) {
        console.error('[Badges] Error checking Turtle:', err);
    }
}

/**
 * Check Client Hero Badge (Daily Reset)
 * Run at end of each day to award to yesterday's top performer
 * Uses existing user_points table
 */
export async function checkClientHeroBadge() {
    try {
        // Get yesterday's date range
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        yesterday.setHours(0, 0, 0, 0);
        const yesterdayStart = yesterday.toISOString();

        const yesterdayEnd = new Date(yesterday);
        yesterdayEnd.setHours(23, 59, 59, 999);
        const yesterdayEndStr = yesterdayEnd.toISOString();

        // Get top performer by total points earned yesterday from user_points table
        const { data: userPoints, error } = await _supabase
            .from('user_points')
            .select('user_id, username, points_awarded')
            .gte('created_at', yesterdayStart)
            .lte('created_at', yesterdayEndStr);

        if (error) {
            console.error('[Badges] Error fetching user points:', error);
            return;
        }

        if (!userPoints || userPoints.length === 0) return;

        // Sum points by user
        const userTotals = {};
        userPoints.forEach(point => {
            if (!userTotals[point.user_id]) {
                userTotals[point.user_id] = {
                    user_id: point.user_id,
                    username: point.username,
                    total_points: 0
                };
            }
            userTotals[point.user_id].total_points += point.points_awarded;
        });

        // Find top performer
        const topPerformer = Object.values(userTotals).reduce((max, user) =>
            user.total_points > max.total_points ? user : max
        );

        if (!topPerformer || topPerformer.total_points <= 0) return;

        // Award badge to top performer
        await awardBadge(
            topPerformer.user_id,
            topPerformer.username,
            'client_hero',
            {
                total_points: topPerformer.total_points,
                date: yesterdayStart.split('T')[0],
                achieved_at: new Date().toISOString()
            }
        );
    } catch (err) {
        console.error('[Badges] Error checking Client Hero:', err);
    }
}

/**
 * Check if user achieved "Perfect Day" (all 4 positive badges without Turtle badge)
 * Awards 50 points and sends special notification to all users
 */
async function checkPerfectDay(userId, username) {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Get all badges earned today by this user
        const { data: todaysBadges, error } = await _supabase
            .from('user_badges')
            .select('badge_id')
            .eq('user_id', userId)
            .eq('is_active', true)
            .gte('achieved_at', `${today}T00:00:00`)
            .lte('achieved_at', `${today}T23:59:59`);

        if (error) throw error;

        const badgeIds = todaysBadges.map(b => b.badge_id);

        // Check if user has all 4 positive badges (speed_demon, sniper, client_hero, lightning)
        const hasSpeedDemon = badgeIds.includes('speed_demon');
        const hasSniper = badgeIds.includes('sniper');
        const hasClientHero = badgeIds.includes('client_hero');
        const hasLightning = badgeIds.includes('lightning');
        const hasTurtle = badgeIds.includes('turtle');

        // Perfect Day: All 4 positive badges and NO turtle badge
        if (hasSpeedDemon && hasSniper && hasClientHero && hasLightning && !hasTurtle) {
            // Award 50 bonus points
            await awardPoints('PERFECT_DAY', {
                userId: userId,
                username: username
            });

            // Send special notification to ALL users
            await sendPerfectDayNotification(username);
        }
    } catch (err) {
        console.error('[Badges] Error checking Perfect Day:', err);
    }
}

/**
 * Send Perfect Day notification to all users
 */
async function sendPerfectDayNotification(username) {
    try {
        // Get all user IDs and usernames from user_settings table
        const { data: userSettings, error } = await _supabase
            .from('user_settings')
            .select('user_id, display_name');

        if (error) throw error;

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

        if (insertError) throw insertError;
    } catch (err) {
        console.error('[Badges] Error sending Perfect Day notification:', err);
    }
}

/**
 * Award badge to user
 */
async function awardBadge(userId, username, badgeId, metadata = {}) {
    try {
        // Check if user already has this badge today (one badge per day restriction)
        const today = new Date().toISOString().split('T')[0];
        const { data: existingBadge, error: checkError } = await _supabase
            .from('user_badges')
            .select('id')
            .eq('user_id', userId)
            .eq('badge_id', badgeId)
            .eq('is_active', true)
            .gte('achieved_at', `${today}T00:00:00`)
            .lte('achieved_at', `${today}T23:59:59`)
            .maybeSingle();

        if (checkError && checkError.code !== 'PGRST116') {
            console.error('[Badges] Error checking existing badge:', checkError);
        }

        // If badge already awarded today, skip
        if (existingBadge) {
            return false;
        }

        // Award the badge
        const { data, error } = await _supabase.rpc('award_badge', {
            p_user_id: userId,
            p_username: username,
            p_badge_id: badgeId,
            p_metadata: metadata
        });

        if (error) throw error;

        // Check for "Perfect Day" achievement
        await checkPerfectDay(userId, username);

        // Refresh badges display
        if (window.badges && window.badges.refreshBadgesDisplay) {
            window.badges.refreshBadgesDisplay();
        }

        return data;
    } catch (err) {
        console.error('[Badges] Error awarding badge:', err);
        return false;
    }
}

/**
 * Subscribe to badge notifications in real-time
 */
function subscribeToBadgeNotifications() {
    const userId = appState.currentUser?.id;

    if (!userId) {
        return null;
    }

    const channel = _supabase
        .channel('badge_notifications_channel')
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'badge_notifications',
            filter: `user_id=eq.${userId}`
        }, (payload) => {
            showBadgeNotification(payload.new);
        })
        .subscribe();

    return channel;
}

/**
 * Show badge notification toast
 */
function showBadgeNotification(notification) {
    const message = `${notification.badge_emoji} ${notification.message}`;

    // Try multiple toast systems
    if (window.clients && window.clients.showToast) {
        window.clients.showToast(message, 'success');
    } else if (window.tickets && window.tickets.showToast) {
        window.tickets.showToast(message, 'success');
    } else {
        // Fallback: create our own toast
        createToast(message, 'success');
    }

    // Also trigger badge display refresh
    if (window.badges && window.badges.refreshBadgesDisplay) {
        window.badges.refreshBadgesDisplay();
    }
}

/**
 * Create a simple toast notification
 */
function createToast(message) {
    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 16px 24px;
        padding-right: 48px;
        border-radius: 12px;
        box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
        z-index: 10000;
        font-size: 15px;
        font-weight: 500;
        max-width: 450px;
        animation: slideInFromTop 0.4s ease;
        cursor: pointer;
        transition: transform 0.2s ease;
    `;
    toast.textContent = message;

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '×';
    closeBtn.style.cssText = `
        position: absolute;
        top: 8px;
        right: 12px;
        background: transparent;
        border: none;
        color: white;
        font-size: 28px;
        line-height: 1;
        cursor: pointer;
        padding: 0;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.8;
        transition: opacity 0.2s;
    `;
    closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
    closeBtn.onmouseout = () => closeBtn.style.opacity = '0.8';
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        toast.style.animation = 'slideOutToTop 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    };

    toast.appendChild(closeBtn);

    // Add animation keyframes if not already added
    if (!document.getElementById('badge-toast-animations')) {
        const style = document.createElement('style');
        style.id = 'badge-toast-animations';
        style.textContent = `
            @keyframes slideInFromTop {
                from {
                    transform: translateY(-100%);
                    opacity: 0;
                }
                to {
                    transform: translateY(0);
                    opacity: 1;
                }
            }
            @keyframes slideOutToTop {
                from {
                    transform: translateY(0);
                    opacity: 1;
                }
                to {
                    transform: translateY(-100%);
                    opacity: 0;
                }
            }
        `;
        document.head.appendChild(style);
    }

    // Hover effect
    toast.onmouseover = () => toast.style.transform = 'scale(1.02)';
    toast.onmouseout = () => toast.style.transform = 'scale(1)';

    // Click to dismiss
    toast.onclick = () => {
        toast.style.animation = 'slideOutToTop 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    };

    document.body.appendChild(toast);
}

/**
 * Setup daily reset (runs at midnight)
 */
function setupDailyReset() {
    const now = new Date();
    const night = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0, 0, 0
    );
    const msToMidnight = night.getTime() - now.getTime();

    setTimeout(async () => {
        // Award Client Hero badge for yesterday's top performer before reset
        await checkClientHeroBadge();
        // Reset daily badges
        await resetDailyBadges();
        // Setup next day
        setInterval(async () => {
            await checkClientHeroBadge();
            await resetDailyBadges();
        }, 86400000); // 24 hours
    }, msToMidnight);
}

/**
 * Reset daily badges
 */
async function resetDailyBadges() {
    try {
        const { error } = await _supabase.rpc('reset_daily_badges');
        if (error) throw error;

        // Refresh display
        if (window.badges && window.badges.refreshBadgesDisplay) {
            window.badges.refreshBadgesDisplay();
        }
    } catch (err) {
        console.error('[Badges] Error resetting daily badges:', err);
    }
}

// Export functions
window.badges = {
    initializeBadges,
    checkSpeedDemonBadge,
    checkSniperBadge,
    checkLightningBadge,
    checkTurtleBadge,
    checkClientHeroBadge
};
