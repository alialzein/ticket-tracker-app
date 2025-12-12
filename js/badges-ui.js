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
        // Get today's active badges
        // Note: is_active = true means the badge is currently active for today
        // Badges are reset daily (is_active set to false) at midnight
        const { data: badges, error } = await _supabase
            .from('user_badges')
            .select('*')
            .eq('is_active', true)
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
            background: linear-gradient(135deg, rgba(55, 65, 81, 0.3) 0%, rgba(31, 41, 55, 0.3) 100%);
            backdrop-filter: blur(8px);
            border: 1px solid rgba(99, 102, 241, 0.15);
            border-radius: 0.75rem;
            padding: 0.5rem;
            margin-bottom: 1rem;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
        }

        .badges-grid {
            display: flex;
            gap: 0.625rem;
            overflow-x: auto;
            scrollbar-width: thin;
            scrollbar-color: rgba(99, 102, 241, 0.3) transparent;
            justify-content: center;
            padding: 0.25rem 0;
        }

        .badges-grid::-webkit-scrollbar {
            height: 4px;
        }

        .badges-grid::-webkit-scrollbar-track {
            background: transparent;
        }

        .badges-grid::-webkit-scrollbar-thumb {
            background: rgba(99, 102, 241, 0.3);
            border-radius: 2px;
        }

        .badge-card {
            background: linear-gradient(135deg, rgba(55, 65, 81, 0.5) 0%, rgba(31, 41, 55, 0.5) 100%);
            border: 1px solid rgba(107, 114, 128, 0.3);
            border-radius: 0.625rem;
            padding: 0.5rem 0.75rem;
            display: flex;
            align-items: center;
            gap: 0.625rem;
            cursor: pointer;
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            flex-shrink: 0;
            min-width: fit-content;
            position: relative;
            overflow: hidden;
        }

        .badge-card::before {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(135deg, rgba(99, 102, 241, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%);
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        .badge-card:hover::before {
            opacity: 1;
        }

        .badge-card:hover {
            transform: translateY(-2px) scale(1.02);
            border-color: rgba(99, 102, 241, 0.4);
            box-shadow: 0 8px 16px -4px rgba(99, 102, 241, 0.2);
        }

        .badge-card.badge-negative {
            border-color: rgba(239, 68, 68, 0.3);
            background: linear-gradient(135deg, rgba(127, 29, 29, 0.2) 0%, rgba(69, 10, 10, 0.2) 100%);
        }

        .badge-card.badge-negative:hover {
            border-color: rgba(239, 68, 68, 0.5);
            box-shadow: 0 8px 16px -4px rgba(239, 68, 68, 0.2);
        }

        .badge-emoji {
            font-size: 1.25rem;
            line-height: 1;
            filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
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
