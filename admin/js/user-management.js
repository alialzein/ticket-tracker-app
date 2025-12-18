// User Management Module
import { _supabase } from '../../js/config.js';
import { showNotification } from './admin-main.js';

// State
const userManagementState = {
    allUsers: [],
    filteredUsers: [],
    currentUser: null,
    teams: []
};

/**
 * Initialize user management
 */
export async function initUserManagement() {
    console.log('[UserManagement] Initializing...');

    // Load teams for dropdowns
    await loadTeams();

    // Load users
    await loadAllUsers();

    // Setup event listeners
    setupEventListeners();

    console.log('[UserManagement] Initialized successfully');
}

/**
 * Load all teams from database
 */
async function loadTeams() {
    try {
        const { data: teams, error } = await _supabase
            .from('teams')
            .select('id, name')
            .eq('is_active', true)
            .order('name');

        if (error) {
            console.error('[UserManagement] Error loading teams:', error);
            userManagementState.teams = [];
            return;
        }

        userManagementState.teams = teams || [];
        console.log('[UserManagement] Loaded', teams?.length || 0, 'teams');

        // Populate team dropdowns
        populateTeamDropdowns();

        // Populate team filter
        populateTeamFilter();

    } catch (err) {
        console.error('[UserManagement] Exception loading teams:', err);
        userManagementState.teams = [];
    }
}

/**
 * Populate team dropdowns in modals
 */
function populateTeamDropdowns() {
    const createTeamSelect = document.getElementById('create-user-team');
    const editTeamSelect = document.getElementById('edit-user-team');
    const filterTeamSelect = document.getElementById('user-team-filter');

    if (createTeamSelect) {
        createTeamSelect.innerHTML = '<option value="">Select a team...</option>' +
            userManagementState.teams.map(team =>
                `<option value="${team.id}">${team.name}</option>`
            ).join('');
    }

    if (editTeamSelect) {
        editTeamSelect.innerHTML = '<option value="">Select a team...</option>' +
            userManagementState.teams.map(team =>
                `<option value="${team.id}">${team.name}</option>`
            ).join('');
    }
}

/**
 * Populate team filter dropdown
 */
function populateTeamFilter() {
    const filterTeamSelect = document.getElementById('user-team-filter');

    if (filterTeamSelect) {
        filterTeamSelect.innerHTML = '<option value="all">All Teams</option>' +
            userManagementState.teams.map(team =>
                `<option value="${team.id}">${team.name}</option>`
            ).join('');
    }
}

/**
 * Load all users with their details
 */
export async function loadAllUsers() {
    try {
        console.log('[UserManagement] Loading all users...');

        // Query user_settings with team info
        const { data: users, error } = await _supabase
            .from('user_settings')
            .select(`
                user_id,
                system_username,
                display_name,
                name_color,
                team_id,
                is_blocked,
                blocked_at,
                blocked_by,
                blocked_reason,
                teams:team_id (
                    id,
                    name
                )
            `)
            .order('system_username');

        if (error) throw error;

        // Store users
        userManagementState.allUsers = (users || []).map(user => ({
            user_id: user.user_id,
            username: user.system_username || user.display_name || 'Unknown',
            display_name: user.display_name || user.system_username || 'Unknown',
            email: `${user.system_username}@b-pal.net`, // Construct email from username
            team_id: user.team_id,
            team_name: user.teams?.name || 'No Team',
            is_blocked: user.is_blocked || false,
            blocked_at: user.blocked_at,
            blocked_by: user.blocked_by,
            blocked_reason: user.blocked_reason,
            initials: getInitials(user.display_name || user.system_username),
            color: user.name_color || generateColor(user.system_username) // Use name_color or generate
        }));

        console.log('[UserManagement] Loaded', userManagementState.allUsers.length, 'users');

        // Apply filters
        applyFilters();

    } catch (err) {
        console.error('[UserManagement] Error loading users:', err);
        userManagementState.allUsers = [];
        userManagementState.filteredUsers = [];
        renderUserTable();
    }
}

/**
 * Get initials from name
 */
function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Generate consistent color from string
 */
function generateColor(str) {
    if (!str) return '#3B82F6';

    // Hash the string
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Convert to HSL for better colors
    const h = Math.abs(hash % 360);
    const s = 65; // Saturation
    const l = 55; // Lightness

    return `hsl(${h}, ${s}%, ${l}%)`;
}

/**
 * Apply filters to user list
 */
function applyFilters() {
    const searchInput = document.getElementById('user-search-input');
    const statusFilter = document.getElementById('user-status-filter');
    const teamFilter = document.getElementById('user-team-filter');

    const searchTerm = searchInput?.value.toLowerCase() || '';
    const statusValue = statusFilter?.value || 'all';
    const teamValue = teamFilter?.value || 'all';

    userManagementState.filteredUsers = userManagementState.allUsers.filter(user => {
        // Search filter
        const matchesSearch = !searchTerm ||
            user.username.toLowerCase().includes(searchTerm) ||
            user.display_name.toLowerCase().includes(searchTerm) ||
            user.email.toLowerCase().includes(searchTerm);

        // Status filter
        const matchesStatus = statusValue === 'all' ||
            (statusValue === 'active' && !user.is_blocked) ||
            (statusValue === 'blocked' && user.is_blocked);

        // Team filter
        const matchesTeam = teamValue === 'all' || user.team_id === teamValue;

        return matchesSearch && matchesStatus && matchesTeam;
    });

    renderUserTable();
}

/**
 * Render user table
 */
function renderUserTable() {
    const tbody = document.getElementById('users-table-body');
    const emptyState = document.getElementById('users-empty-state');
    const userCount = document.getElementById('user-count');

    if (!tbody) return;

    // Update count
    if (userCount) {
        userCount.textContent = userManagementState.filteredUsers.length;
    }

    // Handle empty state
    if (userManagementState.filteredUsers.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    // Render rows
    tbody.innerHTML = userManagementState.filteredUsers.map(user => `
        <tr class="hover:bg-gray-700/30 transition-colors">
            <!-- Avatar & Name -->
            <td class="p-3">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm" style="background-color: ${user.color}">
                        ${user.initials}
                    </div>
                    <div>
                        <p class="text-white font-medium">${escapeHtml(user.display_name)}</p>
                        <p class="text-xs text-gray-400">${escapeHtml(user.username)}</p>
                    </div>
                </div>
            </td>

            <!-- Email -->
            <td class="p-3">
                <p class="text-gray-300 text-sm">${escapeHtml(user.email)}</p>
            </td>

            <!-- Team -->
            <td class="p-3">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-400">
                    ${escapeHtml(user.team_name)}
                </span>
            </td>

            <!-- Status -->
            <td class="p-3 text-center">
                ${user.is_blocked ?
                    '<span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-red-500/20 text-red-400">🚫 Blocked</span>' :
                    '<span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">✓ Active</span>'
                }
            </td>

            <!-- Actions -->
            <td class="p-3">
                <div class="flex items-center justify-center gap-2">
                    <button onclick="userManagement.openEditUserModal('${user.user_id}')" class="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors" title="Edit">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    ${user.is_blocked ?
                        `<button onclick="userManagement.unblockUser('${user.user_id}')" class="p-2 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded transition-colors" title="Unblock">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                        </button>` :
                        `<button onclick="userManagement.openBlockUserModal('${user.user_id}')" class="p-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 rounded transition-colors" title="Block">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path>
                            </svg>
                        </button>`
                    }
                    <button onclick="userManagement.openDeleteUserModal('${user.user_id}')" class="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors" title="Delete">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Search input
    const searchInput = document.getElementById('user-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', applyFilters);
    }

    // Status filter
    const statusFilter = document.getElementById('user-status-filter');
    if (statusFilter) {
        statusFilter.addEventListener('change', applyFilters);
    }

    // Team filter
    const teamFilter = document.getElementById('user-team-filter');
    if (teamFilter) {
        teamFilter.addEventListener('change', applyFilters);
    }

    // Create user form
    const createForm = document.getElementById('create-user-form');
    if (createForm) {
        createForm.addEventListener('submit', handleCreateUser);
    }

    // Edit user form
    const editForm = document.getElementById('edit-user-form');
    if (editForm) {
        editForm.addEventListener('submit', handleEditUser);
    }

    // Block user form
    const blockForm = document.getElementById('block-user-form');
    if (blockForm) {
        blockForm.addEventListener('submit', handleBlockUser);
    }

    // Delete user form
    const deleteForm = document.getElementById('delete-user-form');
    if (deleteForm) {
        deleteForm.addEventListener('submit', handleDeleteUser);
    }

    // Delete confirmation input
    const deleteConfirmInput = document.getElementById('delete-user-confirmation');
    if (deleteConfirmInput) {
        deleteConfirmInput.addEventListener('input', () => {
            const deleteUsername = document.getElementById('delete-user-username').value;
            const submitBtn = document.getElementById('delete-user-submit-btn');
            submitBtn.disabled = deleteConfirmInput.value !== deleteUsername;
        });
    }

    // Close modals on background click
    document.querySelectorAll('[id$="-modal"]').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
                modal.classList.remove('flex');
            }
        });
    });
}

// ============================================
// MODAL FUNCTIONS
// ============================================

/**
 * Open create user modal
 */
export function openCreateUserModal() {
    const modal = document.getElementById('create-user-modal');
    const form = document.getElementById('create-user-form');

    form.reset();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

/**
 * Close create user modal
 */
export function closeCreateUserModal() {
    const modal = document.getElementById('create-user-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

/**
 * Open edit user modal
 */
export function openEditUserModal(userId) {
    const user = userManagementState.allUsers.find(u => u.user_id === userId);
    if (!user) {
        showNotification('Error', 'User not found', 'error');
        return;
    }

    const modal = document.getElementById('edit-user-modal');

    // Populate form
    document.getElementById('edit-user-id').value = user.user_id;
    document.getElementById('edit-user-email').value = user.email;
    document.getElementById('edit-user-display-name').value = user.display_name;
    document.getElementById('edit-user-team').value = user.team_id || '';
    // Note: is_admin will need to be fetched from user metadata

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

/**
 * Close edit user modal
 */
export function closeEditUserModal() {
    const modal = document.getElementById('edit-user-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

/**
 * Open block user modal
 */
export function openBlockUserModal(userId) {
    const user = userManagementState.allUsers.find(u => u.user_id === userId);
    if (!user) {
        showNotification('Error', 'User not found', 'error');
        return;
    }

    const modal = document.getElementById('block-user-modal');

    document.getElementById('block-user-id').value = user.user_id;
    document.getElementById('block-user-name').value = user.username;
    document.getElementById('block-user-display').textContent = user.display_name;
    document.getElementById('block-user-reason').value = '';

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

/**
 * Close block user modal
 */
export function closeBlockUserModal() {
    const modal = document.getElementById('block-user-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

/**
 * Open delete user modal
 */
export function openDeleteUserModal(userId) {
    const user = userManagementState.allUsers.find(u => u.user_id === userId);
    if (!user) {
        showNotification('Error', 'User not found', 'error');
        return;
    }

    const modal = document.getElementById('delete-user-modal');

    document.getElementById('delete-user-id').value = user.user_id;
    document.getElementById('delete-user-username').value = user.username;
    document.getElementById('delete-user-display').textContent = user.display_name;
    document.getElementById('delete-confirm-username').textContent = user.username;
    document.getElementById('delete-user-confirmation').value = '';
    document.getElementById('delete-user-submit-btn').disabled = true;

    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

/**
 * Close delete user modal
 */
export function closeDeleteUserModal() {
    const modal = document.getElementById('delete-user-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// ============================================
// CRUD OPERATIONS
// ============================================

/**
 * Handle create user form submission
 */
async function handleCreateUser(e) {
    e.preventDefault();

    const email = document.getElementById('create-user-email').value.trim();
    const displayName = document.getElementById('create-user-display-name').value.trim();
    const teamId = document.getElementById('create-user-team').value;
    const isAdmin = document.getElementById('create-user-is-admin').checked;
    const sendEmail = document.getElementById('create-user-send-email').checked;

    // Validate email format
    if (!email.endsWith('@b-pal.net')) {
        showNotification('Invalid Email', 'Email must be in format username@b-pal.net', 'error');
        return;
    }

    // Extract username from email
    const username = email.split('@')[0];

    // Generate display name if empty
    const finalDisplayName = displayName || username;

    try {
        console.log('[UserManagement] Creating user:', email);

        // Note: We cannot use Supabase Admin API from client-side
        // This would need to be done through an Edge Function or server-side API
        // For now, we'll show a message that this requires admin API access

        showNotification(
            'Feature Coming Soon',
            'User creation requires server-side API integration. This will be implemented with Supabase Edge Functions.',
            'warning'
        );

        // TODO: Implement with Edge Function
        // The Edge Function should:
        // 1. Create user in auth.users using admin API
        // 2. Set user metadata (is_admin, role)
        // 3. Create user_settings record
        // 4. Add to team_members
        // 5. Send password reset email if sendEmail is true
        // 6. Log action in admin_audit_log

        closeCreateUserModal();

    } catch (err) {
        console.error('[UserManagement] Error creating user:', err);
        showNotification('Error', err.message, 'error');
    }
}

/**
 * Handle edit user form submission
 */
async function handleEditUser(e) {
    e.preventDefault();

    const userId = document.getElementById('edit-user-id').value;
    const displayName = document.getElementById('edit-user-display-name').value.trim();
    const teamId = document.getElementById('edit-user-team').value || null;
    const isAdmin = document.getElementById('edit-user-is-admin').checked;

    try {
        console.log('[UserManagement] Updating user:', userId);

        // Update user_settings
        const { error: settingsError } = await _supabase
            .from('user_settings')
            .update({
                display_name: displayName,
                team_id: teamId
            })
            .eq('user_id', userId);

        if (settingsError) throw settingsError;

        // TODO: Update team_members if team changed
        // TODO: Update user metadata for admin role if changed
        // TODO: Log action in admin_audit_log

        showNotification('Success', 'User updated successfully', 'success');
        closeEditUserModal();
        await loadAllUsers();

    } catch (err) {
        console.error('[UserManagement] Error updating user:', err);
        showNotification('Error', err.message, 'error');
    }
}

/**
 * Handle block user form submission
 */
async function handleBlockUser(e) {
    e.preventDefault();

    const userId = document.getElementById('block-user-id').value;
    const username = document.getElementById('block-user-name').value;
    const reason = document.getElementById('block-user-reason').value.trim();

    if (!reason) {
        showNotification('Missing Reason', 'Please provide a reason for blocking this user', 'error');
        return;
    }

    try {
        console.log('[UserManagement] Blocking user:', username);

        // Get current admin user
        const { data: { user: currentUser } } = await _supabase.auth.getUser();

        // Update user_settings
        const { error } = await _supabase
            .from('user_settings')
            .update({
                is_blocked: true,
                blocked_at: new Date().toISOString(),
                blocked_by: currentUser.id,
                blocked_reason: reason
            })
            .eq('user_id', userId);

        if (error) throw error;

        // TODO: Log action in admin_audit_log

        showNotification('Success', `User ${username} has been blocked`, 'success');
        closeBlockUserModal();
        await loadAllUsers();

    } catch (err) {
        console.error('[UserManagement] Error blocking user:', err);
        showNotification('Error', err.message, 'error');
    }
}

/**
 * Unblock user
 */
export async function unblockUser(userId) {
    const user = userManagementState.allUsers.find(u => u.user_id === userId);
    if (!user) {
        showNotification('Error', 'User not found', 'error');
        return;
    }

    if (!confirm(`Are you sure you want to unblock ${user.display_name}?`)) {
        return;
    }

    try {
        console.log('[UserManagement] Unblocking user:', user.username);

        // Update user_settings
        const { error } = await _supabase
            .from('user_settings')
            .update({
                is_blocked: false,
                blocked_at: null,
                blocked_by: null,
                blocked_reason: null
            })
            .eq('user_id', userId);

        if (error) throw error;

        // TODO: Log action in admin_audit_log

        showNotification('Success', `User ${user.username} has been unblocked`, 'success');
        await loadAllUsers();

    } catch (err) {
        console.error('[UserManagement] Error unblocking user:', err);
        showNotification('Error', err.message, 'error');
    }
}

/**
 * Handle delete user form submission
 */
async function handleDeleteUser(e) {
    e.preventDefault();

    const userId = document.getElementById('delete-user-id').value;
    const username = document.getElementById('delete-user-username').value;
    const confirmation = document.getElementById('delete-user-confirmation').value.trim();

    if (confirmation !== username) {
        showNotification('Confirmation Failed', 'Username does not match', 'error');
        return;
    }

    try {
        console.log('[UserManagement] Deleting user:', username);

        // Note: Full user deletion requires admin API and cascade handling
        // For now, we'll implement soft delete

        // Mark as deleted in user_settings (would need to add is_deleted column)
        // This would require a database migration to add the column

        showNotification(
            'Feature Coming Soon',
            'User deletion requires additional database schema and Edge Function implementation.',
            'warning'
        );

        // TODO: Implement with Edge Function
        // The Edge Function should:
        // 1. Soft delete: Mark is_deleted = true in user_settings
        // 2. Hard delete option: Delete from auth.users (cascades to user_settings)
        // 3. Handle orphaned data (tickets, points, attendance)
        // 4. Log action in admin_audit_log

        closeDeleteUserModal();

    } catch (err) {
        console.error('[UserManagement] Error deleting user:', err);
        showNotification('Error', err.message, 'error');
    }
}

// Export functions for use in HTML
window.userManagement = {
    openCreateUserModal,
    closeCreateUserModal,
    openEditUserModal,
    closeEditUserModal,
    openBlockUserModal,
    closeBlockUserModal,
    openDeleteUserModal,
    closeDeleteUserModal,
    unblockUser
};
