// js/logger.js
// Smart logger that automatically strips logs in production

/**
 * Check if we're in production environment
 * Production = deployed on Vercel (b-pal-tickets.vercel.app)
 */
function isProduction() {
    return window.location.hostname.includes('vercel.app') ||
           window.location.hostname !== 'localhost' &&
           window.location.hostname !== '127.0.0.1';
}

/**
 * Smart logger - only logs in development
 */
export const logger = {
    log: (...args) => {
        if (!isProduction()) {
            console.log(...args);
        }
    },
    error: (...args) => {
        // Always log errors, even in production
        console.error(...args);
    },
    warn: (...args) => {
        if (!isProduction()) {
            console.warn(...args);
        }
    },
    info: (...args) => {
        if (!isProduction()) {
            console.info(...args);
        }
    }
};

// Export convenience function for quick logging
export const log = logger.log;
export const logError = logger.error;
export const logWarn = logger.warn;
