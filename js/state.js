// js/state.js
// This file holds the single source of truth for the application's shared state.

export let appState = {
    currentUser: null,
    currentShiftId: null,
    selectedSource: null,
    tickets: [],
    doneTickets: [],
    followUpTickets: [],
    allUsers: new Map(),
    userEmailMap: new Map(),
    attendance: new Map(),
    userPresence: new Map(), // Real-time online/idle/offline status
    currentPage: 0,
    doneCurrentPage: 0,
    TICKETS_PER_PAGE: 15, // ⚡ OPTIMIZATION: Reduced from 30 to 15 to decrease initial load
    currentView: 'tickets',
    charts: {},
    MAX_NOTE_LENGTH: 3000,
    deploymentNotes: [],
    currentUserRole: null,
    lastScheduleUpdate: null,
    expandedTicketId: null, // To track which ticket to auto-expand

    // Performance caching
    cache: {
        attachmentUrls: new Map(), // path -> { url, expires }
        ticketData: new Map(), // ticketId -> supplementary data
        lastTicketsFetch: null, // timestamp of last fetch
        lastUsersFetch: null, // timestamp of last users fetch
        lastStatsFetch: null, // timestamp of last stats fetch
        lastDashboardFetch: null, // timestamp of last dashboard fetch
        users: null, // cached users data
        stats: null, // cached stats data
        dashboard: null, // cached dashboard data
        lastDashboardUser: null, // track selected user filter for dashboard
        lastDashboardPeriod: null, // track period filter for dashboard cache
        lastSearchTerm: '', // track search term to invalidate cache on change
        lastPeriodFilter: null, // track period filter to invalidate cache on change
        lastView: null, // track current view to invalidate cache on view change
        lastUserFilter: null, // track user filter to invalidate cache on change
        lastSourceFilter: null, // track source filter to invalidate cache on change
        lastPriorityFilter: null, // track priority filter to invalidate cache on change
        lastTagFilter: null, // track tag filter to invalidate cache on change
        CACHE_TTL: 5 * 60 * 1000, // 5 minutes for general cache
        TICKETS_CACHE_TTL: 3 * 60 * 1000, // 3 minutes for tickets (shorter for realtime feel)
        STATS_CACHE_TTL: 10 * 60 * 1000 // 10 minutes for stats (changes less frequently)
    }
};

/**
 * Get cached attachment URL
 */
export function getCachedAttachmentUrl(path) {
    const cached = appState.cache.attachmentUrls.get(path);
    if (cached && cached.expires > Date.now()) {
        return cached.url;
    }
    return null;
}

/**
 * Set cached attachment URL
 */
export function setCachedAttachmentUrl(path, url, expiresInSeconds = 3600) {
    appState.cache.attachmentUrls.set(path, {
        url,
        expires: Date.now() + (expiresInSeconds * 1000)
    });
}

/**
 * Invalidate ticket cache (force fresh fetch on next load)
 */
export function invalidateTicketCache() {
    appState.cache.lastTicketsFetch = null;
    console.log('[Cache] Ticket cache invalidated');
}

/**
 * Invalidate stats cache (force fresh fetch on next load)
 */
export function invalidateStatsCache() {
    appState.cache.lastStatsFetch = null;
    appState.cache.stats = null;
    console.log('[Cache] Stats cache invalidated');
}

/**
 * Invalidate dashboard cache (force fresh fetch on next load)
 */
export function invalidateDashboardCache() {
    appState.cache.lastDashboardFetch = null;
    appState.cache.dashboard = null;
    console.log('[Cache] Dashboard cache invalidated');
}

/**
 * Clear expired cache entries
 */
export function cleanupCache() {
    const now = Date.now();

    // Clean attachment URLs
    for (const [path, cached] of appState.cache.attachmentUrls.entries()) {
        if (cached.expires <= now) {
            appState.cache.attachmentUrls.delete(path);
        }
    }

    // Clean ticket data cache
    for (const [id, cached] of appState.cache.ticketData.entries()) {
        if (cached.expires <= now) {
            appState.cache.ticketData.delete(id);
        }
    }
}

// Run cache cleanup every minute
setInterval(cleanupCache, 60 * 1000);

