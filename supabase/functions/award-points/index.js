import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Standard CORS headers
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-runtime',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
  'Access-Control-Max-Age': '3600'
};

// Helper function for priority points
const getPriorityPoints = (priority) => {
  switch (priority) {
    case 'Low': return 8;
    case 'Medium': return 9;
    case 'High': return 9;
    case 'Urgent': return 9;
    default: return 0;
  }
};

// Helper function to calculate string similarity (Levenshtein distance)
function calculateSimilarity(str1, str2) {
  const s1 = str1.toLowerCase().trim();
  const s2 = str2.toLowerCase().trim();

  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;

  if (longer.length === 0) return 1.0;

  const editDistance = getEditDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function getEditDistance(str1, str2) {
  const costs = [];
  for (let i = 0; i <= str1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= str2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (str1.charAt(i - 1) !== str2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[str2.length] = lastValue;
  }
  return costs[str2.length];
}

Deno.serve(async (req) => {
  console.log('[Award Points] Function invoked - Method:', req.method);

  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  }

  try {
    const requestBody = await req.json();
    console.log('[Award Points] Request body received:', JSON.stringify(requestBody));

    let { eventType, userId, username, data } = requestBody;

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Handle Client Hero cron job (special case - no userId/username required)
    if (eventType === 'CLIENT_HERO_CHECK') {
      console.log('[Client Hero] Starting Client Hero check...');

      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();

      // Determine which date to check based on current time
      // Between 11:00 PM (23:00) and 11:55 PM (23:55) GMT: check today
      // Any other time: check yesterday
      let targetDate;
      let dateLabel;

      if (currentHour === 23 && currentMinute >= 0 && currentMinute <= 55) {
        // Check today's scores (11 PM window)
        targetDate = now.toISOString().split('T')[0];
        dateLabel = 'today';
        console.log('[Client Hero] Running in 11 PM window - checking today\'s scores');
      } else {
        // Check yesterday's scores
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        targetDate = yesterday.toISOString().split('T')[0];
        dateLabel = 'yesterday';
        console.log('[Client Hero] Running outside 11 PM window - checking yesterday\'s scores');
      }

      console.log(`[Client Hero] Target date: ${targetDate}`);

      // Check if target date is a weekend (Saturday = 6, Sunday = 0)
      const targetDateObj = new Date(targetDate + 'T00:00:00Z');
      const dayOfWeek = targetDateObj.getUTCDay();

      if (dayOfWeek === 0 || dayOfWeek === 6) {
        console.log(`[Client Hero] Target date ${targetDate} is a weekend (day ${dayOfWeek}). Skipping Client Hero and Perfect Day checks.`);
        return new Response(
          JSON.stringify({
            success: true,
            message: `Skipped Client Hero check for ${dateLabel} - target date ${targetDate} is a weekend`,
            isWeekend: true,
            targetDate: targetDate,
            dayOfWeek: dayOfWeek === 0 ? 'Sunday' : 'Saturday'
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }

      console.log(`[Client Hero] Target date ${targetDate} is a weekday. Proceeding with checks.`);

      // STEP 1: Deactivate YESTERDAY'S Client Hero badge FIRST (before awarding new one)
      // This ensures clean transition between days
      console.log('[Client Hero] Deactivating previous Client Hero badges...');
      const { error: deactivateError } = await supabaseAdmin
        .from('user_badges')
        .update({ is_active: false })
        .eq('badge_id', 'client_hero')
        .eq('is_active', true);

      if (deactivateError) {
        console.error('[Client Hero] Error deactivating previous badges:', deactivateError);
        // Don't throw - continue with awarding the new badge
      } else {
        console.log('[Client Hero] Successfully deactivated previous Client Hero badge');
      }

      // STEP 2: Get all users' points for the target date
      const { data: userScores, error: scoresError } = await supabaseAdmin
        .from('user_points')
        .select('user_id, username, points_awarded')
        .gte('created_at', `${targetDate}T00:00:00`)
        .lte('created_at', `${targetDate}T23:59:59`);

      if (scoresError) {
        console.error('[Client Hero] Error fetching user scores:', scoresError);
        throw scoresError;
      }

      // Calculate total points per user
      const userTotals = {};
      userScores?.forEach(entry => {
        if (!userTotals[entry.user_id]) {
          userTotals[entry.user_id] = {
            username: entry.username,
            totalPoints: 0
          };
        }
        userTotals[entry.user_id].totalPoints += entry.points_awarded;
      });

      // Find user with highest score
      let highestUserId = null;
      let highestUsername = null;
      let highestScore = -Infinity;

      for (const [userId, data] of Object.entries(userTotals)) {
        if (data.totalPoints > highestScore) {
          highestScore = data.totalPoints;
          highestUserId = userId;
          highestUsername = data.username;
        }
      }

      if (!highestUserId || highestScore <= 0) {
        console.log(`[Client Hero] No eligible users found (no positive scores for ${dateLabel})`);
        return new Response(
          JSON.stringify({ success: true, message: `No eligible users for Client Hero (${dateLabel})` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }

      console.log(`[Client Hero] Winner: ${highestUsername} (${highestUserId}) with ${highestScore} points (${dateLabel})`);

      // Check if Client Hero badge already awarded for this target date
      const { data: existingBadges, error: badgeCheckError } = await supabaseAdmin
        .from('user_badges')
        .select('id, achieved_at')
        .eq('user_id', highestUserId)
        .eq('badge_id', 'client_hero')
        .gte('achieved_at', `${targetDate}T00:00:00`)
        .lte('achieved_at', `${targetDate}T23:59:59`);

      if (badgeCheckError) {
        console.error('[Client Hero] Error checking existing badge:', badgeCheckError);
      }

      if (existingBadges && existingBadges.length > 0) {
        console.log(`[Client Hero] Badge already awarded for ${targetDate}, skipping`);
        return new Response(
          JSON.stringify({ success: true, message: `Client Hero already awarded for ${targetDate}` }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        );
      }

      // STEP 3: Award NEW Client Hero badge
      const { error: badgeError } = await supabaseAdmin
        .from('user_badges')
        .insert({
          user_id: highestUserId,
          username: highestUsername,
          badge_id: 'client_hero',
          achieved_at: new Date().toISOString(),
          reset_period: 'daily',
          is_active: true,
          metadata: {
            total_points: highestScore,
            target_date: targetDate,
            awarded_for: dateLabel
          }
        });

      if (badgeError) {
        console.error('[Client Hero] Error awarding badge:', badgeError);
        throw badgeError;
      }

      console.log('[Client Hero] Badge awarded successfully');

      // Award +10 points for earning the badge
      const { error: pointsError } = await supabaseAdmin
        .from('user_points')
        .insert({
          user_id: highestUserId,
          username: highestUsername,
          event_type: 'BADGE_EARNED',
          points_awarded: 10,
          details: {
            badge_id: 'client_hero',
            reason: `Earned Client Hero badge (highest points ${dateLabel})`,
            total_daily_points: highestScore,
            target_date: targetDate
          },
          created_at: new Date().toISOString()
        });

      if (pointsError) {
        console.error('[Client Hero] Error awarding badge points:', pointsError);
      } else {
        console.log('[Client Hero] Awarded +10 points for badge');
      }

      // STEP 4: Check for Perfect Day (all 4 positive badges, no Turtle) on the target date
      const { data: targetDateBadges, error: badgesError } = await supabaseAdmin
        .from('user_badges')
        .select('badge_id, achieved_at')
        .eq('user_id', highestUserId)
        .gte('achieved_at', `${targetDate}T00:00:00`)
        .lte('achieved_at', `${targetDate}T23:59:59`);

      if (!badgesError && targetDateBadges) {
        const badgeIds = targetDateBadges.map(b => b.badge_id);
        console.log(`[Client Hero] Badges found for ${targetDate}:`, badgeIds);
        console.log(`[Client Hero] Badge details:`, targetDateBadges);

        const hasSpeedDemon = badgeIds.includes('speed_demon');
        const hasSniper = badgeIds.includes('sniper');
        const hasLightning = badgeIds.includes('lightning');
        const hasTurtle = badgeIds.includes('turtle');
        // We just awarded Client Hero in this run, so it counts even if query doesn't show it yet
        const hasClientHero = true;

        console.log(`[Client Hero] Badge check - Speed Demon: ${hasSpeedDemon}, Sniper: ${hasSniper}, Lightning: ${hasLightning}, Client Hero: ${hasClientHero}, Turtle: ${hasTurtle}`);

        if (hasSpeedDemon && hasSniper && hasLightning && hasClientHero && !hasTurtle) {
          console.log(`[Client Hero] Perfect Day detected for ${dateLabel}! Awarding +50 bonus points`);

          const { error: perfectDayError } = await supabaseAdmin
            .from('user_points')
            .insert({
              user_id: highestUserId,
              username: highestUsername,
              event_type: 'PERFECT_DAY',
              points_awarded: 50,
              details: {
                reason: `Perfect Day achieved! All 4 positive badges earned with no Turtle badge (${dateLabel})`,
                badges_earned: ['speed_demon', 'sniper', 'client_hero', 'lightning'],
                target_date: targetDate
              },
              created_at: new Date().toISOString()
            });

          if (perfectDayError) {
            console.error('[Client Hero] Error awarding Perfect Day bonus:', perfectDayError);
          } else {
            console.log('[Client Hero] Perfect Day bonus awarded (+50 points)');
          }

          // Send Perfect Day notification to ALL users (persistent notification)
          const { data: allUsers, error: usersError } = await supabaseAdmin
            .from('user_settings')
            .select('user_id, display_name');

          if (!usersError && allUsers && allUsers.length > 0) {
            const perfectDayNotifications = allUsers.map(user => ({
              user_id: user.user_id,
              username: user.display_name,
              badge_id: 'perfect_day',
              badge_name: 'Perfect Day',
              badge_emoji: '🌟✨🏆⚡',
              message: `${highestUsername} achieved a PERFECT DAY! All badges earned with no Turtle badge! 🎉`,
              is_read: false,
              created_at: new Date().toISOString()
            }));

            const { error: notifError } = await supabaseAdmin
              .from('badge_notifications')
              .insert(perfectDayNotifications);

            if (notifError) {
              console.error('[Client Hero] Error sending Perfect Day notifications:', notifError);
            } else {
              console.log(`[Client Hero] Sent Perfect Day notifications to ${allUsers.length} users`);
            }
          }
        }
      }

      // STEP 5: Reset all OTHER daily badges (Speed Demon, Sniper, Lightning, Turtle)
      // This happens AFTER Perfect Day check, so Perfect Day can be awarded for current day
      console.log('[Daily Badge Reset] Resetting all daily badges except Client Hero...');
      const { error: dailyResetError } = await supabaseAdmin
        .from('user_badges')
        .update({ is_active: false })
        .eq('reset_period', 'daily')
        .neq('badge_id', 'client_hero')
        .eq('is_active', true);

      if (dailyResetError) {
        console.error('[Daily Badge Reset] Error resetting daily badges:', dailyResetError);
      } else {
        console.log('[Daily Badge Reset] Successfully reset Speed Demon, Sniper, Lightning, Turtle badges');
      }

      return new Response(
        JSON.stringify({
          success: true,
          winner: highestUsername,
          userId: highestUserId,
          score: highestScore,
          pointsAwarded: 10,
          badgesReset: true
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Standard event handling requires userId and username
    if (!eventType || !userId || !username) {
      throw new Error("Missing required parameters: eventType, userId, or username.");
    }

    // ⚡ DUPLICATE DETECTION: Check for identical events in the last 5 seconds
    // This prevents double-click submissions due to slow network/response
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();

    const { data: recentEvents, error: recentError } = await supabaseAdmin
      .from('user_points')
      .select('id, created_at, event_type, related_ticket_id')
      .eq('user_id', userId)
      .eq('event_type', eventType)
      .gte('created_at', fiveSecondsAgo)
      .order('created_at', { ascending: false })
      .limit(1);

    if (!recentError && recentEvents && recentEvents.length > 0) {
      const recentEvent = recentEvents[0];

      // Check if this is likely a duplicate:
      // Same event type + same user + (same ticket OR both null) + within 5 seconds
      const sameTicket = (data?.ticketId === null && recentEvent.related_ticket_id === null) ||
                        (data?.ticketId === recentEvent.related_ticket_id);

      if (sameTicket) {
        console.log(`[Duplicate Detection] Blocked duplicate ${eventType} from ${username} (within 5 seconds)`);
        return new Response(
          JSON.stringify({
            success: true,
            pointsAwarded: 0,
            duplicate: true,
            message: 'Duplicate request detected and blocked'
          }),
          {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
            status: 200
          }
        );
      }
    }

    let pointsToAward = 0;
    let reason = '';
    let details = {};
    let relatedTicketId = null;
    let shouldCheckForMilestone = false;

    switch (eventType) {
      case 'ATTACHMENT_ADDED':
        pointsToAward = 3;
        reason = `Added attachment: ${data.fileName}`;
        relatedTicketId = data.ticketId;
        details.fileName = data.fileName;
        break;

      case 'ATTACHMENT_DELETED':
        pointsToAward = -3;
        reason = `Deleted attachment: ${data.fileName}`;
        relatedTicketId = data.ticketId;
        details.fileName = data.fileName;
        break;

      case 'TICKET_LINKED':
        pointsToAward = 3;
        reason = `Linked tickets #${data.ticketId} ↔ #${data.linkedTicketId}`;
        relatedTicketId = data.ticketId;
        details.linkedTicketId = data.linkedTicketId;
        details.relationshipType = data.relationshipType;
        break;

      case 'TICKET_UNLINKED':
        pointsToAward = -3;
        reason = `Unlinked tickets #${data.ticketId} and #${data.unlinkedTicketId}`;
        relatedTicketId = data.ticketId;
        details.unlinkedTicketId = data.unlinkedTicketId;
        break;

      case 'TICKET_DELETED':
        {
          relatedTicketId = data.ticketId;

          // When a ticket is deleted, reverse ALL points for ALL users related to this ticket
          // This includes: opening, closing, notes, attachments, tags, assignments, etc.

          // Get ALL point events for this ticket (all users, all event types)
          const { data: allTicketEvents, error: eventsError } = await supabaseAdmin
            .from('user_points')
            .select('id, user_id, username, event_type, points_awarded, details')
            .eq('related_ticket_id', data.ticketId);

          if (eventsError) {
            console.error('[TICKET_DELETED] Error fetching ticket events:', eventsError);
            pointsToAward = 0;
            reason = 'Error fetching ticket events for deletion';
            break;
          }

          if (!allTicketEvents || allTicketEvents.length === 0) {
            console.log('[TICKET_DELETED] No point events found for ticket');
            pointsToAward = 0;
            reason = 'Ticket deleted (no points to revert)';
            details.action = 'Ticket deleted';
            break;
          }

          console.log(`[TICKET_DELETED] Found ${allTicketEvents.length} point events to reverse for ticket #${data.ticketId}`);

          // Group points by user
          const pointsByUser = {};
          for (const event of allTicketEvents) {
            if (!pointsByUser[event.user_id]) {
              pointsByUser[event.user_id] = {
                username: event.username,
                total: 0,
                events: []
              };
            }
            pointsByUser[event.user_id].total += event.points_awarded;
            pointsByUser[event.user_id].events.push({
              type: event.event_type,
              points: event.points_awarded
            });
          }

          // Create reversal entries for EACH user who earned points from this ticket
          // SKIP the deleting user - they'll get their entry from the standard insert below
          for (const [affectedUserId, userData] of Object.entries(pointsByUser)) {
            // Skip the user who is deleting the ticket (they get their entry below)
            if (affectedUserId === userId) {
              console.log(`[TICKET_DELETED] Skipping ${userData.username} (deleter) - will be handled by standard flow`);
              continue;
            }

            const reversalAmount = -userData.total;

            console.log(`[TICKET_DELETED] Reversing ${userData.total} points from ${userData.username}`);

            const { error: insertError } = await supabaseAdmin.from('user_points').insert({
              user_id: affectedUserId,
              username: userData.username,
              event_type: 'TICKET_DELETED',
              points_awarded: reversalAmount,
              related_ticket_id: relatedTicketId,
              details: {
                reason: `Ticket #${data.ticketId} deleted - reversing all points`,
                action: 'Ticket deleted',
                reverted_points: userData.total,
                events_reversed: userData.events.length,
                deleted_by_user_id: userId,
                deleted_by_username: username,
                affected_events: userData.events
              }
            });

            if (insertError) {
              console.error(`[TICKET_DELETED] Error inserting reversal for user ${userData.username}:`, insertError);
            }
          }

          // For the deleting user's response
          const deleterPoints = pointsByUser[userId];
          if (deleterPoints) {
            pointsToAward = -deleterPoints.total;
            reason = `Ticket deleted (reversing ${deleterPoints.total} points from your actions)`;
            details.action = 'Ticket deleted';
            details.reverted_points = deleterPoints.total;
            details.total_users_affected = Object.keys(pointsByUser).length;
          } else {
            pointsToAward = 0;
            reason = 'Ticket deleted (you had no points from this ticket)';
            details.action = 'Ticket deleted';
            details.total_users_affected = Object.keys(pointsByUser).length;
          }

          break;
        }

      // ✅ CHANGE #3: Check for duplicate/similar tickets (80% similarity)
      case 'TICKET_OPENED':
        {
          relatedTicketId = data.ticketId;
          const currentSubject = data.subject || '';

          // Check for similar tickets created in the last 2 days
          const twoDaysAgo = new Date();
          twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

          const { data: recentTickets, error: ticketsError } = await supabaseAdmin
            .from('tickets')
            .select('subject')
            .neq('id', data.ticketId)
            .gte('created_at', twoDaysAgo.toISOString());

          let isDuplicate = false;
          let similarTicketSubject = '';

          if (!ticketsError && recentTickets) {
            for (const ticket of recentTickets) {
              const similarity = calculateSimilarity(currentSubject, ticket.subject);
              // Duplicate detection at 80% similarity threshold
              if (similarity >= 0.80) {
                isDuplicate = true;
                similarTicketSubject = ticket.subject;
                break;
              }
            }
          }

          if (isDuplicate) {
            pointsToAward = 0;
            reason = `Ticket created with similar subject (80%+ match)`;
            details.duplicate_detection = true;
            details.similar_to = similarTicketSubject;
            details.priority = data.priority;
          } else {
            pointsToAward = getPriorityPoints(data.priority);
            reason = `Ticket created${pointsToAward > 0 ? ` (${data.priority} Priority Bonus)` : ''}`;
            details.priority = data.priority;
            shouldCheckForMilestone = true;
          }
          break;
        }

      case 'SCORE_ADJUSTED':
        {
          const oldBasePoints = getPriorityPoints(data.oldPriority);
          const newBasePoints = getPriorityPoints(data.newPriority);
          const oldTotal = (5 + oldBasePoints) * (data.oldComplexity || 1);
          const newTotal = (5 + newBasePoints) * (data.newComplexity || 1);
          pointsToAward = newTotal - oldTotal;
          reason = `Score adjusted by admin`;
          relatedTicketId = data.ticketId;
          details = {
            old_priority: data.oldPriority,
            new_priority: data.newPriority,
            old_complexity: data.oldComplexity,
            new_complexity: data.newComplexity
          };
          break;
        }

      case 'TICKET_REOPENED':
        {
          relatedTicketId = data.ticketId;

          // Find the most recent TICKET_CLOSED or TICKET_CLOSED_ASSIST event for this ticket
          const { data: lastCloseEvents, error: closeError } = await supabaseAdmin
            .from('user_points')
            .select('id, points_awarded, user_id, username, event_type')
            .eq('related_ticket_id', data.ticketId)
            .in('event_type', ['TICKET_CLOSED', 'TICKET_CLOSED_ASSIST'])
            .order('created_at', { ascending: false });

          if (!closeError && lastCloseEvents && lastCloseEvents.length > 0) {
            // Reverse points for all users who got close points
            for (const closeEvent of lastCloseEvents) {
              const { error: insertError } = await supabaseAdmin.from('user_points').insert({
                user_id: closeEvent.user_id,
                username: closeEvent.username,
                event_type: 'TICKET_REOPENED',
                points_awarded: -closeEvent.points_awarded,
                related_ticket_id: relatedTicketId,
                details: {
                  reason: `Ticket reopened (reversing ${closeEvent.points_awarded} close points)`,
                  action: 'Ticket reopened',
                  reversed_event_type: closeEvent.event_type,
                  reversed_points: closeEvent.points_awarded,
                  reopened_by_user_id: userId,
                  reopened_by_username: username
                }
              });

              if (insertError) {
                console.error('Error inserting reopen reversal:', insertError);
              }
            }

            pointsToAward = 0; // Main event already created above
            reason = 'Ticket reopened (close points reversed for all closers)';
            details.action = 'Ticket reopened';
            details.events_reversed = lastCloseEvents.length;
          } else {
            pointsToAward = 0;
            reason = 'Ticket reopened (no close events to reverse)';
            details.action = 'Ticket reopened';
          }
          break;
        }

      // ✅ CHANGE #2 & #4: Prevent score for quick reopens & distribute score between creator and closer
      case 'TICKET_CLOSED':
        {
          relatedTicketId = data.ticketId;
          console.log(`[TICKET_CLOSED] Starting for ticket #${data.ticketId}`);

          const { data: ticketData, error: ticketError } = await supabaseAdmin
            .from('tickets')
            .select('is_reopened, created_by, completed_at')
            .eq('id', data.ticketId)
            .single();

          if (ticketError) {
            console.error(`[TICKET_CLOSED] Error fetching ticket:`, ticketError);
            pointsToAward = 0;
            reason = 'Error fetching ticket data';
            break;
          }

          console.log(`[TICKET_CLOSED] Ticket data:`, { created_by: ticketData.created_by, closer: userId });

          // First, check if this ticket was flagged as a duplicate when created
          const { data: ticketCreationEvent, error: creationEventError } = await supabaseAdmin
            .from('user_points')
            .select('details')
            .eq('event_type', 'TICKET_OPENED')
            .eq('related_ticket_id', data.ticketId)
            .maybeSingle();

          console.log(`[TICKET_CLOSED] Creation event query result:`, {
            found: !!ticketCreationEvent,
            error: creationEventError,
            duplicate_detection: ticketCreationEvent?.details?.duplicate_detection
          });

          // Only block if explicitly flagged as duplicate (not if event doesn't exist)
          if (ticketCreationEvent?.details?.duplicate_detection === true) {
            // This ticket was flagged as duplicate - no points for closing it
            console.log(`[TICKET_CLOSED] Blocked - duplicate ticket`);
            pointsToAward = 0;
            reason = 'Ticket was flagged as duplicate - no points for closure';
            details.action = 'Duplicate ticket closed';
            details.duplicate_ticket = true;
            break;
          }

          console.log(`[TICKET_CLOSED] Not a duplicate, proceeding with scoring`);

          // Check if this ticket has been reopened
          const { data: reopenEvents, error: reopenError } = await supabaseAdmin
            .from('user_points')
            .select('id, created_at')
            .eq('related_ticket_id', data.ticketId)
            .eq('event_type', 'TICKET_REOPENED')
            .order('created_at', { ascending: false });

          // If ticket was reopened, previous close points were already reversed
          // So we should NOT delete old TICKET_CLOSED events
          const hasBeenReopened = !reopenError && reopenEvents && reopenEvents.length > 0;

          if (!hasBeenReopened) {
            // Only check and delete previous TICKET_CLOSED events if ticket was NOT reopened
            const { data: previousCloseEvents, error: previousCloseError } = await supabaseAdmin
              .from('user_points')
              .select('id, created_at, points_awarded')
              .eq('user_id', userId)
              .eq('event_type', 'TICKET_CLOSED')
              .eq('related_ticket_id', data.ticketId)
              .order('created_at', { ascending: false });

            // If user already received points for a previous closure, remove those points first
            // Then award points for the FINAL/LAST closure
            if (!previousCloseError && previousCloseEvents && previousCloseEvents.length > 0) {
              // Delete the previous point awards (they were for intermediate closures)
              for (const event of previousCloseEvents) {
                await supabaseAdmin
                  .from('user_points')
                  .delete()
                  .eq('id', event.id);
              }

              details.removed_previous_awards = previousCloseEvents.length;
              details.action = 'Final closure - previous closures removed';
            }
          } else {
            details.action = 'Closing after reopen - previous close already reversed';
          }

          // Now award points for this closure (whether it's first or final)
          // Check if closer is the creator
          const isCreator = ticketData.created_by === userId;
          console.log(`[TICKET_CLOSED] Is creator: ${isCreator}`);

          if (isCreator) {
            // Creator closed their own ticket - full points
            pointsToAward = 6;
            reason = 'Ticket closed (creator closed own ticket)';
            details.action = 'Creator closed own ticket';
            console.log(`[TICKET_CLOSED] Awarding ${pointsToAward} points to creator`);
          } else {
            // Different user closed the ticket - distribute points
            // 60% to closer, 40% to creator
            const closerPoints = 4; // 60% of 6 ≈ 4
            const creatorPoints = 2; // 40% of 6 ≈ 2

            pointsToAward = closerPoints;
            reason = 'Ticket closed (60% of points - creator gets 40%)';
            details.action = 'Distributed score between creator and closer';
            details.closer_points = closerPoints;
            details.creator_points = creatorPoints;

            console.log(`[TICKET_CLOSED] Awarding ${closerPoints} to closer, ${creatorPoints} to creator`);

            // Get creator's username from auth.users
            const { data: creatorUser } = await supabaseAdmin.auth.admin.getUserById(ticketData.created_by);

            const creatorUsername = creatorUser?.user?.email?.split('@')[0] || 'Unknown';

            console.log(`[TICKET_CLOSED] Creator username: ${creatorUsername}`);

            // Award points to creator
            const { error: creatorInsertError } = await supabaseAdmin.from('user_points').insert({
              user_id: ticketData.created_by,
              username: creatorUsername,
              event_type: 'TICKET_CLOSED_ASSIST',
              points_awarded: creatorPoints,
              related_ticket_id: relatedTicketId,
              details: {
                reason: 'Ticket closed by another user (40% share)',
                closed_by_user_id: userId,
                closed_by_username: username
              }
            });

            if (creatorInsertError) {
              console.error(`[TICKET_CLOSED] Error inserting creator points:`, creatorInsertError);
            }
          }
          console.log(`[TICKET_CLOSED] Final pointsToAward: ${pointsToAward}`);
          break;
        }

      case 'ASSIGN_TO_SELF':
        {
          relatedTicketId = data.ticketId;

          const { data: ticket, error: fetchError } = await supabaseAdmin
            .from('tickets')
            .select('created_by, created_at, assigned_to_name')
            .eq('id', data.ticketId)
            .single();

          if (fetchError) {
            pointsToAward = 0;
            reason = 'Error fetching ticket for assignment check.';
            break;
          }

          const isCreator = ticket.created_by === userId;
          const wasEverAssigned = !!ticket.assigned_to_name;

          if (isCreator && !wasEverAssigned) {
            pointsToAward = 0;
            reason = 'Creator assigned their own unassigned ticket.';
            details.action = 'Self-assigned own new/untouched ticket';
            break;
          }

          const { data: lastAssignmentEvent, error: lastEventError } = await supabaseAdmin
            .from('user_points')
            .select('created_at, user_id')
            .eq('related_ticket_id', data.ticketId)
            .eq('event_type', 'ASSIGN_TO_SELF')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

          if (lastAssignmentEvent && lastAssignmentEvent.user_id === userId) {
            pointsToAward = 0;
            reason = 'Cannot re-assign the same ticket to yourself for points.';
            details.action = 'Blocked self-reassignment';
            break;
          }

          // Use the referenceTimestamp passed from the client (assigned_at or created_at)
          const referenceTimestamp = data.referenceTimestamp || ticket.created_at;
          const referenceSource = data.referenceTimestamp ? 'assigned_at or created_at' : 'ticket creation time';

          const now = new Date();
          const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
          const isOlderThan2Hours = new Date(referenceTimestamp) < twoHoursAgo;

          if (isOlderThan2Hours) {
            pointsToAward = 6;
            reason = `Assigned an aged ticket to self (based on ${referenceSource})`;
            details.action = 'Assigned ticket after 2-hour window';
            shouldCheckForMilestone = true;
          } else {
            pointsToAward = 0;
            reason = `Assigned a ticket to self within the 2-hour window (based on ${referenceSource})`;
            details.action = 'Assigned ticket too soon for points';
          }

          break;
        }

      case 'NOTE_ADDED':
        {
          const { data: ticket, error: ticketError } = await supabaseAdmin
            .from('tickets')
            .select('notes')
            .eq('id', data.ticketId)
            .single();

          if (ticketError) {
            pointsToAward = 1;
            reason = `Note added to ticket #${data.ticketId} (default score)`;
          } else {
            const userNoteCount = (ticket.notes || []).filter(note => note.user_id === userId).length;
            details.note_number = userNoteCount;

            if (userNoteCount === 1) {
              pointsToAward = 4;
              reason = `First note added to ticket #${data.ticketId}`;
            } else if (userNoteCount === 2) {
              pointsToAward = 3;
              reason = `Second note added to ticket #${data.ticketId}`;
            } else {
              pointsToAward = 2;
              reason = `Note #${userNoteCount} added to ticket #${data.ticketId}`;
            }
          }
          relatedTicketId = data.ticketId;
          break;
        }

      case 'NOTE_DELETED':
        pointsToAward = -4;
        reason = `Note deleted from ticket #${data.ticketId}`;
        relatedTicketId = data.ticketId;
        details.action = 'Note deleted';
        break;

      case 'TICKET_FOLLOWUP_ADDED':
        pointsToAward = 0;
        reason = 'Ticket flagged for follow-up';
        relatedTicketId = data.ticketId;
        details.action = 'Flagged for follow-up';
        break;

      case 'ACCEPT_ASSIGNMENT_QUICKLY':
        pointsToAward = 5;
        reason = 'Accepted assignment quickly';
        relatedTicketId = data.ticketId;
        details.timeToAccept_seconds = data.timeToAccept;
        break;

      case 'SLOW_ACCEPTANCE':
        pointsToAward = -10;
        reason = 'Slow to accept assignment';
        relatedTicketId = data.ticketId;
        details.timeToAccept_seconds = data.timeToAccept;
        break;

      case 'SCHEDULE_ITEM_ADDED':
        pointsToAward = 15;
        reason = `${data.itemType || 'Item'} added to schedule`;
        details.itemType = data.itemType;
        break;

      case 'SCHEDULE_ITEM_DELETED':
        pointsToAward = -15;
        reason = `Schedule item deleted`;
        details.action = 'Schedule item deleted';
        break;

      case 'MEETING_COLLABORATION':
        pointsToAward = 10;
        reason = 'Joined a meeting collaboration';
        details.meetingId = data.meetingId;
        break;

      // ✅ CHANGE #1: Break exceeded penalty
      case 'BREAK_EXCEEDED':
        {
          const minutesExceeded = data.minutesExceeded || 0;
          if (minutesExceeded >= 10) {
            pointsToAward = -20;
            reason = `Break exceeded by ${minutesExceeded} minutes`;
            details.minutes_exceeded = minutesExceeded;
            details.break_type = data.breakType;
            details.action = 'Break time exceeded limit';
          } else {
            pointsToAward = 0;
            reason = 'Break ended within acceptable time';
          }
          break;
        }

      case 'BREAK_TIME_PENALTY':
        {
          pointsToAward = data.penalty_points || -50;
          reason = data.reason || `Total break time exceeded 80 minutes (${data.total_break_minutes} minutes)`;
          details.total_break_minutes = data.total_break_minutes;
          details.penalty_points = pointsToAward;
          details.action = 'Break time limit penalty';
          details.awarded_by = 'system';
          break;
        }

      // ✅ CHANGE #6: Missing shift start penalty
      case 'MISSING_SHIFT_START':
        {
          pointsToAward = -50;
          reason = 'Failed to start shift within 2 hours of scheduled time';
          details.scheduled_start_time = data.scheduledStartTime;
          details.hours_late = data.hoursLate;
          details.action = 'Missing shift start';
          break;
        }

      case 'SHIFT_STARTED':
        {
          const BUSINESS_TIMEZONE_OFFSET_HOURS = 2;
          const nowUTC = new Date();
          const localTime = new Date(nowUTC.getTime() + BUSINESS_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
          const localDateString = localTime.toISOString().split('T')[0];
          const localDayOfWeek = localTime.getUTCDay() === 0 ? 7 : localTime.getUTCDay();

          let { data: scheduleData } = await supabaseAdmin
            .from('schedules')
            .select('shift_start_time')
            .eq('user_id', userId)
            .eq('date', localDateString)
            .single();

          if (!scheduleData) {
            let { data: defaultScheduleData } = await supabaseAdmin
              .from('default_schedules')
              .select('shift_start_time')
              .eq('user_id', userId)
              .eq('day_of_week', localDayOfWeek)
              .single();
            scheduleData = defaultScheduleData;
          }

          if (scheduleData && scheduleData.shift_start_time) {
            const [hour, minute] = scheduleData.shift_start_time.split(':');
            const scheduledStartTimeUTC = new Date(
              Date.UTC(
                localTime.getUTCFullYear(),
                localTime.getUTCMonth(),
                localTime.getUTCDate(),
                parseInt(hour),
                parseInt(minute),
                0,
                0
              )
            );
            scheduledStartTimeUTC.setUTCHours(
              scheduledStartTimeUTC.getUTCHours() - BUSINESS_TIMEZONE_OFFSET_HOURS
            );

            const thirtyMinutesBefore = new Date(scheduledStartTimeUTC.getTime() - 30 * 60 * 1000);
            const tenMinutesAfter = new Date(scheduledStartTimeUTC.getTime() + 10 * 60 * 1000);
            const delayMinutes = (nowUTC.getTime() - scheduledStartTimeUTC.getTime()) / 60000;

            if (nowUTC >= thirtyMinutesBefore && nowUTC <= tenMinutesAfter) {
              pointsToAward = 10;
              reason = 'Shift started on time (Bonus)';
              details.status = 'On-time';
            } else if (delayMinutes >= 15) {
              pointsToAward = -20;
              reason = `Shift started late by ${Math.round(delayMinutes)} minutes`;
              details.status = 'Late';
              details.late_minutes = Math.round(delayMinutes);
            } else {
              pointsToAward = 1;
              reason = 'Shift started';
              details.status = 'Normal';
            }
          } else {
            pointsToAward = 1;
            reason = 'Shift started';
            details.status = 'No schedule found';
          }
          break;
        }

      case 'PERFECT_DAY':
        pointsToAward = 50;
        reason = 'Perfect Day achieved! All 4 positive badges earned with no Turtle badge';
        details.action = 'Perfect Day Achievement';
        details.achievement_type = 'perfect_day';
        details.badges_earned = ['speed_demon', 'sniper', 'client_hero', 'lightning'];
        break;

      case 'KUDOS_RECEIVED':
        pointsToAward = 5;
        reason = `Received kudos from ${data.fromUsername}`;
        relatedTicketId = data.ticketId;
        details.from_user = data.fromUsername;
        details.from_user_id = data.fromUserId;
        break;

      case 'TAG_ADDED':
        pointsToAward = 1;
        reason = `Tag added to ticket #${data.ticketId}`;
        relatedTicketId = data.ticketId;
        details.tag = data.tag;
        details.action = 'Tag added';
        break;

      case 'KB_CREATED':
        pointsToAward = 5;
        reason = `Created knowledge base entry: ${data.title}`;
        relatedTicketId = data.ticketId;
        details.kb_id = data.kbId;
        details.kb_title = data.title;
        details.action = 'Knowledge base entry created';
        break;

      case 'PENALTY_RESTORED':
        pointsToAward = 50;
        reason = 'Break penalty points restored by admin';
        details.awarded_by = data.awardedBy || 'admin';
        details.action = 'Penalty points restored';
        break;

      case 'TRAINING_COMPLETED':
        pointsToAward = 50;
        reason = `Training Session ${data.sessionNumber} Completed - ${data.clientName}`;
        details.session_number = data.sessionNumber;
        details.client_name = data.clientName;
        details.action = 'Training session completed';
        break;

      default:
        reason = `Unknown event type: ${eventType}`;
    }

    // Insert points record
    if (pointsToAward !== 0) {
      const { error: scoreError } = await supabaseAdmin.from('user_points').insert({
        user_id: userId,
        username: username,
        event_type: eventType,
        points_awarded: pointsToAward,
        related_ticket_id: relatedTicketId,
        details: {
          reason,
          ...details
        }
      });

      if (scoreError) {
        console.error("!!! DATABASE INSERT FAILED:", scoreError);
      }
    }

    // Milestone check
    if (shouldCheckForMilestone) {
      const BUSINESS_TIMEZONE_OFFSET_HOURS = 2;
      const nowUTC = new Date();
      const localTime = new Date(nowUTC.getTime() + BUSINESS_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
      const todayStartUTC = new Date(
        Date.UTC(
          localTime.getUTCFullYear(),
          localTime.getUTCMonth(),
          localTime.getUTCDate(),
          0,
          0,
          0,
          0
        )
      );
      todayStartUTC.setUTCHours(todayStartUTC.getUTCHours() - BUSINESS_TIMEZONE_OFFSET_HOURS);

      // Count TICKET_OPENED events and ASSIGN_TO_SELF events that actually awarded points
      // ASSIGN_TO_SELF only counts if it awarded points (aged >2 hours ticket)
      const { data: milestoneEvents, error: countError } = await supabaseAdmin
        .from('user_points')
        .select('event_type, points_awarded, related_ticket_id')
        .eq('user_id', userId)
        .in('event_type', ['TICKET_OPENED', 'ASSIGN_TO_SELF'])
        .gte('created_at', todayStartUTC.toISOString());

      if (countError) {
        console.error("Error checking milestone count:", countError);
        return;
      }

      // Get all deleted tickets for today by this user
      const { data: deletedTickets, error: deletedError } = await supabaseAdmin
        .from('user_points')
        .select('related_ticket_id')
        .eq('user_id', userId)
        .eq('event_type', 'TICKET_DELETED')
        .gte('created_at', todayStartUTC.toISOString());

      const deletedTicketIds = new Set((deletedTickets || []).map(e => e.related_ticket_id));

      // Filter: count TICKET_OPENED (all) + ASSIGN_TO_SELF (only if points_awarded > 0)
      // Exclude tickets that were deleted
      const count = (milestoneEvents || []).filter(event => {
        // Skip if this ticket was deleted
        if (event.related_ticket_id && deletedTicketIds.has(event.related_ticket_id)) {
          return false;
        }

        if (event.event_type === 'TICKET_OPENED') {
          return true; // Count all TICKET_OPENED (that weren't deleted)
        }
        if (event.event_type === 'ASSIGN_TO_SELF') {
          return event.points_awarded > 0; // Only count if it awarded points (aged >2h and not deleted)
        }
        return false;
      }).length;

      const { data: awardedBonuses, error: bonusError } = await supabaseAdmin
        .from('user_points')
        .select('details->milestone')
        .eq('user_id', userId)
        .eq('event_type', 'MILESTONE_BONUS')
        .gte('created_at', todayStartUTC.toISOString());

      if (bonusError) console.error("Error checking awarded bonuses:", bonusError);

      const alreadyAwarded = (awardedBonuses || []).map(b => b.milestone);
      let milestoneToAward = 0;

      if (count >= 15 && !alreadyAwarded.includes(15)) {
        milestoneToAward = 15;
      } else if (count >= 10 && !alreadyAwarded.includes(10)) {
        milestoneToAward = 10;
      }

      if (milestoneToAward > 0) {
        console.log(`AWARDING MILESTONE BONUS: User ${username} hit the ${milestoneToAward} ticket milestone!`);
        const message = `🎉 Congratulations to ${username} for handling ${milestoneToAward} tickets today! Keep up the great work! 🎉`;

        // Create a single milestone notification that all users can see
        await supabaseAdmin.from('milestone_notifications').insert({
          achieved_by_user_id: userId,
          achieved_by_username: username,
          milestone_count: milestoneToAward,
          message: message,
          created_at: new Date().toISOString()
        });

        await supabaseAdmin.from('user_points').insert({
          user_id: userId,
          username: username,
          event_type: 'MILESTONE_BONUS',
          points_awarded: 20,
          details: {
            reason: `Hit the ${milestoneToAward} tickets milestone today!`,
            milestone: milestoneToAward
          }
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        pointsAwarded: pointsToAward
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
