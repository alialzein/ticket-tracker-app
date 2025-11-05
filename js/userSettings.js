// User Settings Helper Module
// Provides functions to fetch and apply user customization settings

import { _supabase } from './config.js';

// Cache for user settings to reduce database queries
const settingsCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch user settings from database with caching
 * @param {string} userId - User ID
 * @returns {Promise<Object|null>} User settings object
 */
export async function getUserSettings(userId) {
    if (!userId) return null;

    // Check cache first
    const cached = settingsCache.get(userId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached.data;
    }

    try {
        const { data, error } = await _supabase
            .from('user_settings')
            .select('*')
            .eq('user_id', userId)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching user settings:', error);
            return null;
        }

        // Cache the result
        settingsCache.set(userId, {
            data: data,
            timestamp: Date.now()
        });

        return data;
    } catch (error) {
        console.error('Error in getUserSettings:', error);
        return null;
    }
}

/**
 * Get user settings by EMAIL-BASED username (e.g., "ali.alzein" from "ali.alzein@example.com")
 * This is the primary method for ticket rendering since tickets store email-based usernames
 * @param {string} username - Email-based system username (before @)
 * @returns {Promise<Object|null>} User settings object
 */
export async function getUserSettingsByUsername(username) {
    if (!username) return null;

    try {
        // Look up by system_username field (fast, indexed)
        const { data, error } = await _supabase
            .from('user_settings')
            .select('*')
            .eq('system_username', username)
            .single();

        if (error && error.code !== 'PGRST116') {
            console.error('Error fetching settings by username:', error);
            return null;
        }

        // Cache the result
        if (data) {
            settingsCache.set(data.user_id, {
                data: data,
                timestamp: Date.now()
            });
        }

        return data;
    } catch (error) {
        console.error('Error in getUserSettingsByUsername:', error);
        return null;
    }
}

/**
 * Get user settings by username (system_username)
 * This assumes displayName is actually the email-based username
 * @param {string} displayName - Actually the system username (email-based)
 * @returns {Promise<Object|null>} User settings object
 */
export async function getUserSettingsByName(displayName) {
    if (!displayName) return null;

    // Since tickets store email-based usernames, treat displayName as username
    // This prevents duplicate queries
    return await getUserSettingsByUsername(displayName);
}

/**
 * Apply name color to an HTML element
 * @param {HTMLElement} element - Element to apply color to
 * @param {string} userId - User ID
 */
export async function applyNameColor(element, userId) {
    if (!element || !userId) return;

    const settings = await getUserSettings(userId);
    if (settings?.name_color) {
        element.style.color = settings.name_color;
    }
}

/**
 * Apply name color by display name
 * @param {HTMLElement} element - Element to apply color to
 * @param {string} displayName - User's display name
 */
export async function applyNameColorByName(element, displayName) {
    if (!element || !displayName) return;

    const settings = await getUserSettingsByName(displayName);
    if (settings?.name_color) {
        element.style.color = settings.name_color;
    }
}

/**
 * Get formatted user display with color
 * @param {string} username - User's system username (email-based, e.g., "ali.alzein")
 * @param {string} userId - User ID (optional, for direct lookup)
 * @returns {Promise<string>} HTML string with colored display name
 */
export async function getColoredUserName(username, userId = null) {
    if (!username) return '';

    let settings;
    if (userId) {
        settings = await getUserSettings(userId);
    } else {
        // Look up by system_username to get settings
        settings = await getUserSettingsByUsername(username);
    }

    const color = settings?.name_color || '#a78bfa'; // Default purple
    const displayName = settings?.display_name || username; // Use display_name if available, fallback to username
    return `<span style="color: ${color}; font-weight: bold;">${displayName}</span>`;
}

/**
 * Get formatted user display with color from CACHED settings (no database query)
 * Use this when you already have settings from batch fetch
 * @param {string} username - User's system username
 * @param {Object} settings - User settings object (from batch fetch)
 * @returns {string} HTML string with colored display name
 */
export function getColoredUserNameFromCache(username, settings) {
    if (!username) return '';

    const color = settings?.name_color || '#a78bfa';
    const displayName = settings?.display_name || username;
    return `<span style="color: ${color}; font-weight: bold;">${displayName}</span>`;
}

/**
 * Get user avatar HTML from CACHED settings (no database query)
 * @param {string} username - System username
 * @param {Object} settings - User settings object (from batch fetch)
 * @param {string} size - Size class (e.g., 'w-10 h-10')
 * @returns {string} HTML string for avatar
 */
export function getUserAvatarFromCache(username, settings, size = 'w-10 h-10') {
    if (!username) return '';

    const displayName = settings?.display_name || username;
    const imageUrl = settings?.profile_image_url;
    const bgColor = settings?.name_color || '#6366f1';

    if (imageUrl) {
        return `<img src="${imageUrl}" alt="${displayName}" class="${size} rounded-full object-cover border-2 border-gray-600 shadow-md">`;
    } else {
        const initials = getInitials(displayName);
        return `<div class="${size} rounded-full flex items-center justify-center text-white font-bold text-sm border-2 border-gray-600/50 shadow-md" style="background-color: ${bgColor};">
                    ${initials}
                </div>`;
    }
}

/**
 * Get user profile image URL
 * @param {string} userId - User ID
 * @returns {Promise<string|null>} Image URL or null
 */
export async function getProfileImageUrl(userId) {
    if (!userId) return null;

    const settings = await getUserSettings(userId);
    return settings?.profile_image_url || null;
}

/**
 * Get user initials for avatar display
 * @param {string} displayName - User's display name
 * @returns {string} Initials (e.g., "JD")
 */
export function getInitials(displayName) {
    if (!displayName) return 'U';

    const parts = displayName.trim().split(' ');
    if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Render user avatar (image or initials) by user ID
 * @param {string} displayName - User's display name
 * @param {string} userId - User ID
 * @param {string} size - Size class (e.g., 'w-10 h-10')
 * @returns {Promise<string>} HTML string for avatar
 */
export async function renderUserAvatar(displayName, userId, size = 'w-10 h-10') {
    const imageUrl = await getProfileImageUrl(userId);

    if (imageUrl) {
        return `<img src="${imageUrl}" alt="${displayName}" class="${size} rounded-full object-cover border-2 border-gray-600 shadow-md">`;
    } else {
        const initials = getInitials(displayName);
        const settings = await getUserSettings(userId);
        const bgColor = settings?.name_color || '#6366f1';

        return `<div class="${size} rounded-full flex items-center justify-center text-white font-bold text-sm border-2 border-gray-600/50 shadow-md" style="background-color: ${bgColor};">
                    ${initials}
                </div>`;
    }
}

/**
 * Render user avatar by username (system_username)
 * @param {string} username - System username (email-based, e.g., "ali.alzein")
 * @param {string} size - Size class (e.g., 'w-10 h-10')
 * @returns {Promise<string>} HTML string for avatar
 */
export async function getUserAvatarByUsername(username, size = 'w-10 h-10') {
    if (!username) return '';

    // Get user settings by system_username
    const settings = await getUserSettingsByUsername(username);

    if (!settings) {
        // Fallback: show initials with default color
        const initials = username.substring(0, 2).toUpperCase();
        return `<div class="${size} rounded-full flex items-center justify-center text-white font-bold text-sm border-2 border-gray-600/50 shadow-md" style="background-color: #6366f1;">
                    ${initials}
                </div>`;
    }

    const displayName = settings.display_name || username;
    const imageUrl = settings.profile_image_url;

    if (imageUrl) {
        return `<img src="${imageUrl}" alt="${displayName}" class="${size} rounded-full object-cover border-2 border-gray-600 shadow-md">`;
    } else {
        const initials = getInitials(displayName);
        const bgColor = settings.name_color || '#6366f1';

        return `<div class="${size} rounded-full flex items-center justify-center text-white font-bold text-sm border-2 border-gray-600/50 shadow-md" style="background-color: ${bgColor};">
                    ${initials}
                </div>`;
    }
}

/**
 * Batch fetch user settings by system usernames (PERFORMANCE OPTIMIZATION)
 * Fetches all users in ONE query instead of individual queries per user
 * @param {Array<string>} usernames - Array of system usernames (e.g., ["ali.alzein", "mohamad.bachir"])
 * @returns {Promise<Map>} Map of system_username -> settings
 */
export async function getBatchUserSettingsByUsername(usernames) {
    if (!usernames || usernames.length === 0) return new Map();

    // Remove duplicates
    const uniqueUsernames = [...new Set(usernames)];

    // Check cache first
    const settingsMap = new Map();
    const uncachedUsernames = [];

    uniqueUsernames.forEach(username => {
        const cached = [...settingsCache.values()].find(
            c => c.data?.system_username === username && Date.now() - c.timestamp < CACHE_DURATION
        );
        if (cached) {
            settingsMap.set(username, cached.data);
        } else {
            uncachedUsernames.push(username);
        }
    });

    // Fetch uncached usernames in ONE query
    if (uncachedUsernames.length > 0) {
        try {
            const { data, error } = await _supabase
                .from('user_settings')
                .select('*')
                .in('system_username', uncachedUsernames);

            if (error) {
                console.error('Error fetching batch user settings:', error);
            } else if (data) {
                data.forEach(setting => {
                    settingsMap.set(setting.system_username, setting);
                    // Cache it
                    settingsCache.set(setting.user_id, {
                        data: setting,
                        timestamp: Date.now()
                    });
                });
            }
        } catch (error) {
            console.error('Error in getBatchUserSettingsByUsername:', error);
        }
    }

    return settingsMap;
}

/**
 * Clear settings cache for a user (call after settings update)
 * @param {string} userId - User ID
 */
export function clearSettingsCache(userId) {
    if (userId) {
        settingsCache.delete(userId);
    } else {
        settingsCache.clear();
    }
}

/**
 * Get all settings for batch operations
 * @param {Array<string>} userIds - Array of user IDs
 * @returns {Promise<Map>} Map of userId -> settings
 */
export async function getBatchUserSettings(userIds) {
    if (!userIds || userIds.length === 0) return new Map();

    try {
        const { data, error } = await _supabase
            .from('user_settings')
            .select('*')
            .in('user_id', userIds);

        if (error) {
            console.error('Error fetching batch user settings:', error);
            return new Map();
        }

        const settingsMap = new Map();
        data.forEach(setting => {
            settingsMap.set(setting.user_id, setting);
            // Also cache individually
            settingsCache.set(setting.user_id, {
                data: setting,
                timestamp: Date.now()
            });
        });

        return settingsMap;
    } catch (error) {
        console.error('Error in getBatchUserSettings:', error);
        return new Map();
    }
}
