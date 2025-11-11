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
    currentPage: 0,
    doneCurrentPage: 0,
    TICKETS_PER_PAGE: 30,
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
        CACHE_TTL: 5 * 60 * 1000 // 5 minutes
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

