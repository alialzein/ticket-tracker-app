// Admin Panel - Main JavaScript
import { _supabase, SUPABASE_URL_EXPORT } from '../../js/config.js';

// Global state
const adminState = {
    currentUser: null,
    currentSection: 'dashboard',
    isSuperAdmin: false
};

/**
 * Initialize admin panel
 */
async function init() {
    console.log('[Admin] Initializing admin panel...');

    try {
        // Check authentication
        const { data: { user }, error } = await _supabase.auth.getUser();

        if (error || !user) {
            console.error('[Admin] Not authenticated');
            window.location.href = '../index.html';
            return;
        }

        adminState.currentUser = user;

        // SECURITY: Verify admin access on server-side
        // This prevents users from bypassing client-side checks
        const adminVerification = await verifyAdminAccess();

        if (!adminVerification.success) {
            console.error('[Admin] Server-side verification failed:', adminVerification.error);
            await _supabase.auth.signOut();
            alert(adminVerification.error || 'Access Denied: You do not have admin privileges.');
            window.location.href = '../index.html';
            return;
        }

        // Store super admin status
        adminState.isSuperAdmin = adminVerification.isSuperAdmin || false;
        console.log('[Admin] User authenticated as admin:', user.email, '(Super Admin:', adminState.isSuperAdmin, ')');

        // Setup UI
        setupUI();
        setupNavigation();
        setupEventListeners();

        // Load dashboard
        await loadDashboard();

        // Initialize admin functions (load users, populate dropdowns, etc.)
        const { initAdminFunctions } = await import('./admin-functions.js');
        await initAdminFunctions();

        // Initialize user management
        const { initUserManagement } = await import('./user-management.js');
        await initUserManagement();

        // Hide loading, show content
        document.getElementById('loading-screen').classList.add('hidden');
        document.getElementById('admin-container').classList.remove('hidden');

    } catch (err) {
        console.error('[Admin] Initialization error:', err);
        alert('Failed to load admin panel. Please refresh the page.');
    }
}

/**
 * Verify admin access on server-side
 * SECURITY: This prevents users from bypassing client-side checks
 */
async function verifyAdminAccess() {
    try {
        console.log('[Admin] Verifying admin access on server-side...');

        // Get auth token
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        // Call Edge Function for server-side verification
        const response = await fetch(`${SUPABASE_URL_EXPORT}/functions/v1/verify-admin`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            }
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            console.error('[Admin] ❌ Server-side verification failed:', result.error);
            return {
                success: false,
                isAdmin: false,
                isSuperAdmin: false,
                error: result.error || 'Access Denied: You do not have admin privileges.'
            };
        }

        console.log('[Admin] ✅ Server-side verification successful');
        console.log('[Admin] User is Super Admin:', result.isSuperAdmin);

        return {
            success: true,
            isAdmin: result.isAdmin,
            isSuperAdmin: result.isSuperAdmin,
            user: result.user
        };

    } catch (err) {
        console.error('[Admin] Error verifying admin access:', err);
        return {
            success: false,
            isAdmin: false,
            isSuperAdmin: false,
            error: err.message || 'Failed to verify admin access'
        };
    }
}

/**
 * Setup UI elements
 */
function setupUI() {
    const displayName = adminState.currentUser.user_metadata?.['display name'] ||
                       adminState.currentUser.email?.split('@')[0] ||
                       'Admin';

    document.getElementById('admin-username').textContent = displayName;
}

/**
 * Setup navigation
 */
function setupNavigation() {
    const navLinks = document.querySelectorAll('.nav-link');

    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();

            const section = link.dataset.section;

            // Update active state
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');

            // Hide all sections
            document.querySelectorAll('.section-content').forEach(s => {
                s.classList.add('hidden');
            });

            // Show selected section
            document.getElementById(`section-${section}`).classList.remove('hidden');

            // Update state
            adminState.currentSection = section;

            // Update URL hash
            window.location.hash = section;

            // Close mobile sidebar
            document.getElementById('sidebar').classList.remove('show');

            // Load section content
            loadSection(section);
        });
    });

    // Handle initial hash
    const hash = window.location.hash.slice(1);
    if (hash) {
        const link = document.querySelector(`[data-section="${hash}"]`);
        if (link) link.click();
    } else {
        // Default to dashboard
        document.querySelector('[data-section="dashboard"]').click();
    }
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Logout button
    document.getElementById('logout-btn').addEventListener('click', async () => {
        if (confirm('Are you sure you want to logout?')) {
            await _supabase.auth.signOut();
            window.location.href = '../index.html';
        }
    });

    // Toggle sidebar (mobile)
    document.getElementById('toggle-sidebar').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('show');
    });

    // Close sidebar when clicking outside (mobile)
    document.addEventListener('click', (e) => {
        const sidebar = document.getElementById('sidebar');
        const toggleBtn = document.getElementById('toggle-sidebar');

        if (window.innerWidth < 1024 &&
            !sidebar.contains(e.target) &&
            !toggleBtn.contains(e.target) &&
            sidebar.classList.contains('show')) {
            sidebar.classList.remove('show');
        }
    });
}

/**
 * Load section content
 */
async function loadSection(section) {
    console.log('[Admin] Loading section:', section);

    switch (section) {
        case 'dashboard':
            await loadDashboard();
            break;
        case 'users':
            await loadUsers();
            break;
        case 'teams':
            await loadTeams();
            break;
        case 'tickets':
            await loadTickets();
            break;
        case 'settings':
            await loadSettings();
            break;
        case 'analytics':
            await loadAnalytics();
            break;
        case 'attendance':
            await loadAttendance();
            break;
        case 'archive':
            await loadArchive();
            break;
        default:
            console.warn('[Admin] Unknown section:', section);
    }
}

/**
 * Load dashboard
 */
async function loadDashboard() {
    console.log('[Admin] Loading dashboard...');

    try {
        // Fetch stats
        const [usersCount, teamsCount, ticketsCount, activeUsersCount] = await Promise.all([
            fetchUsersCount(),
            fetchTeamsCount(),
            fetchTicketsCount(),
            fetchActiveUsersCount()
        ]);

        // Update stats
        document.getElementById('stat-users').textContent = usersCount;
        document.getElementById('stat-teams').textContent = teamsCount;
        document.getElementById('stat-tickets').textContent = ticketsCount;
        document.getElementById('stat-active-users').textContent = activeUsersCount;

        // Load recent activity
        await loadRecentActivity();

    } catch (err) {
        console.error('[Admin] Error loading dashboard:', err);
    }
}

/**
 * Fetch users count
 */
async function fetchUsersCount() {
    try {
        const { count, error } = await _supabase
            .from('user_settings')
            .select('*', { count: 'exact', head: true });

        if (error) throw error;
        return count || 0;
    } catch (err) {
        console.error('[Admin] Error fetching users count:', err);
        return 0;
    }
}

/**
 * Fetch teams count
 */
async function fetchTeamsCount() {
    try {
        const { count, error } = await _supabase
            .from('teams')
            .select('*', { count: 'exact', head: true });

        if (error) {
            // Table might not exist yet
            return 0;
        }
        return count || 0;
    } catch (err) {
        return 0;
    }
}

/**
 * Fetch tickets count
 */
async function fetchTicketsCount() {
    try {
        const { count, error } = await _supabase
            .from('tickets')
            .select('*', { count: 'exact', head: true });

        if (error) throw error;
        return count || 0;
    } catch (err) {
        console.error('[Admin] Error fetching tickets count:', err);
        return 0;
    }
}

/**
 * Fetch active users count (users with recent activity)
 */
async function fetchActiveUsersCount() {
    try {
        console.log('[Admin] Fetching active users count...');
        // Count users who have logged activity in last 24 hours
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);

        console.log('[Admin] Querying user_activity table with timestamp >=', yesterday.toISOString());

        const { data, error } = await _supabase
            .from('user_activity')
            .select('user_id', { count: 'exact', head: true })
            .gte('timestamp', yesterday.toISOString());

        if (error) {
            console.warn('[Admin] ⚠️ user_activity table query failed:', error);
            console.warn('[Admin] Error details:', {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint
            });

            if (error.code === '42P01' || error.code === 'PGRST116') {
                console.warn('[Admin] user_activity table does not exist - using fallback');
            }

            // Fallback: just count all users
            console.log('[Admin] Falling back to counting all users from user_settings...');
            const { count, error: countError } = await _supabase
                .from('user_settings')
                .select('*', { count: 'exact', head: true });

            if (countError) {
                console.error('[Admin] Fallback count also failed:', countError);
            } else {
                console.log('[Admin] ✅ Fallback count successful:', count);
            }

            return count || 0;
        }

        console.log('[Admin] ✅ Active users count:', data?.length || 0);
        return data?.length || 0;
    } catch (err) {
        console.error('[Admin] Exception fetching active users count:', err);
        // Return total users as fallback
        try {
            const { count } = await _supabase
                .from('user_settings')
                .select('*', { count: 'exact', head: true });
            console.log('[Admin] Exception fallback count:', count);
            return count || 0;
        } catch {
            return 0;
        }
    }
}

/**
 * Load recent activity
 */
async function loadRecentActivity() {
    const container = document.getElementById('recent-activity');

    try {
        console.log('[Admin] Loading recent activity from admin_audit_log...');

        // Check if admin_audit_log table exists first
        const { data, error } = await _supabase
            .from('admin_audit_log')
            .select('id, admin_username, action, target_username, created_at')
            .order('created_at', { ascending: false })
            .limit(10);

        if (error) {
            console.error('[Admin] ❌ admin_audit_log query failed:', error);
            console.error('[Admin] Error details:', {
                code: error.code,
                message: error.message,
                details: error.details,
                hint: error.hint
            });

            // Table doesn't exist yet or permission issue
            if (error.code === 'PGRST116' || error.code === '42P01' || error.code === '42501') {
                console.warn('[Admin] Admin audit log access denied or table missing');

                if (error.code === '42501') {
                    console.error('[Admin] 🔒 403 PERMISSION DENIED - RLS policy blocking access');
                    console.error('[Admin] Current user:', adminState.currentUser?.email);
                    console.error('[Admin] Current user metadata:', adminState.currentUser?.user_metadata);
                    console.error('[Admin] The RLS policy requires admin metadata. Run this SQL:');
                    console.error(`UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"is_admin": true, "role": "admin"}'::jsonb WHERE id = '${adminState.currentUser?.id}';`);
                }

                container.innerHTML = `
                    <div class="text-center py-8 text-gray-400">
                        <p>📝 No activity logged yet</p>
                        <p class="text-xs mt-2">Activity will appear here once actions are performed</p>
                        ${error.code === '42501' ? '<p class="text-xs mt-2 text-red-400">⚠️ Permission denied - Check console for SQL fix</p>' : ''}
                    </div>
                `;
                return;
            }
            throw error;
        }

        console.log('[Admin] ✅ Loaded', data?.length || 0, 'recent activity entries');

        if (!data || data.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-gray-400">
                    <p>No recent activity</p>
                </div>
            `;
            return;
        }

        // Render activity items
        container.innerHTML = data.map(activity => {
            const timestamp = new Date(activity.created_at).toLocaleString();
            return `
                <div class="flex items-start gap-3 p-3 bg-gray-700/50 rounded-lg">
                    <div class="flex-1">
                        <p class="text-sm text-white">${activity.admin_username || 'Admin'} ${formatAction(activity.action)}</p>
                        ${activity.target_username ? `<p class="text-xs text-gray-400 mt-1">Target: ${activity.target_username}</p>` : ''}
                        <p class="text-xs text-gray-500 mt-1">${timestamp}</p>
                    </div>
                </div>
            `;
        }).join('');

    } catch (err) {
        console.error('[Admin] Error loading recent activity:', err);
        container.innerHTML = `
            <div class="text-center py-8 text-gray-400">
                <p>Activity tracking unavailable</p>
                <p class="text-xs mt-2">Run the database migration to enable activity logging</p>
            </div>
        `;
    }
}

/**
 * Format action text
 */
function formatAction(action) {
    const actionMap = {
        'user_created': 'created a user',
        'user_updated': 'updated a user',
        'user_blocked': 'blocked a user',
        'user_unblocked': 'unblocked a user',
        'user_deleted': 'deleted a user',
        'team_created': 'created a team',
        'team_updated': 'updated a team',
        'team_deleted': 'deleted a team',
        'member_added': 'added a team member',
        'member_removed': 'removed a team member',
        'settings_updated': 'updated settings'
    };

    return actionMap[action] || action;
}

/**
 * Placeholder functions for other sections
 */
async function loadUsers() {
    console.log('[Admin] Loading Users section...');
    // User management is already initialized and loaded
    // The table will display when section becomes visible
}

async function loadTeams() {
    console.log('[Admin] Teams section - coming soon');
}

async function loadTickets() {
    console.log('[Admin] Tickets section - coming soon');
}

async function loadSettings() {
    console.log('[Admin] Settings section - coming soon');
}

async function loadAnalytics() {
    console.log('[Admin] Analytics section - coming soon');
}

async function loadAttendance() {
    console.log('[Admin] Attendance section - coming soon');
}

async function loadArchive() {
    console.log('[Admin] Archive section - coming soon');
}

/**
 * Helper: Show notification (Toast-style)
 */
export function showNotification(title, message, type = 'info') {
    // Create toast container if it doesn't exist
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'fixed top-4 right-4 z-50 space-y-2';
        document.body.appendChild(container);
    }

    // Create toast element
    const toast = document.createElement('div');
    const colors = {
        'success': 'bg-green-600 border-green-500',
        'error': 'bg-red-600 border-red-500',
        'warning': 'bg-yellow-600 border-yellow-500',
        'info': 'bg-blue-600 border-blue-500'
    };
    const icons = {
        'success': '✓',
        'error': '✕',
        'warning': '⚠',
        'info': 'ℹ'
    };

    toast.className = `${colors[type] || colors.info} border-l-4 text-white p-4 rounded-lg shadow-lg max-w-sm animate-slide-in`;
    toast.innerHTML = `
        <div class="flex items-start gap-3">
            <span class="text-2xl flex-shrink-0">${icons[type] || icons.info}</span>
            <div class="flex-1">
                <h4 class="font-bold text-sm">${title}</h4>
                <p class="text-xs mt-1 opacity-90">${message}</p>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="text-white hover:text-gray-200">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            </button>
        </div>
    `;

    container.appendChild(toast);

    // Auto-remove after 5 seconds
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 5000);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

// Export for use in other modules
export {
    adminState,
    loadDashboard,
    loadUsers,
    loadTeams
};
