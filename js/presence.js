// js/presence.js - User presence tracking system

import { _supabase } from './config.js';
import { appState } from './state.js';

let heartbeatInterval = null;
let lastActivityTime = Date.now();
const HEARTBEAT_INTERVAL = 30000; // 30 seconds
const OFFLINE_THRESHOLD = 60000; // 1 minute - user is considered offline if no heartbeat for 1 min
const IDLE_THRESHOLD = 300000; // 5 minutes - user is considered idle after 5 min of inactivity

/**
 * Initialize presence tracking for current user
 */
export async function initializePresence() {
    if (!appState.currentUser) {
        console.warn('[Presence] No current user, skipping presence initialization');
        return;
    }

    console.log('[Presence] Initializing presence tracking for', appState.currentUser.email);

    // Send initial presence
    await updatePresence('online');

    // Start heartbeat interval
    startHeartbeat();

    // Track user activity
    trackUserActivity();

    // Handle page visibility changes
    handleVisibilityChange();

    // Cleanup on page unload
    handlePageUnload();

    console.log('[Presence] Presence tracking initialized');
}

/**
 * Start sending periodic heartbeats
 */
function startHeartbeat() {
    // Clear any existing interval
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }

    // Send heartbeat every 30 seconds
    heartbeatInterval = setInterval(async () => {
        const timeSinceActivity = Date.now() - lastActivityTime;
        const status = timeSinceActivity > IDLE_THRESHOLD ? 'idle' : 'online';
        await updatePresence(status);
    }, HEARTBEAT_INTERVAL);
}

/**
 * Update user presence in database
 */
async function updatePresence(status = 'online') {
    try {
        const { error } = await _supabase
            .from('user_presence')
            .upsert({
                user_id: appState.currentUser.id,
                username: appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0],
                status: status,
                last_seen: new Date().toISOString()
            }, {
                onConflict: 'user_id'
            });

        if (error) {
            console.error('[Presence] Error updating presence:', error);
        } else {
            console.log('[Presence] Updated presence:', status);
        }
    } catch (err) {
        console.error('[Presence] Exception updating presence:', err);
    }
}

/**
 * Track user activity (mouse, keyboard, touch)
 */
function trackUserActivity() {
    const updateActivity = () => {
        lastActivityTime = Date.now();
    };

    // Track mouse movement, clicks, keyboard, and touch
    ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'].forEach(event => {
        document.addEventListener(event, updateActivity, { passive: true });
    });
}

/**
 * Handle page visibility changes (tab switching, minimizing)
 */
function handleVisibilityChange() {
    document.addEventListener('visibilitychange', async () => {
        if (document.hidden) {
            // Tab is hidden - mark as idle
            console.log('[Presence] Tab hidden, marking as idle');
            await updatePresence('idle');
        } else {
            // Tab is visible - mark as online
            console.log('[Presence] Tab visible, marking as online');
            lastActivityTime = Date.now();
            await updatePresence('online');
        }
    });
}

/**
 * Handle page unload to mark user offline
 */
function handlePageUnload() {
    const markOffline = async () => {
        // Use sendBeacon for reliable offline notification
        const data = {
            user_id: appState.currentUser.id,
            username: appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0],
            status: 'offline',
            last_seen: new Date().toISOString()
        };

        // Try sendBeacon first (most reliable)
        try {
            const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
            navigator.sendBeacon(
                `${_supabase.supabaseUrl}/rest/v1/user_presence?on_conflict=user_id`,
                blob
            );
        } catch (err) {
            console.error('[Presence] Beacon failed:', err);
        }
    };

    window.addEventListener('beforeunload', markOffline);
    window.addEventListener('pagehide', markOffline);
}

/**
 * Stop presence tracking (cleanup)
 */
export function stopPresence() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }

    // Mark user offline
    updatePresence('offline');

    console.log('[Presence] Presence tracking stopped');
}

/**
 * Get all active users (online or idle within threshold)
 */
export async function getActiveUsers() {
    try {
        const thresholdTime = new Date(Date.now() - OFFLINE_THRESHOLD);

        const { data, error } = await _supabase
            .from('user_presence')
            .select('*')
            .gte('last_seen', thresholdTime.toISOString());

        if (error) throw error;

        return data || [];
    } catch (err) {
        console.error('[Presence] Error fetching active users:', err);
        return [];
    }
}

/**
 * Subscribe to presence changes
 */
export function subscribeToPresence(callback) {
    const channel = _supabase
        .channel('user_presence_changes')
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: 'user_presence'
        }, (payload) => {
            console.log('[Presence] Change detected:', payload);
            if (callback) callback(payload);
        })
        .subscribe();

    return channel;
}
