// Admin Panel - Main JavaScript
import { _supabase, SUPABASE_URL_EXPORT } from '../../js/config.js';
import { initBroadcastAndActivity, loadRecentActivity } from './admin-broadcast.js';
import { initAdminTraining } from './admin-training.js';

// Global state
const adminState = {
    currentUser: null,
    currentSection: 'dashboard',
    isSuperAdmin: false,
    isTeamLeader: false,
    teamLeaderForTeamId: null
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

        // Store super admin and team leader status
        adminState.isSuperAdmin = adminVerification.isSuperAdmin || false;
        adminState.isTeamLeader = adminVerification.isTeamLeader || false;
        adminState.teamLeaderForTeamId = adminVerification.teamLeaderForTeamId || null;
        console.log('[Admin] User authenticated:', user.email, '(Super Admin:', adminState.isSuperAdmin, ', Team Leader:', adminState.isTeamLeader, ')');

        // Setup UI
        setupUI();
        setupNavigation();
        setupEventListeners();

        // Load dashboard
        await loadDashboard();

        // Initialize admin functions (load users, populate dropdowns, etc.)
        const { initAdminFunctions } = await import('./admin-functions.js');
        await initAdminFunctions();

        // Re-apply our functions after admin-functions.js overwrites window.adminPanel
        Object.assign(window.adminPanel, {
            searchTickets,
            loadMoreTickets,
            clearTicketFilters,
            showTicketDetail,
            closeTicketDetail,
            deleteAdminTicket,
            generateUserActivityReport,
            exportUserActivityReport,
            generateWeeklyHistoryReport,
            exportWeeklyHistoryReport,
            analyzeKPI,
            exportKPIReport,
            generateAttendanceReport,
            exportAttendanceReport,
            filterAttendance,
        });

        // Initialize user management
        const { initUserManagement } = await import('./user-management.js');
        await initUserManagement();

        // Initialize team management
        const { initTeamManagement } = await import('./admin-teams.js');
        await initTeamManagement();

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
                isTeamLeader: false,
                teamLeaderForTeamId: null,
                error: result.error || 'Access Denied: You do not have admin privileges.'
            };
        }

        console.log('[Admin] ✅ Server-side verification successful');
        console.log('[Admin] User is Super Admin:', result.isSuperAdmin);
        console.log('[Admin] User is Team Leader:', result.isTeamLeader);

        return {
            success: true,
            isAdmin: result.isAdmin,
            isSuperAdmin: result.isSuperAdmin,
            isTeamLeader: result.isTeamLeader,
            teamLeaderForTeamId: result.teamLeaderForTeamId,
            user: result.user
        };

    } catch (err) {
        console.error('[Admin] Error verifying admin access:', err);
        return {
            success: false,
            isAdmin: false,
            isSuperAdmin: false,
            isTeamLeader: false,
            teamLeaderForTeamId: null,
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

    // Team leaders cannot manage teams — hide the Teams nav tab
    if (adminState.isTeamLeader && !adminState.isSuperAdmin) {
        const teamsNavLink = document.querySelector('[data-section="teams"]');
        if (teamsNavLink) teamsNavLink.closest('li')?.remove() || teamsNavLink.remove();
    }
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

        // Initialize broadcast and activity features
        initBroadcastAndActivity();

        // Initialize training management
        initAdminTraining();

    } catch (err) {
        console.error('[Admin] Error loading dashboard:', err);
    }
}

/**
 * Fetch users count
 */
async function fetchUsersCount() {
    try {
        let query = _supabase
            .from('user_settings')
            .select('*', { count: 'exact', head: true });

        // Team leaders can only see their team's users
        if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
            query = query.eq('team_id', adminState.teamLeaderForTeamId);
        }

        const { count, error } = await query;

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
        // Team leaders only see 1 team (their own)
        if (adminState.isTeamLeader) {
            return 1;
        }

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
        let query = _supabase
            .from('tickets')
            .select('*', { count: 'exact', head: true });

        // Team leaders can only see their team's tickets
        if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
            query = query.eq('team_id', adminState.teamLeaderForTeamId);
        }

        const { count, error } = await query;

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
    console.log('[Admin] Fetching active users count...');

    // Since user_activity table may not exist, just return total user count
    // This is a simpler and more reliable approach
    try {
        let query = _supabase
            .from('user_settings')
            .select('*', { count: 'exact', head: true });

        // Team leaders can only see their team's users
        if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
            query = query.eq('team_id', adminState.teamLeaderForTeamId);
        }

        const { count, error } = await query;

        if (error) {
            console.error('[Admin] Error fetching active users count:', error);
            return 0;
        }

        console.log('[Admin] ✅ Active users count (total users):', count || 0);
        return count || 0;
    } catch (err) {
        console.error('[Admin] Exception fetching active users count:', err);
        return 0;
    }
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
    const { loadAllTeams } = await import('./admin-teams.js');
    await loadAllTeams();
}

// -----------------------------------------------------------------
// TICKETS SECTION
// -----------------------------------------------------------------
let ticketSearchBound = false;
let _ticketOffset = 0;
const TICKETS_PAGE_SIZE = 10;

async function loadTickets() {
    if (!ticketSearchBound) {
        ticketSearchBound = true;
        const input = document.getElementById('admin-search-subject-input');
        if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') searchTickets(); });
    }
    // Auto-load recent tickets on first visit
    _ticketOffset = 0;
    await searchTickets(false);
}

async function searchTickets(reset = true) {
    if (reset) _ticketOffset = 0;
    const term = document.getElementById('admin-search-subject-input')?.value.trim();
    const status = document.getElementById('admin-ticket-filter-status')?.value;
    const priority = document.getElementById('admin-ticket-filter-priority')?.value;
    const resultsDiv = document.getElementById('admin-ticket-search-results');
    const loadMoreDiv = document.getElementById('admin-ticket-load-more');
    if (!resultsDiv) return;

    if (reset) resultsDiv.innerHTML = '<p class="text-gray-400 text-sm p-4">Loading...</p>';

    let query = _supabase.from('tickets')
        .select('id, subject, status, priority, source, username, assigned_to_name, created_at, tags, notes')
        .order('created_at', { ascending: false })
        .range(_ticketOffset, _ticketOffset + TICKETS_PAGE_SIZE - 1);

    if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
        query = query.eq('team_id', adminState.teamLeaderForTeamId);
    }
    if (term) query = query.ilike('subject', `%${term}%`);
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);

    const { data, error } = await query;
    if (error) { showNotification('Error', error.message, 'error'); resultsDiv.innerHTML = ''; return; }

    const hasMore = data && data.length === TICKETS_PAGE_SIZE;
    if (loadMoreDiv) loadMoreDiv.classList.toggle('hidden', !hasMore);

    if (reset && (!data || data.length === 0)) {
        resultsDiv.innerHTML = '<p class="text-gray-400 text-sm p-4 text-center">No tickets found.</p>';
        return;
    }

    const rows = (data || []).map(t => {
        const statusColors = { open: 'text-blue-400 bg-blue-500/15', done: 'text-green-400 bg-green-500/15', follow_up: 'text-yellow-400 bg-yellow-500/15' };
        const priorityColors = { urgent: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-gray-400' };
        const sc = statusColors[t.status] || 'text-gray-400 bg-gray-700/50';
        const pc = priorityColors[t.priority] || 'text-gray-400';
        const tags = Array.isArray(t.tags) ? t.tags.join(', ') : (t.tags || '');
        return `<tr class="border-b border-gray-700/50 hover:bg-gray-700/20 cursor-pointer" onclick="adminPanel.showTicketDetail(${JSON.stringify(JSON.stringify(t))})">
            <td class="py-2.5 pl-4 pr-3">
                <p class="text-white text-sm font-medium truncate max-w-xs">${escapeHtmlAdmin(t.subject)}</p>
                <p class="text-gray-500 text-xs mt-0.5">${new Date(t.created_at).toLocaleDateString()} · ${escapeHtmlAdmin(t.username || '—')}</p>
            </td>
            <td class="py-2.5 pr-3 hidden md:table-cell">
                <span class="text-xs px-1.5 py-0.5 rounded ${sc}">${t.status || '—'}</span>
            </td>
            <td class="py-2.5 pr-3 hidden md:table-cell">
                <span class="text-xs font-medium ${pc}">${t.priority || '—'}</span>
            </td>
            <td class="py-2.5 pr-3 hidden lg:table-cell text-xs text-gray-400 truncate max-w-[120px]">${escapeHtmlAdmin(t.assigned_to_name || '—')}</td>
            <td class="py-2.5 pr-3 hidden lg:table-cell text-xs text-gray-500 truncate max-w-[100px]">${escapeHtmlAdmin(tags)}</td>
            <td class="py-2.5 pr-4 text-right" onclick="event.stopPropagation()">
                <button onclick="adminPanel.deleteAdminTicket('${t.id}')"
                    class="text-red-400 hover:text-red-300 text-xs px-2 py-1 border border-red-500/30 hover:bg-red-500/10 rounded transition-colors">
                    Delete
                </button>
            </td>
        </tr>`;
    }).join('');

    const tableHtml = `<table class="w-full text-xs">
        <thead class="border-b border-gray-700">
            <tr class="text-gray-400 text-left">
                <th class="py-2.5 pl-4 pr-3 font-medium">Subject</th>
                <th class="py-2.5 pr-3 font-medium hidden md:table-cell">Status</th>
                <th class="py-2.5 pr-3 font-medium hidden md:table-cell">Priority</th>
                <th class="py-2.5 pr-3 font-medium hidden lg:table-cell">Assigned To</th>
                <th class="py-2.5 pr-3 font-medium hidden lg:table-cell">Tags</th>
                <th class="py-2.5 pr-4 font-medium text-right">Action</th>
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;

    if (reset) {
        resultsDiv.innerHTML = tableHtml;
    } else {
        // Append rows to existing tbody
        const tbody = resultsDiv.querySelector('tbody');
        if (tbody) tbody.insertAdjacentHTML('beforeend', rows);
        else resultsDiv.innerHTML = tableHtml;
    }

    _ticketOffset += (data?.length || 0);
}

async function loadMoreTickets() {
    await searchTickets(false);
}

function clearTicketFilters() {
    const s = document.getElementById('admin-search-subject-input');
    const st = document.getElementById('admin-ticket-filter-status');
    const p = document.getElementById('admin-ticket-filter-priority');
    if (s) s.value = '';
    if (st) st.value = '';
    if (p) p.value = '';
    searchTickets(true);
}

function showTicketDetail(ticketJson) {
    const t = JSON.parse(ticketJson);
    const modal = document.getElementById('admin-ticket-detail-modal');
    const subjectEl = document.getElementById('modal-ticket-subject');
    const bodyEl = document.getElementById('modal-ticket-body');
    if (!modal || !bodyEl) return;

    subjectEl.textContent = t.subject || 'No subject';

    const field = (label, val, colorClass = 'text-gray-300') =>
        val ? `<div class="flex gap-3"><span class="text-gray-500 text-xs w-28 flex-shrink-0 pt-0.5">${label}</span><span class="text-xs ${colorClass} flex-1">${val}</span></div>` : '';

    const statusColors = { open: 'text-blue-400', done: 'text-green-400', follow_up: 'text-yellow-400' };
    const priorityColors = { urgent: 'text-red-400', high: 'text-orange-400', medium: 'text-yellow-400', low: 'text-gray-400' };
    const tags = Array.isArray(t.tags) ? t.tags.join(', ') : (t.tags || '');
    const notes = t.notes ? escapeHtmlAdmin(String(t.notes)).replace(/\n/g, '<br>') : null;

    bodyEl.innerHTML = `
        <div class="space-y-2">
            ${field('Status', t.status, statusColors[t.status])}
            ${field('Priority', t.priority, priorityColors[t.priority])}
            ${field('Source', t.source)}
            ${field('Created by', t.username)}
            ${field('Assigned to', t.assigned_to_name)}
            ${field('Created at', new Date(t.created_at).toLocaleString())}
            ${tags ? field('Tags', tags) : ''}
        </div>
        ${notes ? `<div class="bg-gray-700/30 rounded-lg p-3 mt-2">
            <p class="text-xs text-gray-500 mb-1.5">Notes</p>
            <p class="text-xs text-gray-300 leading-relaxed">${notes}</p>
        </div>` : ''}
        <div class="pt-2 border-t border-gray-700 flex justify-end">
            <button onclick="adminPanel.deleteAdminTicket('${t.id}', true)"
                class="text-red-400 hover:text-red-300 text-xs px-4 py-2 border border-red-500/30 hover:bg-red-500/10 rounded-lg transition-colors">
                Delete Ticket
            </button>
        </div>`;

    modal.classList.remove('hidden');
}

function closeTicketDetail() {
    document.getElementById('admin-ticket-detail-modal')?.classList.add('hidden');
}

async function deleteAdminTicket(ticketId, fromModal = false) {
    if (!confirm('Delete this ticket? This cannot be undone.')) return;
    const { error } = await _supabase.from('tickets').delete().eq('id', ticketId);
    if (error) { showNotification('Error', error.message, 'error'); return; }
    showNotification('Deleted', 'Ticket removed successfully.', 'success');
    if (fromModal) closeTicketDetail();
    _ticketOffset = 0;
    await searchTickets(true);
}

function escapeHtmlAdmin(text) {
    const d = document.createElement('div'); d.textContent = text; return d.innerHTML;
}

// -----------------------------------------------------------------
// SETTINGS SECTION
// -----------------------------------------------------------------
async function loadSettings() {
    // Settings are handled by admin-ticket-config.js via MutationObserver — nothing to do here
}

// -----------------------------------------------------------------
// ANALYTICS SECTION
// -----------------------------------------------------------------
let analyticsUsersBound = false;

async function loadAnalytics() {
    if (analyticsUsersBound) return;
    analyticsUsersBound = true;
    await populateAnalyticsUserDropdowns();
}

async function populateAnalyticsUserDropdowns() {
    let query = _supabase.from('user_settings').select('user_id, display_name').order('display_name');
    if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
        query = query.eq('team_id', adminState.teamLeaderForTeamId);
    }
    const { data: users } = await query;
    if (!users) return;

    const optionsHTML = '<option value="">Select User</option>' +
        users.map(u => `<option value="${u.user_id}">${escapeHtmlAdmin(u.display_name || 'Unknown')}</option>`).join('');

    ['admin-log-user-select', 'admin-history-user-select'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = optionsHTML;
    });
}

async function generateUserActivityReport() {
    const userId = document.getElementById('admin-log-user-select')?.value;
    const startDate = document.getElementById('admin-log-start-date')?.value;
    const endDate = document.getElementById('admin-log-end-date')?.value;
    const resultsDiv = document.getElementById('admin-user-log-results');
    if (!resultsDiv) return;
    if (!userId) { showNotification('Missing', 'Please select a user.', 'warning'); return; }

    resultsDiv.innerHTML = '<p class="text-gray-400 text-sm">Loading...</p>';

    let query = _supabase.from('user_points').select('event_type, points_awarded, created_at, details')
        .eq('user_id', userId).order('created_at', { ascending: false }).limit(100);
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate + 'T23:59:59');
    if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
        query = query.eq('team_id', adminState.teamLeaderForTeamId);
    }
    const { data, error } = await query;
    if (error) { showNotification('Error', error.message, 'error'); resultsDiv.innerHTML = ''; return; }
    if (!data || data.length === 0) { resultsDiv.innerHTML = '<p class="text-gray-400 text-sm">No activity found.</p>'; return; }

    const totalPts = data.reduce((s, r) => s + (r.points_awarded || 0), 0);
    resultsDiv.innerHTML = `
        <div class="text-sm text-gray-300 mb-2">Total: <span class="font-bold text-white">${totalPts} pts</span> across ${data.length} events</div>
        <table class="w-full text-xs border-collapse">
            <thead><tr class="text-gray-400 border-b border-gray-700">
                <th class="text-left py-1 pr-3">Date</th>
                <th class="text-left py-1 pr-3">Event</th>
                <th class="text-right py-1">Points</th>
            </tr></thead>
            <tbody>${data.map(r => `<tr class="border-b border-gray-800">
                <td class="py-1 pr-3 text-gray-400">${new Date(r.created_at).toLocaleDateString()}</td>
                <td class="py-1 pr-3 text-gray-300">${r.event_type}</td>
                <td class="py-1 text-right ${r.points_awarded >= 0 ? 'text-green-400' : 'text-red-400'}">${r.points_awarded >= 0 ? '+' : ''}${r.points_awarded}</td>
            </tr>`).join('')}</tbody>
        </table>`;
    window._analyticsActivityData = data;
}

async function exportUserActivityReport() {
    if (!window._analyticsActivityData?.length) { await generateUserActivityReport(); }
    const data = window._analyticsActivityData;
    if (!data?.length) return;
    const rows = [['Date', 'Event', 'Points', 'Details']].concat(
        data.map(r => [new Date(r.created_at).toLocaleString(), r.event_type, r.points_awarded, JSON.stringify(r.details || {})])
    );
    downloadCSV(rows, 'activity_log.csv');
}

async function generateWeeklyHistoryReport() {
    const userId = document.getElementById('admin-history-user-select')?.value;
    const startDate = document.getElementById('admin-history-start-date')?.value;
    const endDate = document.getElementById('admin-history-end-date')?.value;
    const resultsDiv = document.getElementById('admin-weekly-history-results');
    if (!resultsDiv) return;
    if (!userId) { showNotification('Missing', 'Please select a user.', 'warning'); return; }

    resultsDiv.innerHTML = '<p class="text-gray-400 text-sm">Loading...</p>';

    let query = _supabase.from('user_points').select('points_awarded, created_at')
        .eq('user_id', userId).order('created_at', { ascending: true });
    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate + 'T23:59:59');
    if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
        query = query.eq('team_id', adminState.teamLeaderForTeamId);
    }
    const { data, error } = await query;
    if (error) { showNotification('Error', error.message, 'error'); resultsDiv.innerHTML = ''; return; }
    if (!data || data.length === 0) { resultsDiv.innerHTML = '<p class="text-gray-400 text-sm">No data found.</p>'; return; }

    // Group by ISO week
    const weeks = {};
    data.forEach(r => {
        const d = new Date(r.created_at);
        const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const key = mon.toISOString().split('T')[0];
        weeks[key] = (weeks[key] || 0) + (r.points_awarded || 0);
    });

    const rows = Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b));
    resultsDiv.innerHTML = `<table class="w-full text-xs border-collapse">
        <thead><tr class="text-gray-400 border-b border-gray-700">
            <th class="text-left py-1 pr-3">Week of</th><th class="text-right py-1">Total Points</th>
        </tr></thead>
        <tbody>${rows.map(([week, pts]) => `<tr class="border-b border-gray-800">
            <td class="py-1 pr-3 text-gray-300">${week}</td>
            <td class="py-1 text-right font-medium ${pts >= 0 ? 'text-green-400' : 'text-red-400'}">${pts >= 0 ? '+' : ''}${pts}</td>
        </tr>`).join('')}</tbody></table>`;
    window._analyticsWeeklyData = rows;
}

async function exportWeeklyHistoryReport() {
    if (!window._analyticsWeeklyData?.length) { await generateWeeklyHistoryReport(); }
    const data = window._analyticsWeeklyData;
    if (!data?.length) return;
    downloadCSV([['Week of', 'Total Points'], ...data], 'weekly_scores.csv');
}

async function analyzeKPI() {
    const startDate = document.getElementById('admin-kpi-start-date')?.value;
    const endDate = document.getElementById('admin-kpi-end-date')?.value;
    const resultsDiv = document.getElementById('admin-kpi-results');
    if (!resultsDiv) return;
    if (!startDate || !endDate) { showNotification('Missing', 'Please select both start and end dates.', 'warning'); return; }

    resultsDiv.innerHTML = '<p class="text-gray-400 text-sm">Analyzing...</p>';

    let query = _supabase.from('user_points').select('user_id, username, points_awarded, event_type, created_at')
        .gte('created_at', startDate).lte('created_at', endDate + 'T23:59:59');
    if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
        query = query.eq('team_id', adminState.teamLeaderForTeamId);
    }
    const { data, error } = await query;
    if (error) { showNotification('Error', error.message, 'error'); resultsDiv.innerHTML = ''; return; }
    if (!data || data.length === 0) { resultsDiv.innerHTML = '<p class="text-gray-400 text-sm">No data in this period.</p>'; return; }

    // Aggregate per user
    const users = {};
    data.forEach(r => {
        if (!users[r.user_id]) users[r.user_id] = { username: r.username, total: 0, events: 0 };
        users[r.user_id].total += r.points_awarded || 0;
        users[r.user_id].events++;
    });

    const sorted = Object.values(users).sort((a, b) => b.total - a.total);
    const avg = sorted.reduce((s, u) => s + u.total, 0) / sorted.length;

    resultsDiv.innerHTML = `
        <div class="text-sm text-gray-400 mb-3">Period: <span class="text-white">${startDate}</span> → <span class="text-white">${endDate}</span> | Team avg: <span class="text-yellow-400 font-bold">${avg.toFixed(0)} pts</span></div>
        <table class="w-full text-xs border-collapse">
            <thead><tr class="text-gray-400 border-b border-gray-700">
                <th class="text-left py-1 pr-3">User</th><th class="text-right py-1 pr-3">Points</th><th class="text-right py-1">vs Avg</th>
            </tr></thead>
            <tbody>${sorted.map(u => {
                const diff = u.total - avg;
                return `<tr class="border-b border-gray-800">
                    <td class="py-1 pr-3 text-white font-medium">${escapeHtmlAdmin(u.username)}</td>
                    <td class="py-1 pr-3 text-right text-green-400 font-bold">${u.total}</td>
                    <td class="py-1 text-right ${diff >= 0 ? 'text-green-400' : 'text-red-400'}">${diff >= 0 ? '+' : ''}${diff.toFixed(0)}</td>
                </tr>`;
            }).join('')}</tbody>
        </table>`;
    window._kpiData = { sorted, startDate, endDate };
}

async function exportKPIReport() {
    if (!window._kpiData) { await analyzeKPI(); }
    const d = window._kpiData;
    if (!d) return;
    downloadCSV(
        [['User', 'Total Points', 'Events'], ...d.sorted.map(u => [u.username, u.total, u.events])],
        `kpi_${d.startDate}_to_${d.endDate}.csv`
    );
}

// -----------------------------------------------------------------
// ATTENDANCE SECTION
// -----------------------------------------------------------------
let attendanceUsersBound = false;

async function loadAttendance() {
    if (attendanceUsersBound) return;
    attendanceUsersBound = true;
    await populateAttendanceUserDropdown();
    // Default date range: last 30 days
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 29);
    const fmt = d => d.toISOString().split('T')[0];
    const startEl = document.getElementById('admin-report-start-date');
    const endEl = document.getElementById('admin-report-end-date');
    if (startEl && !startEl.value) startEl.value = fmt(thirtyDaysAgo);
    if (endEl && !endEl.value) endEl.value = fmt(today);
}

async function populateAttendanceUserDropdown() {
    let query = _supabase.from('user_settings').select('user_id, display_name').order('display_name');
    if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
        query = query.eq('team_id', adminState.teamLeaderForTeamId);
    }
    const { data: users } = await query;
    if (!users) return;
    const sel = document.getElementById('admin-report-user-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Select a user —</option>' +
        users.map(u => `<option value="${u.user_id}">${escapeHtmlAdmin(u.display_name || 'Unknown')}</option>`).join('');
}

async function generateAttendanceReport() {
    const userId = document.getElementById('admin-report-user-select')?.value;
    const startDate = document.getElementById('admin-report-start-date')?.value;
    const endDate = document.getElementById('admin-report-end-date')?.value;
    const resultsDiv = document.getElementById('admin-attendance-report-results');
    if (!resultsDiv) return;
    if (!userId) { showNotification('Missing', 'Please select a user.', 'warning'); return; }
    if (!startDate || !endDate) { showNotification('Missing', 'Please select both start and end dates.', 'warning'); return; }

    resultsDiv.innerHTML = '<p class="text-gray-400 text-sm">Generating...</p>';

    // Query real attendance table — a user is "present" if they have a shift_start on that day
    let query = _supabase.from('attendance')
        .select('user_id, username, shift_start, shift_end, device_type, total_break_time_minutes')
        .eq('user_id', userId)
        .gte('shift_start', startDate)
        .lte('shift_start', endDate + 'T23:59:59')
        .order('shift_start', { ascending: true });
    if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
        query = query.eq('team_id', adminState.teamLeaderForTeamId);
    }
    const { data, error } = await query;
    if (error) { showNotification('Error', error.message, 'error'); resultsDiv.innerHTML = ''; return; }

    // Group shifts by day (there can be multiple shifts in a day)
    const shiftsByDay = {};
    let resolvedUsername = '';
    (data || []).forEach(r => {
        const day = r.shift_start.split('T')[0];
        if (!shiftsByDay[day]) shiftsByDay[day] = [];
        shiftsByDay[day].push(r);
        if (r.username) resolvedUsername = r.username;
    });

    // Generate every day in the selected range
    const allDays = [];
    for (let d = new Date(startDate); d <= new Date(endDate); d.setDate(d.getDate() + 1)) {
        allDays.push(d.toISOString().split('T')[0]);
    }

    const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let workedDays = 0, offDays = 0, weekendDays = 0, totalShiftHours = 0;

    const rows = allDays.map(day => {
        const dow = new Date(day + 'T12:00:00').getDay();
        const isWeekend = dow === 0 || dow === 6;
        const shifts = shiftsByDay[day] || null;

        let shiftHours = 0;
        if (shifts) {
            shifts.forEach(s => {
                if (s.shift_start && s.shift_end) {
                    shiftHours += (new Date(s.shift_end) - new Date(s.shift_start)) / 3600000;
                }
            });
        }

        if (isWeekend) { weekendDays++; }
        else if (shifts) { workedDays++; totalShiftHours += shiftHours; }
        else { offDays++; }

        return { day, dow, isWeekend, shifts, shiftHours };
    });

    const sel = document.getElementById('admin-report-user-select');
    const displayName = resolvedUsername || sel?.options[sel?.selectedIndex]?.text || 'User';
    const workingDaysTotal = allDays.length - weekendDays;
    const attendancePct = workingDaysTotal > 0 ? Math.round(workedDays / workingDaysTotal * 100) : 0;

    const fmtTime = iso => iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    const fmtHours = h => h > 0 ? `${h.toFixed(1)}h` : '—';

    resultsDiv.style.maxHeight = 'none';
    resultsDiv.style.overflow = 'visible';

    resultsDiv.innerHTML = `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div class="bg-green-500/10 border border-green-500/20 rounded-lg p-3 text-center">
                <div class="text-2xl font-bold text-green-400">${workedDays}</div>
                <div class="text-xs text-gray-400 mt-0.5">Days Worked</div>
            </div>
            <div class="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-center">
                <div class="text-2xl font-bold text-red-400">${offDays}</div>
                <div class="text-xs text-gray-400 mt-0.5">Days Off</div>
            </div>
            <div class="bg-gray-500/10 border border-gray-600/30 rounded-lg p-3 text-center">
                <div class="text-2xl font-bold text-gray-400">${weekendDays}</div>
                <div class="text-xs text-gray-400 mt-0.5">Weekends</div>
            </div>
            <div class="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 text-center">
                <div class="text-2xl font-bold text-blue-400">${totalShiftHours.toFixed(1)}h</div>
                <div class="text-xs text-gray-400 mt-0.5">Total Hours</div>
            </div>
        </div>
        <div class="bg-gray-700/30 rounded-lg p-3 mb-4">
            <div class="flex justify-between items-center mb-1.5">
                <span class="text-xs text-gray-400">${escapeHtmlAdmin(displayName)} — Attendance rate (${workedDays}/${workingDaysTotal} working days)</span>
                <span class="text-sm font-bold text-white">${attendancePct}%</span>
            </div>
            <div class="w-full bg-gray-700 rounded-full h-2">
                <div class="bg-green-500 h-2 rounded-full transition-all" style="width:${attendancePct}%"></div>
            </div>
        </div>
        <div style="max-height:420px; overflow-y:auto;">
            <table class="w-full text-xs border-collapse">
                <thead class="sticky top-0 bg-gray-800 z-10">
                    <tr class="text-gray-400 border-b border-gray-700">
                        <th class="text-left py-1.5 pr-3 pl-1">Date</th>
                        <th class="text-left py-1.5 pr-3">Day</th>
                        <th class="text-center py-1.5 pr-3">Status</th>
                        <th class="text-right py-1.5 pr-3">Clock In</th>
                        <th class="text-right py-1.5 pr-3">Clock Out</th>
                        <th class="text-right py-1.5">Hours</th>
                    </tr>
                </thead>
                <tbody>${rows.map(({ day, dow, isWeekend, shifts, shiftHours }) => {
                    let badge, rowOpacity;
                    if (isWeekend) {
                        badge = '<span class="px-1.5 py-0.5 rounded text-gray-600 bg-gray-700/50">Weekend</span>';
                        rowOpacity = 'opacity-40';
                    } else if (shifts) {
                        badge = '<span class="px-1.5 py-0.5 rounded text-green-400 bg-green-500/15">Present</span>';
                        rowOpacity = '';
                    } else {
                        badge = '<span class="px-1.5 py-0.5 rounded text-red-400 bg-red-500/15">Off</span>';
                        rowOpacity = '';
                    }
                    // Show first shift's times (most common case is one shift per day)
                    const s = shifts?.[0];
                    return `<tr class="border-b border-gray-800/60 ${rowOpacity}">
                        <td class="py-1.5 pr-3 pl-1 text-gray-300">${day}</td>
                        <td class="py-1.5 pr-3 text-gray-400">${DOW_NAMES[dow]}</td>
                        <td class="py-1.5 pr-3 text-center">${badge}</td>
                        <td class="py-1.5 pr-3 text-right ${s ? 'text-gray-300' : 'text-gray-600'}">${s ? fmtTime(s.shift_start) : '—'}</td>
                        <td class="py-1.5 pr-3 text-right ${s?.shift_end ? 'text-gray-300' : 'text-yellow-500'}">${s ? fmtTime(s.shift_end) : '—'}</td>
                        <td class="py-1.5 text-right ${shiftHours > 0 ? 'text-blue-400' : 'text-gray-600'}">${fmtHours(shiftHours)}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>
        </div>
        <div class="flex gap-2 mt-3">
            <button onclick="adminPanel.filterAttendance('all')" id="att-filter-all"
                class="att-filter-btn flex-1 text-xs py-1.5 px-2 rounded-lg bg-indigo-600 text-white font-medium transition-colors">
                All
            </button>
            <button onclick="adminPanel.filterAttendance('present')" id="att-filter-present"
                class="att-filter-btn flex-1 text-xs py-1.5 px-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                Present only
            </button>
            <button onclick="adminPanel.filterAttendance('off')" id="att-filter-off"
                class="att-filter-btn flex-1 text-xs py-1.5 px-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                Off days only
            </button>
            <button onclick="adminPanel.exportAttendanceReport()"
                class="flex-1 text-xs py-1.5 px-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                Export CSV
            </button>
        </div>`;

    window._attendanceData = { rows, displayName, startDate, endDate, DOW_NAMES, fmtTime, fmtHours };
}

async function exportAttendanceReport() {
    if (!window._attendanceData) { await generateAttendanceReport(); }
    const d = window._attendanceData;
    if (!d) return;
    const csvRows = [
        ['Date', 'Day', 'Status', 'Clock In', 'Clock Out', 'Hours'],
        ...d.rows.map(({ day, dow, isWeekend, shifts, shiftHours }) => {
            const s = shifts?.[0];
            return [
                day,
                d.DOW_NAMES[dow],
                isWeekend ? 'Weekend' : (shifts ? 'Present' : 'Off'),
                s ? d.fmtTime(s.shift_start) : '',
                s ? d.fmtTime(s.shift_end) : '',
                shiftHours > 0 ? shiftHours.toFixed(1) : ''
            ];
        })
    ];
    downloadCSV(csvRows, `attendance_${d.displayName}_${d.startDate}_to_${d.endDate}.csv`);
}

function filterAttendance(filter) {
    // Update active button style
    document.querySelectorAll('.att-filter-btn').forEach(btn => {
        btn.classList.remove('bg-indigo-600', 'text-white', 'font-medium');
        btn.classList.add('bg-gray-700', 'text-gray-300');
    });
    const activeBtn = document.getElementById(`att-filter-${filter}`);
    if (activeBtn) {
        activeBtn.classList.remove('bg-gray-700', 'text-gray-300');
        activeBtn.classList.add('bg-indigo-600', 'text-white', 'font-medium');
    }

    // Show/hide rows based on filter
    document.querySelectorAll('#admin-attendance-report-results tbody tr').forEach(row => {
        const statusCell = row.querySelector('td:nth-child(3)');
        if (!statusCell) return;
        const text = statusCell.textContent.trim().toLowerCase();
        let visible = true;
        if (filter === 'present') visible = text === 'present';
        else if (filter === 'off') visible = text === 'off';
        row.style.display = visible ? '' : 'none';
    });
}

// -----------------------------------------------------------------
// CSV DOWNLOAD HELPER
// -----------------------------------------------------------------
function downloadCSV(rows, filename) {
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
}

async function loadArchive() {
    // Coming soon
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

// Expose functions called via inline onclick handlers in the HTML
window.adminPanel = {
    searchTickets,
    loadMoreTickets,
    clearTicketFilters,
    showTicketDetail,
    closeTicketDetail,
    deleteAdminTicket,
    generateUserActivityReport,
    exportUserActivityReport,
    generateWeeklyHistoryReport,
    exportWeeklyHistoryReport,
    analyzeKPI,
    exportKPIReport,
    generateAttendanceReport,
    exportAttendanceReport,
    filterAttendance,
};
