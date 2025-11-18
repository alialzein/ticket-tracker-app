// Badges UI Component - Modern Header Display
import { _supabase } from './config.js';
import { BADGES } from './badges.js';

/**
 * Render badges header with all badges and current holders
 */
export async function renderBadgesHeader() {
    const container = document.getElementById('badges-header');
    if (!container) return;

    try {
        // Get today's badges (all badges earned today)
        const today = new Date().toISOString().split('T')[0];
        const { data: badges, error } = await _supabase
            .from('user_badges')
            .select('*')
            .gte('achieved_at', `${today}T00:00:00`)
            .lte('achieved_at', `${today}T23:59:59`)
            .order('achieved_at', { ascending: false });

        if (error) throw error;

        // Group badges by badge_id
        const badgeHolders = {};
        badges?.forEach(badge => {
            if (!badgeHolders[badge.badge_id]) {
                badgeHolders[badge.badge_id] = [];
            }
            badgeHolders[badge.badge_id].push(badge);
        });

        // Generate HTML for each badge
        const badgesHTML = Object.values(BADGES).map(badge => {
            const holders = badgeHolders[badge.id] || [];
            const isNegative = badge.id === 'turtle';

            return `
                <div class="badge-card ${isNegative ? 'badge-negative' : 'badge-positive'}"
                     title="${badge.description}&#10;Reset: ${badge.reset}">
                    <div class="badge-emoji">${badge.emoji}</div>
                    <div class="badge-info">
                        <div class="badge-name">${badge.name}</div>
                        <div class="badge-holders">
                            ${holders.length > 0 ? renderBadgeHolders(holders) : '<span class="no-holders">—</span>'}
                        </div>
                    </div>
                    <div class="badge-count ${holders.length > 0 ? 'has-holders' : ''}">${holders.length}</div>
                </div>
            `;
        }).join('');

        container.innerHTML = `
            <div class="badges-header-container">
                <div class="badges-grid">
                    ${badgesHTML}
                </div>
            </div>
        `;

    } catch (err) {
        console.error('[BadgesUI] Error rendering badges header:', err);
        container.innerHTML = `
            <div class="badges-error">
                <span>⚠️ Unable to load badges</span>
            </div>
        `;
    }
}

/**
 * Render badge holders (user initials)
 */
function renderBadgeHolders(holders) {
    return holders.slice(0, 10).map(holder => {
        const initials = getInitials(holder.username);
        const color = getUserColor(holder.username);

        // Build tooltip text
        let tooltipText = holder.username;

        // Add score if available (for Client Hero badge)
        if (holder.metadata && holder.metadata.total_points) {
            tooltipText += `&#10;Score: ${holder.metadata.total_points} points`;
        }

        // Add achievement time
        const achievedTime = new Date(holder.achieved_at);
        tooltipText += `&#10;Achieved: ${achievedTime.toLocaleDateString()} ${achievedTime.toLocaleTimeString()}`;

        return `
            <div class="badge-holder"
                 style="background: ${color};"
                 title="${tooltipText}">
                ${initials}
            </div>
        `;
    }).join('');
}

/**
 * Get user initials (first letter of first name and last name)
 */
function getInitials(username) {
    const parts = username.trim().split(/\s+/);

    if (parts.length === 1) {
        // Single name: take first two letters
        return parts[0].substring(0, 2).toUpperCase();
    }

    // Multiple names: first letter of first and last
    const first = parts[0][0];
    const last = parts[parts.length - 1][0];
    return (first + last).toUpperCase();
}

/**
 * Get consistent color for user based on username
 */
function getUserColor(username) {
    const colors = [
        '#8b5cf6', // purple
        '#3b82f6', // blue
        '#06b6d4', // cyan
        '#10b981', // green
        '#f59e0b', // amber
        '#ef4444', // red
        '#ec4899', // pink
        '#6366f1', // indigo
    ];

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }

    return colors[Math.abs(hash) % colors.length];
}

/**
 * Refresh badges display
 */
export async function refreshBadgesDisplay() {
    await renderBadgesHeader();
}

/**
 * Initialize badges UI
 */
export function initializeBadgesUI() {
    // Add CSS styles
    addBadgesStyles();

    // Initial render
    renderBadgesHeader();

    // Refresh every 30 seconds
    setInterval(renderBadgesHeader, 30000);
}

/**
 * Add CSS styles for badges header
 */
function addBadgesStyles() {
    const styleId = 'badges-header-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
        .badges-header-container {
            background: rgba(30, 41, 59, 0.4);
            border: 1px solid rgba(148, 163, 184, 0.15);
            border-radius: 0.5rem;
            padding: 0.5rem;
            margin-bottom: 0.75rem;
        }

        .badges-grid {
            display: flex;
            gap: 0.5rem;
            overflow-x: auto;
            scrollbar-width: none;
            justify-content: center;
        }

        .badges-grid::-webkit-scrollbar {
            display: none;
        }

        .badge-card {
            background: rgba(30, 41, 59, 0.6);
            border: 1px solid rgba(148, 163, 184, 0.15);
            border-radius: 0.375rem;
            padding: 0.75rem 1rem;
            display: flex;
            align-items: center;
            gap: 0.75rem;
            cursor: pointer;
            transition: all 0.2s ease;
            flex-shrink: 0;
            min-width: fit-content;
        }

        .badge-card:hover {
            background: rgba(30, 41, 59, 0.8);
            border-color: rgba(148, 163, 184, 0.3);
        }

        .badge-card.badge-negative {
            border-color: rgba(239, 68, 68, 0.2);
        }

        .badge-emoji {
            font-size: 1.5rem;
            line-height: 1;
        }

        .badge-info {
            display: flex;
            flex-direction: column;
            gap: 0.375rem;
        }

        .badge-name {
            font-size: 0.75rem;
            font-weight: 600;
            color: #cbd5e1;
            line-height: 1;
            white-space: nowrap;
        }

        .badge-holders {
            display: flex;
            gap: 0.125rem;
        }

        .badge-holder {
            width: 1.375rem;
            height: 1.375rem;
            border-radius: 0.25rem;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 0.625rem;
            font-weight: 700;
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.15);
            transition: transform 0.2s ease;
            cursor: pointer;
        }

        .badge-holder:hover {
            transform: scale(1.2);
            z-index: 10;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
        }

        .no-holders {
            color: #64748b;
            font-size: 0.75rem;
        }

        .badge-count {
            font-size: 1rem;
            font-weight: 600;
            color: #64748b;
            min-width: auto;
            text-align: center;
            line-height: 1;
        }

        .badge-count.has-holders {
            color: #60a5fa;
        }

        .badge-negative .badge-count.has-holders {
            color: #f87171;
        }

        .badges-error {
            padding: 0.5rem;
            text-align: center;
            color: #ef4444;
            font-size: 0.75rem;
        }
    `;

    document.head.appendChild(style);
}

// Export functions
window.badges = window.badges || {};
window.badges.refreshBadgesDisplay = refreshBadgesDisplay;
window.badges.initializeBadgesUI = initializeBadgesUI;
