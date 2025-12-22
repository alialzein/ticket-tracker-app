// Supabase Edge Function: check-and-send-reminders
// This function should run every 5 minutes via cron job
//
// SETUP: Run SETUP_reminders_cron_job.sql in Supabase SQL Editor to schedule this function
// Cron schedule: */5 * * * * (every 5 minutes)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

Deno.serve(async (req) => {
    try {
        const supabaseAdmin = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
            {
                auth: {
                    autoRefreshToken: false,
                    persistSession: false
                }
            }
        );

        const now = new Date();
        console.log(`[Reminders] Checking deployment notes at ${now.toISOString()}`);

        // Fetch active deployment notes that haven't completed all notifications
        const { data: deploymentNotes, error: fetchError } = await supabaseAdmin
            .from('deployment_notes')
            .select('*')
            .eq('is_completed', false)
            .or('reminder_30_sent.eq.false,reminder_15_sent.eq.false')
            .order('deployment_date', { ascending: true })
            .order('deployment_time', { ascending: true });

        if (fetchError) {
            console.error('[Reminders] Error fetching reminders:', fetchError);
            throw fetchError;
        }

        if (!deploymentNotes || deploymentNotes.length === 0) {
            console.log('[Reminders] No pending deployment notes found');
            return new Response(JSON.stringify({ success: true, message: 'No reminders to process' }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        console.log(`[Reminders] Found ${deploymentNotes.length} pending deployment notes`);

        let remindersSent = 0;

        for (const note of deploymentNotes) {
            // Combine deployment_date and deployment_time to get scheduled datetime
            // Times are stored in local timezone (GMT+2)
            // User enters "17:10" which means 17:10 local time (GMT+2)
            // We need to convert this to UTC for comparison: 17:10 GMT+2 = 15:10 UTC
            let scheduledTime;
            if (note.deployment_time) {
                // Create datetime string: "2025-12-02T17:10"
                const dateTimeStr = `${note.deployment_date}T${note.deployment_time}`;
                // Parse as if it's UTC (because Deno interprets it that way)
                const parsedTime = new Date(dateTimeStr);
                // SUBTRACT 2 hours because the time represents GMT+2, not UTC
                // Example: DB has "17:10" (GMT+2) -> we want UTC "15:10"
                scheduledTime = new Date(parsedTime.getTime() - (2 * 60 * 60 * 1000));
            } else {
                const parsedTime = new Date(`${note.deployment_date}T00:00:00`);
                scheduledTime = new Date(parsedTime.getTime() - (2 * 60 * 60 * 1000));
            }

            const minutesUntil = Math.floor((scheduledTime - now) / 60000);

            console.log(`[Reminders] Note ID ${note.id}: "${note.note_text}" - DB time (GMT+2): ${note.deployment_time}, Scheduled UTC: ${scheduledTime.toISOString()}, Current UTC: ${now.toISOString()}, Minutes until: ${minutesUntil}`);

            // Check if 30-minute reminder should be sent
            // Only send if we're within 5 minutes of the 30-minute mark (25-30 minutes before)
            if (!note.reminder_30_sent && minutesUntil <= 30 && minutesUntil >= 25) {
                console.log(`[Reminders] Sending 30-minute reminder for: ${note.note_text}`);

                // Broadcast to all users
                const { error: broadcastError } = await supabaseAdmin.rpc('broadcast_deployment_reminder', {
                    p_note_id: note.id,
                    p_note_text: note.note_text,
                    p_note_type: note.type,
                    p_deployment_date: note.deployment_date,
                    p_deployment_time: note.deployment_time,
                    p_minutes_before: 30
                });

                if (broadcastError) {
                    console.error(`[Reminders] Error broadcasting 30-min reminder:`, broadcastError);
                } else {
                    // Mark 30-minute reminder as sent
                    await supabaseAdmin
                        .from('deployment_notes')
                        .update({
                            reminder_30_sent: true,
                            reminder_30_sent_at: now.toISOString()
                        })
                        .eq('id', note.id);

                    remindersSent++;
                    console.log(`[Reminders] ✓ 30-minute reminder sent for: ${note.note_text}`);
                }
            }

            // Check if 15-minute reminder should be sent
            // Only send if we're within 5 minutes of the 15-minute mark (10-15 minutes before)
            if (!note.reminder_15_sent && minutesUntil <= 15 && minutesUntil >= 10) {
                console.log(`[Reminders] Sending 15-minute reminder for: ${note.note_text}`);

                // Broadcast to all users
                const { error: broadcastError } = await supabaseAdmin.rpc('broadcast_deployment_reminder', {
                    p_note_id: note.id,
                    p_note_text: note.note_text,
                    p_note_type: note.type,
                    p_deployment_date: note.deployment_date,
                    p_deployment_time: note.deployment_time,
                    p_minutes_before: 15
                });

                if (broadcastError) {
                    console.error(`[Reminders] Error broadcasting 15-min reminder:`, broadcastError);
                } else {
                    // Mark 15-minute reminder as sent
                    await supabaseAdmin
                        .from('deployment_notes')
                        .update({
                            reminder_15_sent: true,
                            reminder_15_sent_at: now.toISOString()
                        })
                        .eq('id', note.id);

                    remindersSent++;
                    console.log(`[Reminders] ✓ 15-minute reminder sent for: ${note.note_text}`);
                }
            }

            // If event has passed, mark as completed (regardless of whether reminders were sent)
            // This handles cases where reminders were missed or the time window passed
            if (minutesUntil < -5) {  // Event passed more than 5 minutes ago
                await supabaseAdmin
                    .from('deployment_notes')
                    .update({ is_completed: true })
                    .eq('id', note.id);

                console.log(`[Reminders] Note ${note.id} marked as completed (event passed ${Math.abs(minutesUntil)} minutes ago)`);
            }
        }

        // ===== CHECK TRAINING SESSIONS FOR REMINDERS =====
        console.log(`[Training Reminders] Checking training sessions at ${now.toISOString()}`);

        // Fetch active training sessions that haven't completed and have reminders pending
        const { data: trainingSessions, error: trainingFetchError } = await supabaseAdmin
            .from('training_sessions')
            .select('id, user_id, client_name, session_number, session_date, session_time, reminder_30_sent, reminder_15_sent, is_completed')
            .eq('is_completed', false)
            .or('reminder_30_sent.eq.false,reminder_15_sent.eq.false')
            .order('session_date', { ascending: true })
            .order('session_time', { ascending: true });

        if (trainingFetchError) {
            console.error('[Training Reminders] Error fetching training sessions:', trainingFetchError);
        } else if (trainingSessions && trainingSessions.length > 0) {
            console.log(`[Training Reminders] Found ${trainingSessions.length} pending training sessions`);

            let trainingRemindersSent = 0;

            for (const session of trainingSessions) {
                if (!session.session_date || !session.session_time) {
                    console.log(`[Training Reminders] Session ${session.id} skipped - no date/time set`);
                    continue;
                }

                // Combine session_date and session_time to get scheduled datetime
                const dateTimeStr = `${session.session_date}T${session.session_time}`;
                const parsedTime = new Date(dateTimeStr);
                // SUBTRACT 2 hours because the time represents GMT+2, not UTC
                const scheduledTime = new Date(parsedTime.getTime() - (2 * 60 * 60 * 1000));

                const minutesUntil = Math.floor((scheduledTime - now) / 60000);

                console.log(`[Training Reminders] Session ${session.id}: Client "${session.client_name}" - Scheduled UTC: ${scheduledTime.toISOString()}, Current UTC: ${now.toISOString()}, Minutes until: ${minutesUntil}`);

                // Check if 30-minute reminder should be sent
                if (!session.reminder_30_sent && minutesUntil <= 30 && minutesUntil >= 25) {
                    console.log(`[Training Reminders] Sending 30-minute reminder for: ${session.client_name}`);

                    // Create broadcast for the user
                    const reminderMessage = `📚 REMINDER: Your training session "${session.client_name}" is starting in 30 minutes at ${session.session_time}!`;
                    const { error: broadcastError } = await supabaseAdmin
                        .from('broadcast_messages')
                        .insert({
                            user_id: session.user_id,
                            message: reminderMessage,
                            is_active: true,
                            message_type: 'training_reminder'
                        });

                    if (broadcastError) {
                        console.error(`[Training Reminders] Error broadcasting 30-min reminder:`, broadcastError);
                    } else {
                        // Mark 30-minute reminder as sent
                        await supabaseAdmin
                            .from('training_sessions')
                            .update({
                                reminder_30_sent: true,
                                reminder_30_sent_at: now.toISOString()
                            })
                            .eq('id', session.id);

                        trainingRemindersSent++;
                        console.log(`[Training Reminders] ✓ 30-minute reminder sent for: ${session.client_name}`);
                    }
                }

                // Check if 15-minute reminder should be sent
                if (!session.reminder_15_sent && minutesUntil <= 15 && minutesUntil >= 10) {
                    console.log(`[Training Reminders] Sending 15-minute reminder for: ${session.client_name}`);

                    // Create broadcast for the user
                    const reminderMessage = `📚 URGENT: Your training session "${session.client_name}" is starting in 15 minutes!`;
                    const { error: broadcastError } = await supabaseAdmin
                        .from('broadcast_messages')
                        .insert({
                            user_id: session.user_id,
                            message: reminderMessage,
                            is_active: true,
                            message_type: 'training_reminder'
                        });

                    if (broadcastError) {
                        console.error(`[Training Reminders] Error broadcasting 15-min reminder:`, broadcastError);
                    } else {
                        // Mark 15-minute reminder as sent
                        await supabaseAdmin
                            .from('training_sessions')
                            .update({
                                reminder_15_sent: true,
                                reminder_15_sent_at: now.toISOString()
                            })
                            .eq('id', session.id);

                        trainingRemindersSent++;
                        console.log(`[Training Reminders] ✓ 15-minute reminder sent for: ${session.client_name}`);
                    }
                }
            }

            remindersSent += trainingRemindersSent;
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: `Processed ${deploymentNotes.length} deployment notes and ${trainingSessions ? trainingSessions.length : 0} training sessions, sent ${remindersSent} notifications`,
                notes_checked: deploymentNotes.length,
                sessions_checked: trainingSessions ? trainingSessions.length : 0,
                notifications_sent: remindersSent
            }),
            { headers: { 'Content-Type': 'application/json' } }
        );

    } catch (error) {
        console.error('[Reminders] Fatal error:', error);
        return new Response(
            JSON.stringify({ success: false, error: error.message }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
});
