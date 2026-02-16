// User Management Module
import { _supabase, SUPABASE_URL_EXPORT } from '../../js/config.js';
import { showNotification, adminState } from './admin-main.js';

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

    // Hide create user button for team leaders (they can only view/edit, not create or delete)
    if (adminState.isTeamLeader && !adminState.isSuperAdmin) {
        const createUserButton = document.getElementById('create-user-button');
        if (createUserButton) {
            createUserButton.style.display = 'none';
        }
    }

    // Hide team leader checkbox for non-super admins
    if (!adminState.isSuperAdmin) {
        const createTeamLeaderContainer = document.getElementById('create-user-team-leader-container');
        const editTeamLeaderContainer = document.getElementById('edit-user-team-leader-container');
        if (createTeamLeaderContainer) {
            createTeamLeaderContainer.style.display = 'none';
        }
        if (editTeamLeaderContainer) {
            editTeamLeaderContainer.style.display = 'none';
        }
    }

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
        let query = _supabase
            .from('user_settings')
            .select(`
                user_id,
                system_username,
                display_name,
                email,
                name_color,
                team_id,
                is_blocked,
                blocked_at,
                blocked_by,
                blocked_reason,
                is_team_leader,
                team_leader_for_team_id,
                teams:team_id (
                    id,
                    name
                )
            `)
            .order('system_username');

        // Team leaders can only see their team's users
        if (adminState.isTeamLeader && adminState.teamLeaderForTeamId) {
            query = query.eq('team_id', adminState.teamLeaderForTeamId);
        }

        const { data: users, error } = await query;

        if (error) throw error;

        // Store users
        userManagementState.allUsers = (users || []).map(user => ({
            user_id: user.user_id,
            username: user.system_username || user.display_name || 'Unknown',
            display_name: user.display_name || user.system_username || 'Unknown',
            email: user.email || `${user.system_username}@b-pal.net`, // Use stored email or fallback to constructed one
            team_id: user.team_id,
            team_name: user.teams?.name || 'No Team',
            is_blocked: user.is_blocked || false,
            blocked_at: user.blocked_at,
            blocked_by: user.blocked_by,
            blocked_reason: user.blocked_reason,
            is_team_leader: user.is_team_leader || false,
            team_leader_for_team_id: user.team_leader_for_team_id,
            name_color: user.name_color || '#00D9FF', // Store actual name_color
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
                    ${(adminState.isSuperAdmin || adminState.isTeamLeader) ? (user.is_blocked ?
                        `<button onclick="userManagement.unblockUser('${user.user_id}')" class="p-2 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded transition-colors" title="Unblock">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                            </svg>
                        </button>` :
                        `<button onclick="userManagement.openBlockUserModal('${user.user_id}')" class="p-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 rounded transition-colors" title="Block">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path>
                            </svg>
                        </button>`) : ''}
                    ${adminState.isSuperAdmin ? `<button onclick="userManagement.openSetPasswordModal('${user.user_id}', '${escapeHtml(user.display_name)}')" class="p-2 text-purple-400 hover:text-purple-300 hover:bg-purple-500/10 rounded transition-colors" title="Set Password">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path>
                        </svg>
                    </button>
                    <button onclick="userManagement.openDeleteUserModal('${user.user_id}')" class="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors" title="Delete">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>` : ''}
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

    // Edit user color preview
    const editUserNameColor = document.getElementById('edit-user-name-color');
    if (editUserNameColor) {
        editUserNameColor.addEventListener('input', (e) => {
            document.getElementById('edit-name-preview').style.color = e.target.value;
        });
    }

    // Edit user display name preview
    const editUserDisplayName = document.getElementById('edit-user-display-name');
    if (editUserDisplayName) {
        editUserDisplayName.addEventListener('input', (e) => {
            document.getElementById('edit-name-preview').textContent = e.target.value || 'User Name';
        });
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

    // Close modals on background click (but not when an input/select/textarea is focused)
    document.querySelectorAll('[id$="-modal"]').forEach(modal => {
        modal.addEventListener('mousedown', (e) => {
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

    // SECURITY: Hide admin checkbox for non-super-admins
    const adminCheckbox = document.getElementById('create-user-is-admin');
    const adminCheckboxContainer = adminCheckbox?.closest('.flex.items-center.gap-2');

    if (adminCheckboxContainer) {
        if (adminState.isSuperAdmin) {
            // Super admin can see and use the checkbox
            adminCheckboxContainer.style.display = 'flex';
            adminCheckbox.disabled = false;
        } else {
            // Regular admin cannot grant admin privileges
            adminCheckboxContainer.style.display = 'none';
            adminCheckbox.checked = false;
            adminCheckbox.disabled = true;
        }
    }

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
    document.getElementById('edit-user-is-team-leader').checked = user.is_team_leader || false;

    // Populate name color
    const nameColor = user.name_color || '#00D9FF';
    document.getElementById('edit-user-name-color').value = nameColor;
    document.getElementById('edit-name-preview').style.color = nameColor;
    document.getElementById('edit-name-preview').textContent = user.display_name || 'User Name';

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

/**
 * Show password reset link modal
 */
function showPasswordResetLinkModal(email, resetLink) {
    // Create modal dynamically
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 shadow-xl border border-gray-700">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-xl font-bold text-white flex items-center gap-2">
                    <svg class="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                    </svg>
                    User Created Successfully
                </h3>
                <button onclick="this.closest('.fixed').remove()" class="text-gray-400 hover:text-white">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>

            <div class="space-y-4">
                <div class="bg-gray-900 rounded-lg p-4 border border-gray-700">
                    <p class="text-gray-300 text-sm mb-2">User <span class="font-semibold text-white">${email}</span> has been created.</p>
                    <p class="text-yellow-400 text-sm font-medium">⚠️ Share this password reset link with the user to set their password:</p>
                </div>

                <div class="bg-gray-900 rounded-lg p-4 border border-blue-500">
                    <label class="block text-sm font-medium text-gray-300 mb-2">Password Reset Link:</label>
                    <div class="flex gap-2">
                        <input type="text" readonly value="${resetLink}"
                               id="reset-link-input"
                               class="flex-1 bg-gray-800 text-gray-200 text-sm px-3 py-2 rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono">
                        <button onclick="copyResetLink()"
                                class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition-colors flex items-center gap-2">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"></path>
                            </svg>
                            Copy
                        </button>
                    </div>
                </div>

                <div class="bg-blue-900 bg-opacity-30 border border-blue-700 rounded-lg p-4">
                    <h4 class="text-blue-300 font-semibold text-sm mb-2 flex items-center gap-2">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                        </svg>
                        Instructions:
                    </h4>
                    <ul class="text-blue-200 text-sm space-y-1 list-disc list-inside">
                        <li>Copy this link and send it to the user via secure communication</li>
                        <li>The user will click this link to set their password</li>
                        <li>This link will expire after being used once</li>
                        <li>The user's email is: <strong>${email}</strong></li>
                    </ul>
                </div>
            </div>

            <div class="mt-6 flex justify-end">
                <button onclick="this.closest('.fixed').remove()"
                        class="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors">
                    Close
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Add copy function to window for onclick handler
    window.copyResetLink = function() {
        const input = document.getElementById('reset-link-input');
        input.select();
        document.execCommand('copy');
        showNotification('Copied!', 'Password reset link copied to clipboard', 'success');
    };
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
    const isTeamLeader = document.getElementById('create-user-is-team-leader').checked;
    const sendEmail = document.getElementById('create-user-send-email').checked;

    // Validate email format (basic validation)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        showNotification('Invalid Email', 'Please provide a valid email address', 'error');
        return;
    }

    // Validate team leader must have a team assigned
    if (isTeamLeader && !teamId) {
        showNotification('Team Required', 'Team leaders must be assigned to a team', 'error');
        return;
    }

    // Extract username from email
    const username = email.split('@')[0];

    // Generate display name if empty
    const finalDisplayName = displayName || username;

    try {
        console.log('[UserManagement] Creating user:', email);

        // Get auth token
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        // Call Edge Function
        const response = await fetch(`${SUPABASE_URL_EXPORT}/functions/v1/admin-create-user`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email,
                displayName: finalDisplayName,
                teamId: teamId || null,
                isTeamLeader,
                sendEmail
            })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to create user');
        }

        // Close create modal first
        closeCreateUserModal();

        // If password reset link was generated, show it in a modal
        if (result.passwordResetLink) {
            showPasswordResetLinkModal(email, result.passwordResetLink);
        } else {
            showNotification('Success', `User ${email} created successfully`, 'success');
        }

        await loadAllUsers();

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
    const isTeamLeader = document.getElementById('edit-user-is-team-leader').checked;
    const nameColor = document.getElementById('edit-user-name-color').value;

    // Validate team leader must have a team assigned
    if (isTeamLeader && !teamId) {
        showNotification('Team Required', 'Team leaders must be assigned to a team', 'error');
        return;
    }

    try {
        console.log('[UserManagement] Updating user:', userId);

        const updateData = {
            display_name: displayName,
            team_id: teamId,
            is_team_leader: isTeamLeader,
            team_leader_for_team_id: isTeamLeader ? teamId : null,
            name_color: nameColor
        };
        console.log('[UserManagement] Update data:', updateData);

        // Update user_settings
        const { data, error: settingsError } = await _supabase
            .from('user_settings')
            .update(updateData)
            .eq('user_id', userId)
            .select();

        console.log('[UserManagement] Update result:', { data, error: settingsError });

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
        console.log('[UserManagement] Blocking user:', username, 'with ID:', userId);

        // Get current admin user
        const { data: { user: currentUser } } = await _supabase.auth.getUser();
        console.log('[UserManagement] Current admin user:', currentUser.id);

        const updateData = {
            is_blocked: true,
            blocked_at: new Date().toISOString(),
            blocked_by: currentUser.id,
            blocked_reason: reason
        };
        console.log('[UserManagement] Update data:', updateData);

        // Update user_settings
        const { data, error } = await _supabase
            .from('user_settings')
            .update(updateData)
            .eq('user_id', userId)
            .select();

        console.log('[UserManagement] Update result:', { data, error });

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

        // Get auth token
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) {
            throw new Error('Not authenticated');
        }

        // Call Edge Function for hard delete
        const response = await fetch(`${SUPABASE_URL_EXPORT}/functions/v1/admin-delete-user`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId,
                hardDelete: true  // Hard delete (permanently remove)
            })
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to delete user');
        }

        showNotification('Success', result.message || 'User deleted successfully', 'success');
        closeDeleteUserModal();
        await loadAllUsers();

    } catch (err) {
        console.error('[UserManagement] Error deleting user:', err);
        showNotification('Error', err.message, 'error');
    }
}

// ============================================
// SET PASSWORD
// ============================================

function openSetPasswordModal(userId, displayName) {
    // Remove existing modal if any
    document.getElementById('set-password-modal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'set-password-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50';
    modal.innerHTML = `
        <div class="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl border border-gray-700">
            <div class="flex items-center justify-between mb-4">
                <h3 class="text-lg font-bold text-white flex items-center gap-2">
                    <svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"></path>
                    </svg>
                    Set Password for ${displayName}
                </h3>
                <button onclick="document.getElementById('set-password-modal').remove()" class="text-gray-400 hover:text-white">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                    </svg>
                </button>
            </div>
            <div class="space-y-4">
                <div>
                    <label class="block text-sm font-medium text-gray-300 mb-1">New Password</label>
                    <input type="password" id="set-password-input" minlength="6" placeholder="Min 6 characters"
                           class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-500">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-300 mb-1">Confirm Password</label>
                    <input type="password" id="set-password-confirm" minlength="6" placeholder="Repeat password"
                           class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-purple-500">
                </div>
                <div id="set-password-error" class="hidden text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded px-3 py-2"></div>
            </div>
            <div class="mt-6 flex justify-end gap-3">
                <button onclick="document.getElementById('set-password-modal').remove()"
                        class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                    Cancel
                </button>
                <button onclick="userManagement.submitSetPassword('${userId}')"
                        class="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors">
                    Set Password
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

async function submitSetPassword(userId) {
    const password = document.getElementById('set-password-input').value;
    const confirm = document.getElementById('set-password-confirm').value;
    const errorEl = document.getElementById('set-password-error');

    const showErr = (msg) => {
        errorEl.textContent = msg;
        errorEl.classList.remove('hidden');
    };

    if (password.length < 6) return showErr('Password must be at least 6 characters.');
    if (password !== confirm) return showErr('Passwords do not match.');

    errorEl.classList.add('hidden');

    try {
        const { data: { session } } = await _supabase.auth.getSession();
        if (!session) throw new Error('Not authenticated');

        const response = await fetch(`${SUPABASE_URL_EXPORT}/functions/v1/admin-set-password`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${session.access_token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ targetUserId: userId, newPassword: password })
        });

        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.error || 'Failed to set password');

        document.getElementById('set-password-modal').remove();
        showNotification('Password Updated', 'Password has been set successfully.', 'success');

    } catch (err) {
        showErr(err.message);
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
    unblockUser,
    openSetPasswordModal,
    submitSetPassword
};
