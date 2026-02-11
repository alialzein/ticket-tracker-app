import { log, logError, logWarn } from './logger.js';
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
        description: 'Close 6 tickets within 30 min of creation',
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
        description: 'Outlook tickets: respond <15 min & close <2 hours (3 tickets)',
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

    // NOTE: Daily badge reset is handled server-side via existing cron job (1 AM GMT+2)
    // Client-side reset removed to prevent timezone issues and multiple timer conflicts
}

/**
 * Load all active badges
 */
export async function loadActiveBadges() {
    try {
        const { data: badges, error } = await _supabase
            .from('user_badges')
            .select('*')
            .eq('team_id', appState.currentUserTeamId)
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
        logError('[Badges] Error loading badges:', err);
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
        .eq('team_id', appState.currentUserTeamId)
        .eq('user_id', userId)
        .eq('stat_date', today)
        .maybeSingle();

    if (error) {
        logError('[Badges] Error fetching stats:', error);
        return null;
    }

    // Create initial stats if not exists using upsert to avoid race conditions
    if (!data) {
        const { data: newStats, error: upsertError } = await _supabase
            .from('badge_stats')
            .upsert({
                user_id: userId,
                username: username,
                stat_date: today,
                team_id: appState.currentUserTeamId
            }, { onConflict: 'user_id,stat_date' })
            .select()
            .maybeSingle();

        if (upsertError) {
            logError('[Badges] Error creating stats:', upsertError);
            return null;
        }

        return newStats;
    }

    return data;
}

/**
 * Check Speed Demon Badge
 * Triggered when a ticket is closed
 * Awards badge if 6 tickets are closed within 30 minutes of either:
 * 1. Creation time (for tickets user created and closed)
 * 2. Assignment time (for tickets user was assigned to and closed)
 */
export async function checkSpeedDemonBadge(userId, username, ticketId, actionTime) {
    try {
        log(`[Speed Demon] Checking for user: ${username}`);
        const today = new Date().toISOString().split('T')[0];

        // Get all tickets closed by this user today
        const { data: closedTickets, error } = await _supabase
            .from('tickets')
            .select('id, created_at, completed_at, assigned_at, created_by')
            .eq('completed_by_name', username)
            .eq('status', 'Done')
            .gte('completed_at', `${today}T00:00:00`)
            .lte('completed_at', `${today}T23:59:59`);

        if (error) {
            logError('[Speed Demon] Error fetching closed tickets:', error);
            return;
        }

        log(`[Speed Demon] Found ${closedTickets?.length || 0} closed tickets for ${username}`);

        // Count tickets that were closed within 30 minutes of creation OR assignment
        // Use assignment time if assigned, otherwise use creation time
        let fastClosureCount = 0;
        closedTickets?.forEach(ticket => {
            const completed = new Date(ticket.completed_at);

            // Check if user created the ticket
            const isCreator = ticket.created_by === userId;

            // Determine reference time: assignment time if assigned, creation time if creator
            let referenceTime;
            if (isCreator) {
                // User created the ticket - use creation time
                referenceTime = new Date(ticket.created_at);
            } else if (ticket.assigned_at) {
                // User was assigned the ticket - use assignment time
                referenceTime = new Date(ticket.assigned_at);
            } else {
                // Skip tickets with no clear reference time
                return;
            }

            const diffMinutes = (completed - referenceTime) / (1000 * 60);
            log(`[Speed Demon] Ticket ${ticket.ticket_id}: ${isCreator ? 'created' : 'assigned'} at ${isCreator ? ticket.created_at : ticket.assigned_at}, completed at ${ticket.completed_at}, minutes: ${diffMinutes.toFixed(2)}`);

            if (diffMinutes <= 30) {
                fastClosureCount++;
            }
        });

        log(`[Speed Demon] Fast closure count: ${fastClosureCount}`);

        // Update stats with fast closure count
        const stats = await getUserBadgeStats(userId, username);
        log(`[Speed Demon] Stats retrieved:`, stats);

        if (stats) {
            const { error: updateError } = await _supabase
                .from('badge_stats')
                .update({
                    tickets_closed_fast: fastClosureCount,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId)
                .eq('stat_date', new Date().toISOString().split('T')[0]);

            if (updateError) {
                logError('[Speed Demon] Error updating badge_stats:', updateError);
            } else {
                log(`[Speed Demon] Updated badge_stats successfully - tickets_closed_fast: ${fastClosureCount}`);
            }
        }

        // Award badge if 6 or more tickets closed within 30 minutes of creation
        if (fastClosureCount >= 6) {
            log(`[Speed Demon] Awarding badge! Count: ${fastClosureCount}`);
            await awardBadge(userId, username, 'speed_demon', {
                count: fastClosureCount,
                window_minutes: 30,
                achieved_at: new Date().toISOString()
            });
        }
    } catch (err) {
        logError('[Speed Demon] Error checking Speed Demon:', err);
    }
}

/**
 * Check Sniper Badge
 * Triggered when a ticket is created or assigned
 */
export async function checkSniperBadge(userId, username) {
    try {
        log(`[Sniper] Checking for user: ${username}, last user: ${lastTicketAction.username}`);
        const now = Date.now();

        // If same user, increment count
        if (lastTicketAction.username === username) {
            lastTicketAction.count++;
            lastTicketAction.timestamp = now;

            log(`[Sniper] Consecutive count: ${lastTicketAction.count}`);

            // Update stats
            const stats = await getUserBadgeStats(userId, username);
            if (stats) {
                const maxStreak = Math.max(stats.max_consecutive_tickets, lastTicketAction.count);

                const { error: updateError } = await _supabase
                    .from('badge_stats')
                    .update({
                        consecutive_tickets: lastTicketAction.count,
                        max_consecutive_tickets: maxStreak,
                        updated_at: new Date().toISOString()
                    })
                    .eq('user_id', userId)
                    .eq('stat_date', new Date().toISOString().split('T')[0]);

                if (updateError) {
                    logError('[Sniper] Error updating badge_stats:', updateError);
                } else {
                    log(`[Sniper] Updated badge_stats - consecutive: ${lastTicketAction.count}, max: ${maxStreak}`);
                }

                // Award badge if 4+ consecutive
                if (lastTicketAction.count >= 4) {
                    log(`[Sniper] Awarding badge! Streak: ${lastTicketAction.count}`);
                    await awardBadge(userId, username, 'sniper', {
                        streak: lastTicketAction.count,
                        achieved_at: new Date().toISOString()
                    });
                }
            }
        } else {
            // Different user, reset
            log(`[Sniper] Different user - resetting streak`);
            lastTicketAction.username = username;
            lastTicketAction.count = 1;
            lastTicketAction.timestamp = now;
        }
    } catch (err) {
        logError('[Sniper] Error checking Sniper:', err);
    }
}

/**
 * Check Lightning Badge
 * Awards badge for 3 tickets with ALL:
 * 1. Source must be 'outlook' (created or reassigned from Outlook)
 * 2. Fast response (<15 min from creation/assignment to first note)
 * 3. Fast closure (<2 hours from creation/assignment to completion)
 *
 * Triggered when a ticket is closed (not when note is added)
 */
export async function checkLightningBadge(userId, username, ticketId, noteTime, ticketData = null) {
    try {
        log(`[Lightning] Checking for user: ${username}`);
        const today = new Date().toISOString().split('T')[0];

        // Get all tickets completed by this user today that are closed
        const { data: userTickets, error } = await _supabase
            .from('tickets')
            .select('id, created_at, completed_at, assigned_at, notes, created_by, source')
            .eq('completed_by_name', username)
            .eq('status', 'Done')
            .gte('completed_at', `${today}T00:00:00`)
            .lte('completed_at', `${today}T23:59:59`);

        if (error) {
            logError('[Lightning] Error fetching user tickets:', error);
            return;
        }

        if (!userTickets || userTickets.length === 0) {
            log(`[Lightning] No completed tickets found for ${username}`);
            return;
        }

        log(`[Lightning] Found ${userTickets.length} completed tickets for ${username}`);

        // Count tickets that meet ALL criteria:
        // 1. Source is 'outlook'
        // 2. First note within 15 minutes of CREATION/ASSIGNMENT
        // 3. Closed within 2 hours (120 minutes) of CREATION/ASSIGNMENT
        let qualifyingTickets = 0;

        userTickets.forEach(ticket => {
            log(`[Lightning] Checking ticket #${ticket.id}: source='${ticket.source}'`);

            // MUST be from Outlook source (check if contains 'outlook' - case insensitive)
            if (!ticket.source || !ticket.source.toLowerCase().includes('outlook')) {
                log(`[Lightning] ❌ Ticket #${ticket.id} skipped - source is '${ticket.source}', does not contain 'outlook'`);
                return;
            }

            const isCreator = ticket.created_by === userId;
            const completed = new Date(ticket.completed_at);

            // Determine reference time: assignment time for assigned tickets, creation time for own tickets
            let referenceTime;
            if (isCreator) {
                // User created the ticket - use creation time
                referenceTime = new Date(ticket.created_at);
            } else if (ticket.assigned_at) {
                // User was assigned the ticket - use assignment time
                referenceTime = new Date(ticket.assigned_at);
            } else {
                // Skip tickets with no clear reference time
                log(`[Lightning] ❌ Ticket #${ticket.id} skipped - no reference time (not creator and not assigned)`);
                return;
            }

            const closureMinutes = (completed - referenceTime) / (1000 * 60);

            log(`[Lightning] Ticket #${ticket.id}: closure time = ${closureMinutes.toFixed(1)} min (limit: 120 min)`);

            // Check if ticket was closed within 2 hours (120 minutes) of reference time
            if (closureMinutes > 120) {
                log(`[Lightning] ❌ Ticket #${ticket.id} skipped - closed too slow (${closureMinutes.toFixed(1)} > 120 min)`);
                return;
            }

            // Check if there's a first note and it was within 15 minutes of reference time
            const notes = ticket.notes || [];
            const userNotes = notes.filter(note => note.user_id === userId).sort((a, b) =>
                new Date(a.timestamp) - new Date(b.timestamp)
            );

            log(`[Lightning] Ticket #${ticket.id}: user notes count = ${userNotes.length}`);

            if (userNotes.length > 0) {
                const firstNote = userNotes[0];
                const firstNoteTime = new Date(firstNote.timestamp);
                const responseMinutes = (firstNoteTime - referenceTime) / (1000 * 60);

                log(`[Lightning] Ticket #${ticket.id}: response time = ${responseMinutes.toFixed(1)} min (limit: 15 min)`);

                // All conditions met: Outlook source + fast response (<=15min) + fast closure (<=2hrs)
                if (responseMinutes <= 15) {
                    qualifyingTickets++;
                    log(`[Lightning] ✅ Qualifying ticket #${ticket.id}: Outlook source, response ${responseMinutes.toFixed(1)}min, closure ${closureMinutes.toFixed(1)}min (${isCreator ? 'created' : 'assigned'})`);
                } else {
                    log(`[Lightning] ❌ Ticket #${ticket.id} skipped - response too slow (${responseMinutes.toFixed(1)} > 15 min)`);
                }
            } else {
                log(`[Lightning] ❌ Ticket #${ticket.id} skipped - no user notes found`);
            }
        });

        log(`[Lightning] Qualifying tickets: ${qualifyingTickets}`);

        // Update stats
        const stats = await getUserBadgeStats(userId, username);
        if (stats) {
            const { error: updateError } = await _supabase
                .from('badge_stats')
                .update({
                    fast_responses: qualifyingTickets,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId)
                .eq('stat_date', new Date().toISOString().split('T')[0]);

            if (updateError) {
                logError('[Lightning] Error updating badge_stats:', updateError);
            } else {
                log(`[Lightning] Updated badge_stats - fast_responses: ${qualifyingTickets}`);
            }
        }

        // Award Lightning badge if 3 or more qualifying tickets
        if (qualifyingTickets >= 3) {
            log(`[Lightning] Awarding badge! Count: ${qualifyingTickets}`);
            await awardBadge(userId, username, 'lightning', {
                qualifying_tickets: qualifyingTickets,
                criteria: 'Outlook source + Fast response (<15 min) + Fast closure (<2 hours)',
                achieved_at: new Date().toISOString()
            });
        }
    } catch (err) {
        logError('[Lightning] Error checking Lightning:', err);
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
                log(`[Turtle] Late shift detected: ${username} - ${Math.floor(delayMinutes)} minutes late`);

                await _supabase
                    .from('badge_stats')
                    .update({
                        late_shift_starts: stats.late_shift_starts + 1,
                        updated_at: new Date().toISOString()
                    })
                    .eq('user_id', userId)
                    .eq('stat_date', new Date().toISOString().split('T')[0]);

                // Award turtle badge immediately for late shift
                await awardBadge(userId, username, 'turtle', {
                    reason: 'late_shift',
                    delay_minutes: Math.floor(delayMinutes),
                    achieved_at: new Date().toISOString()
                });
            }
        } else if (type === 'slow_response') {
            log(`[Turtle] Slow response detected: ${username} - ${Math.floor(delayMinutes)} minutes`);

            // Update slow_responses stat
            const newSlowResponses = stats.slow_responses + 1;

            await _supabase
                .from('badge_stats')
                .update({
                    slow_responses: newSlowResponses,
                    updated_at: new Date().toISOString()
                })
                .eq('user_id', userId)
                .eq('stat_date', new Date().toISOString().split('T')[0]);

            // Award badge immediately for ANY slow response (>30 min)
            await awardBadge(userId, username, 'turtle', {
                reason: 'slow_response',
                delay_minutes: Math.floor(delayMinutes),
                slow_response_count: newSlowResponses,
                achieved_at: new Date().toISOString()
            });
        }
    } catch (err) {
        logError('[Badges] Error checking Turtle:', err);
    }
}

/**
 * Check Client Hero Badge (Daily Reset)
 *
 * ⚠️ DEPRECATED: This function is NO LONGER USED to prevent duplicate awards
 * Client Hero badge is now awarded ONLY by the server-side edge function (cron job at 11 PM GMT / 1 AM GMT+2)
 *
 * The edge function:
 * - Awards Client Hero badge to highest scorer at 11 PM GMT
 * - Awards +15 points for earning the badge
 * - Checks for Perfect Day (all 4 badges) → awards +50 points
 *
 * This function is kept for reference but should not be called in production.
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
            .eq('team_id', appState.currentUserTeamId)
            .gte('created_at', yesterdayStart)
            .lte('created_at', yesterdayEndStr);

        if (error) {
            logError('[Badges] Error fetching user points:', error);
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
        logError('[Badges] Error checking Client Hero:', err);
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
        logError('[Badges] Error checking Perfect Day:', err);
    }
}

/**
 * Send Perfect Day notification to all users
 */
async function sendPerfectDayNotification(username) {
    try {
        // Get all user IDs and usernames from user_settings table (team-scoped)
        const { data: userSettings, error } = await _supabase
            .from('user_settings')
            .select('user_id, display_name')
            .eq('team_id', appState.currentUserTeamId);

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
        logError('[Badges] Error sending Perfect Day notification:', err);
    }
}

/**
 * Award badge to user
 */
async function awardBadge(userId, username, badgeId, metadata = {}) {
    try {
        // Check if user already has this badge today (one badge per day restriction)
        // IMPORTANT: Do NOT filter by is_active - we want to check ALL badges awarded today,
        // even if they were later deactivated by the daily reset
        const today = new Date().toISOString().split('T')[0];
        const { data: existingBadges, error: checkError } = await _supabase
            .from('user_badges')
            .select('id')
            .eq('user_id', userId)
            .eq('badge_id', badgeId)
            .gte('achieved_at', `${today}T00:00:00`)
            .lte('achieved_at', `${today}T23:59:59`);

        if (checkError) {
            logError('[Badges] Error checking existing badge:', checkError);
        }

        // If badge already awarded today (regardless of is_active status), skip
        if (existingBadges && existingBadges.length > 0) {
            log(`[Badges] Badge ${badgeId} already awarded to ${username} today - skipping duplicate`);
            return false;
        }

        // Award the badge
        const { data, error } = await _supabase.rpc('award_badge', {
            p_user_id: userId,
            p_username: username,
            p_badge_id: badgeId,
            p_metadata: metadata,
            p_team_id: appState.currentUserTeamId
        });

        if (error) throw error;

        // Send notification to the badge recipient
        const badgeConfig = BADGES[badgeId];
        if (badgeConfig) {
            await _supabase.from('badge_notifications').insert({
                user_id: userId,
                username: username,
                badge_id: badgeId,
                badge_name: badgeConfig.name,
                badge_emoji: badgeConfig.emoji,
                message: `You earned the ${badgeConfig.name} badge! ${badgeConfig.emoji}`,
                is_read: false,
                created_at: new Date().toISOString()
            });
        }

        // Check for "Perfect Day" achievement
        await checkPerfectDay(userId, username);

        // Refresh badges display
        if (window.badges && window.badges.refreshBadgesDisplay) {
            window.badges.refreshBadgesDisplay();
        }

        return data;
    } catch (err) {
        logError('[Badges] Error awarding badge:', err);
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
async function showBadgeNotification(notification) {
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

    // Mark notification as read since it auto-dismisses
    try {
        await _supabase
            .from('badge_notifications')
            .update({ is_read: true })
            .eq('id', notification.id);
    } catch (err) {
        logError('[Badges] Error marking notification as read:', err);
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
 * REMOVED: setupDailyReset() and resetDailyBadges()
 *
 * These functions have been removed to prevent premature badge resets caused by:
 * - Multiple browser instances creating duplicate timers
 * - Timezone discrepancies (each client calculated midnight in their own timezone)
 * - Client-side vulnerability allowing any user to trigger system-wide resets
 *
 * Daily badge reset is now handled exclusively by the existing server-side cron job
 * that runs at 1 AM GMT+2 (23:00 UTC) via CLIENT_HERO_CHECK
 */

/**
 * Retroactively check and award Lightning badge for existing tickets
 * Call this from console: await badges.retroactivelyCheckLightningBadge(userId, username)
 *
 * @param {string} userId - User ID to check
 * @param {string} username - Username
 */
export async function retroactivelyCheckLightningBadge(userId, username) {
    log(`[Retroactive Lightning] Starting retroactive check for user: ${username} (${userId})`);

    try {
        // Call the regular checkLightningBadge function with no specific ticket
        // This will check ALL completed tickets from today for the user
        await checkLightningBadge(userId, username, null, new Date().toISOString());

        log(`[Retroactive Lightning] ✅ Retroactive check completed for ${username}`);
        log(`[Retroactive Lightning] Check the logs above to see qualifying tickets and badge status`);

        // Fetch and display the current badge_stats for confirmation
        const today = new Date().toISOString().split('T')[0];
        const { data: stats, error } = await _supabase
            .from('badge_stats')
            .select('fast_responses')
            .eq('user_id', userId)
            .eq('stat_date', today)
            .single();

        if (!error && stats) {
            log(`[Retroactive Lightning] 📊 Current fast_responses count: ${stats.fast_responses}`);
        }

        // Check if badge was awarded
        const { data: badge, error: badgeError } = await _supabase
            .from('user_badges')
            .select('*')
            .eq('user_id', userId)
            .eq('badge_id', 'lightning')
            .eq('is_active', true)
            .gte('achieved_at', `${today}T00:00:00`)
            .lte('achieved_at', `${today}T23:59:59`)
            .single();

        if (!badgeError && badge) {
            log(`[Retroactive Lightning] 🏆 Lightning badge awarded at: ${badge.achieved_at}`);
        } else {
            log(`[Retroactive Lightning] Badge not yet awarded (need 3+ qualifying tickets)`);
        }

    } catch (err) {
        logError('[Retroactive Lightning] Error during retroactive check:', err);
    }
}

// Export functions
window.badges = {
    initializeBadges,
    checkSpeedDemonBadge,
    checkSniperBadge,
    checkLightningBadge,
    checkTurtleBadge,
    checkClientHeroBadge,
    retroactivelyCheckLightningBadge
};
