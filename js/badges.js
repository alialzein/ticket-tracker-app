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
        description: 'Close 6 tickets within 30 min of latest assignment (or creation if never assigned)',
        reset: 'daily'
    },
    sniper: {
        id: 'sniper',
        name: 'Sniper',
        emoji: '🎯',
        description: 'Create or assign 4 tickets within 30 minutes (tag AS does not count)',
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
        description: 'Late shift start (>30 min) or slow response (>60 min)',
        reset: 'daily'
    }
};

const SNIPER_ACTIVITY_TYPES = ['TICKET_CREATED', 'TICKET_ASSIGNED'];
const SNIPER_REQUIRED_TICKETS = 4;
const SNIPER_WINDOW_MINUTES = 30;
const SNIPER_EXCLUDED_TAG = 'AS';

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
 * Awards badge if 6 tickets are closed within 30 minutes of:
 * 1. Latest assignment time (assigned_at) if present
 * 2. Creation time (created_at) only if never assigned
 */
export async function checkSpeedDemonBadge(userId, username, ticketId, actionTime) {
    try {
        log(`[Speed Demon] Checking for user: ${username}`);
        const today = new Date().toISOString().split('T')[0];

        // Get all tickets closed by this user today
        const { data: closedTickets, error } = await _supabase
            .from('tickets')
            .select('id, created_at, completed_at, assigned_at')
            .eq('completed_by_name', username)
            .eq('status', 'Done')
            .gte('completed_at', `${today}T00:00:00`)
            .lte('completed_at', `${today}T23:59:59`);

        if (error) {
            logError('[Speed Demon] Error fetching closed tickets:', error);
            return;
        }

        log(`[Speed Demon] Found ${closedTickets?.length || 0} closed tickets for ${username}`);

        // Count tickets closed within 30 minutes of latest assignment.
        // Fallback to creation time only when the ticket has never been assigned.
        let fastClosureCount = 0;
        closedTickets?.forEach(ticket => {
            const completed = new Date(ticket.completed_at);
            const hasAssignment = !!ticket.assigned_at;
            const referenceTime = hasAssignment
                ? new Date(ticket.assigned_at)
                : new Date(ticket.created_at);
            const referenceType = hasAssignment ? 'last_assigned' : 'created';
            const referenceRaw = hasAssignment ? ticket.assigned_at : ticket.created_at;

            const diffMinutes = (completed - referenceTime) / (1000 * 60);
            log(`[Speed Demon] Ticket ${ticket.id}: ${referenceType} at ${referenceRaw}, completed at ${ticket.completed_at}, minutes: ${diffMinutes.toFixed(2)}`);

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
 * Triggered when a ticket is created or assigned.
 * Awards when user creates/assigns 4 unique tickets within 30 minutes.
 * Tickets tagged with AS are excluded.
 */
export async function checkSniperBadge(userId, username, actionType = null, actionTicketId = null) {
    try {
        log(`[Sniper] Checking for user: ${username}`);
        if (!actionType || !SNIPER_ACTIVITY_TYPES.includes(actionType)) {
            logWarn(`[Sniper] Ignored unsupported action type: ${actionType}`);
            return;
        }

        const nowIso = new Date().toISOString();
        const windowStartIso = new Date(Date.now() - (SNIPER_WINDOW_MINUTES * 60 * 1000)).toISOString();

        // Load this user's recent create/assign actions inside the sniper time window.
        const { data: actions, error: actionsError } = await _supabase
            .from('activity_log')
            .select('id, user_id, activity_type, details, created_at')
            .eq('team_id', appState.currentUserTeamId)
            .eq('user_id', userId)
            .in('activity_type', SNIPER_ACTIVITY_TYPES)
            .gte('created_at', windowStartIso)
            .order('created_at', { ascending: false })
            .limit(200);

        if (actionsError) {
            logError('[Sniper] Error fetching team actions:', actionsError);
            return;
        }

        // If the just-triggered action has not been persisted yet, prepend a synthetic one.
        const recentActions = actions || [];
        const hasCurrentAction = recentActions.some((action, index) => {
            if (index > 4) return false;
            const isSameUser = action.user_id === userId;
            const isSameType = action.activity_type === actionType;
            const sameTicket = actionTicketId == null
                || Number(action?.details?.ticket_id) === Number(actionTicketId);
            const withinWindow = Math.abs(new Date(nowIso) - new Date(action.created_at)) <= 15000;
            return isSameUser && isSameType && sameTicket && withinWindow;
        });

        const actionStream = hasCurrentAction
            ? recentActions
            : [{ user_id: userId, activity_type: actionType, created_at: nowIso, details: { ticket_id: actionTicketId } }, ...recentActions];

        // Keep only unique ticket IDs so repeated activity on the same ticket doesn't overcount.
        const uniqueTicketIds = [];
        const seenTicketIds = new Set();
        for (const action of actionStream) {
            const ticketId = Number(action?.details?.ticket_id);
            if (!Number.isFinite(ticketId) || seenTicketIds.has(ticketId)) {
                continue;
            }
            seenTicketIds.add(ticketId);
            uniqueTicketIds.push(ticketId);
        }

        if (uniqueTicketIds.length === 0) {
            log('[Sniper] No ticket IDs found in recent actions.');
            return;
        }

        // Load tags for candidate tickets and exclude tickets containing AS tag.
        const { data: ticketRows, error: ticketError } = await _supabase
            .from('tickets')
            .select('id, tags')
            .in('id', uniqueTicketIds);

        if (ticketError) {
            logError('[Sniper] Error fetching ticket tags:', ticketError);
            return;
        }

        const eligibleTicketIds = new Set();
        (ticketRows || []).forEach(ticket => {
            const rawTags = Array.isArray(ticket.tags)
                ? ticket.tags
                : (typeof ticket.tags === 'string' ? [ticket.tags] : []);

            const hasExcludedTag = rawTags.some(tag =>
                String(tag || '').trim().toUpperCase() === SNIPER_EXCLUDED_TAG
            );

            if (!hasExcludedTag) {
                eligibleTicketIds.add(Number(ticket.id));
            }
        });

        let windowCount = 0;
        for (const ticketId of uniqueTicketIds) {
            if (eligibleTicketIds.has(ticketId)) {
                windowCount++;
            }
        }

        const stats = await getUserBadgeStats(userId, username);
        if (!stats) return;

        const maxWindowCount = Math.max(stats.max_consecutive_tickets || 0, windowCount);

        const { error: updateError } = await _supabase
            .from('badge_stats')
            .update({
                consecutive_tickets: windowCount,
                max_consecutive_tickets: maxWindowCount,
                updated_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .eq('stat_date', new Date().toISOString().split('T')[0]);

        if (updateError) {
            logError('[Sniper] Error updating badge_stats:', updateError);
            return;
        }

        log(`[Sniper] Updated badge_stats - window_count: ${windowCount}, max_window_count: ${maxWindowCount}`);

        // Award badge if user handled enough eligible tickets in the rolling window.
        if (windowCount >= SNIPER_REQUIRED_TICKETS) {
            log(`[Sniper] Awarding badge! Count: ${windowCount}`);
            await awardBadge(userId, username, 'sniper', {
                count: windowCount,
                required_count: SNIPER_REQUIRED_TICKETS,
                window_minutes: SNIPER_WINDOW_MINUTES,
                excluded_tag: SNIPER_EXCLUDED_TAG,
                achieved_at: new Date().toISOString()
            });
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
            if (delayMinutes > 30) {
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

            // Award badge immediately for ANY slow response (>60 min)
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

            // Send notification to the achiever's team only
            await sendPerfectDayNotification(userId, username);
        }
    } catch (err) {
        logError('[Badges] Error checking Perfect Day:', err);
    }
}

/**
 * Send Perfect Day notification to all users
 */
async function sendPerfectDayNotification(userId, username) {
    try {
        // Look up the achiever's team directly from DB (don't rely on appState)
        const { data: achiever } = await _supabase
            .from('user_settings')
            .select('team_id')
            .eq('user_id', userId)
            .maybeSingle();

        if (!achiever?.team_id) return;

        // Get all users in the same team only
        const { data: userSettings, error } = await _supabase
            .from('user_settings')
            .select('user_id, display_name')
            .eq('team_id', achiever.team_id);

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

        // Notify the whole team (recipient sees "You earned…", others see "<name> earned…")
        const badgeConfig = BADGES[badgeId];
        if (badgeConfig) {
            await _supabase.rpc('notify_team_badge', {
                p_recipient_user_id: userId,
                p_recipient_username: username,
                p_badge_id:          badgeId,
                p_badge_name:        badgeConfig.name,
                p_badge_emoji:       badgeConfig.emoji,
                p_team_id:           appState.currentUserTeamId
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

