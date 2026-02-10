// Team Management Module
import { _supabase } from '../../js/config.js';
import { showNotification, adminState } from './admin-main.js';

const teamsState = {
    allTeams: [],
    filteredTeams: [],
    allUsers: []
};

/**
 * Initialize team management — called once on admin panel load
 */
export async function initTeamManagement() {
    console.log('[TeamsManagement] Initializing...');
    setupTeamEventListeners();
    console.log('[TeamsManagement] Initialized');
}

/**
 * Load all teams — called when Teams section is opened
 */
export async function loadAllTeams() {
    console.log('[TeamsManagement] Loading teams...');

    try {
        // Load teams and users in parallel
        const [teamsResult, usersResult] = await Promise.all([
            _supabase
                .from('teams')
                .select('id, name, description, is_active, created_at, team_lead_id')
                .order('name'),
            _supabase
                .from('user_settings')
                .select('user_id, display_name, system_username, team_id, is_team_leader')
        ]);

        if (teamsResult.error) throw teamsResult.error;

        teamsState.allUsers = usersResult.data || [];

        // Build teams with computed member count, leader info, and members list
        teamsState.allTeams = (teamsResult.data || []).map(team => {
            const members = teamsState.allUsers.filter(u => u.team_id === team.id);
            const leader = teamsState.allUsers.find(u => u.user_id === team.team_lead_id);
            return {
                ...team,
                member_count: members.length,
                leader_name: leader ? (leader.display_name || leader.system_username) : null,
                members
            };
        });

        applyTeamFilters();
        populateLeaderDropdown('create-team-leader');

    } catch (err) {
        console.error('[TeamsManagement] Error loading teams:', err);
        showNotification('Error', 'Failed to load teams', 'error');
    }
}

/**
 * Apply search and status filters
 */
function applyTeamFilters() {
    const searchTerm = document.getElementById('team-search-input')?.value.toLowerCase() || '';
    const statusValue = document.getElementById('team-status-filter')?.value || 'active';

    teamsState.filteredTeams = teamsState.allTeams.filter(team => {
        const matchesSearch = !searchTerm || team.name.toLowerCase().includes(searchTerm);
        const matchesStatus =
            statusValue === 'all' ||
            (statusValue === 'active' && team.is_active) ||
            (statusValue === 'inactive' && !team.is_active);
        return matchesSearch && matchesStatus;
    });

    renderTeamsTable();
}

/**
 * Render the teams table
 */
function renderTeamsTable() {
    const tbody = document.getElementById('teams-table-body');
    const emptyState = document.getElementById('teams-empty-state');
    const teamCount = document.getElementById('team-count');

    if (!tbody) return;

    if (teamCount) teamCount.textContent = teamsState.filteredTeams.length;

    if (teamsState.filteredTeams.length === 0) {
        tbody.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    tbody.innerHTML = teamsState.filteredTeams.map(team => `
        <tr class="hover:bg-gray-700/30 transition-colors">

            <!-- Team Name & Description -->
            <td class="p-3">
                <div>
                    <p class="text-white font-medium">${escapeHtml(team.name)}</p>
                    ${team.description
                        ? `<p class="text-xs text-gray-400 mt-0.5">${escapeHtml(team.description)}</p>`
                        : ''}
                </div>
            </td>

            <!-- Team Leader -->
            <td class="p-3">
                ${team.leader_name
                    ? `<span class="text-purple-300 text-sm font-medium">${escapeHtml(team.leader_name)}</span>`
                    : '<span class="text-gray-500 text-sm italic">No leader assigned</span>'
                }
            </td>

            <!-- Member Count -->
            <td class="p-3 text-center">
                <span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold bg-blue-500/20 text-blue-300">
                    ${team.member_count} member${team.member_count !== 1 ? 's' : ''}
                </span>
            </td>

            <!-- Status -->
            <td class="p-3 text-center">
                ${team.is_active
                    ? '<span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-green-500/20 text-green-400">Active</span>'
                    : '<span class="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-gray-500/20 text-gray-400">Inactive</span>'
                }
            </td>

            <!-- Actions -->
            <td class="p-3">
                <div class="flex items-center justify-center gap-2">
                    <!-- View Members -->
                    <button onclick="adminTeams.openViewMembersModal('${team.id}')"
                        class="p-2 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                        title="View Members">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path>
                        </svg>
                    </button>
                    <!-- Edit -->
                    <button onclick="adminTeams.openEditTeamModal('${team.id}')"
                        class="p-2 text-yellow-400 hover:text-yellow-300 hover:bg-yellow-500/10 rounded transition-colors"
                        title="Edit Team">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>
                        </svg>
                    </button>
                    <!-- Deactivate / Reactivate -->
                    ${team.is_active
                        ? `<button onclick="adminTeams.deactivateTeam('${team.id}')"
                                class="p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                                title="Deactivate Team">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path>
                                </svg>
                           </button>`
                        : `<button onclick="adminTeams.reactivateTeam('${team.id}')"
                                class="p-2 text-green-400 hover:text-green-300 hover:bg-green-500/10 rounded transition-colors"
                                title="Reactivate Team">
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                                </svg>
                           </button>`
                    }
                </div>
            </td>
        </tr>
    `).join('');
}

// ============================================
// MODAL FUNCTIONS
// ============================================

export function openCreateTeamModal() {
    const form = document.getElementById('create-team-form');
    form.reset();
    populateLeaderDropdown('create-team-leader');
    showModal('create-team-modal');
}

export function closeCreateTeamModal() {
    hideModal('create-team-modal');
}

export function openEditTeamModal(teamId) {
    const team = teamsState.allTeams.find(t => t.id === teamId);
    if (!team) return;

    document.getElementById('edit-team-id').value = team.id;
    document.getElementById('edit-team-name').value = team.name;
    document.getElementById('edit-team-description').value = team.description || '';

    // Populate leader dropdown with all users, pre-select current leader
    populateLeaderDropdown('edit-team-leader', team.team_lead_id);

    showModal('edit-team-modal');
}

export function closeEditTeamModal() {
    hideModal('edit-team-modal');
}

export function openViewMembersModal(teamId) {
    const team = teamsState.allTeams.find(t => t.id === teamId);
    if (!team) return;

    document.getElementById('view-members-team-name').textContent = team.name;

    const container = document.getElementById('view-members-list');

    if (team.members.length === 0) {
        container.innerHTML = `
            <div class="text-center py-8">
                <svg class="w-12 h-12 mx-auto mb-3 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"></path>
                </svg>
                <p class="text-gray-400">No members assigned to this team yet.</p>
                <p class="text-gray-500 text-sm mt-1">Add users from the Users section and assign them to this team.</p>
            </div>`;
    } else {
        container.innerHTML = team.members.map(member => {
            const isLeader = member.user_id === team.team_lead_id;
            return `
                <div class="flex items-center gap-3 p-3 rounded-lg bg-gray-700/30 border border-gray-600/30">
                    <div class="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                        ${getInitials(member.display_name || member.system_username)}
                    </div>
                    <div class="flex-1 min-w-0">
                        <p class="text-white text-sm font-medium truncate">${escapeHtml(member.display_name || member.system_username)}</p>
                        <p class="text-gray-400 text-xs truncate">${escapeHtml(member.system_username)}</p>
                    </div>
                    <div class="flex-shrink-0">
                        ${isLeader
                            ? '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-purple-500/20 text-purple-300">Leader</span>'
                            : '<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-600/40 text-gray-400">Member</span>'
                        }
                    </div>
                </div>`;
        }).join('');
    }

    showModal('view-members-modal');
}

export function closeViewMembersModal() {
    hideModal('view-members-modal');
}

// ============================================
// CRUD OPERATIONS
// ============================================

async function handleCreateTeam(e) {
    e.preventDefault();

    const name = document.getElementById('create-team-name').value.trim();
    const description = document.getElementById('create-team-description').value.trim();
    const leaderId = document.getElementById('create-team-leader').value || null;

    if (!name) {
        showNotification('Error', 'Team name is required', 'error');
        return;
    }

    const submitBtn = e.target.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Creating...';

    try {
        const { data: { user } } = await _supabase.auth.getUser();

        const { data: team, error } = await _supabase
            .from('teams')
            .insert({
                name,
                description: description || null,
                team_lead_id: leaderId || null,
                is_active: true,
                created_by: user.id,
                created_at: new Date().toISOString()
            })
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                showNotification('Error', `A team named "${name}" already exists`, 'error');
            } else {
                throw error;
            }
            return;
        }

        // If a leader was selected, grant them team leader access
        if (leaderId) {
            await _supabase
                .from('user_settings')
                .update({
                    is_team_leader: true,
                    team_leader_for_team_id: team.id,
                    team_id: team.id
                })
                .eq('user_id', leaderId);
        }

        showNotification('Success', `Team "${name}" created successfully`, 'success');
        closeCreateTeamModal();
        await loadAllTeams();

    } catch (err) {
        console.error('[TeamsManagement] Error creating team:', err);
        showNotification('Error', err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Team';
    }
}

async function handleEditTeam(e) {
    e.preventDefault();

    const teamId = document.getElementById('edit-team-id').value;
    const name = document.getElementById('edit-team-name').value.trim();
    const description = document.getElementById('edit-team-description').value.trim();
    const newLeaderId = document.getElementById('edit-team-leader').value || null;

    const team = teamsState.allTeams.find(t => t.id === teamId);
    if (!team) return;

    const previousLeaderId = team.team_lead_id;

    const submitBtn = e.target.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving...';

    try {
        const { error } = await _supabase
            .from('teams')
            .update({
                name,
                description: description || null,
                team_lead_id: newLeaderId
            })
            .eq('id', teamId);

        if (error) {
            if (error.code === '23505') {
                showNotification('Error', `A team named "${name}" already exists`, 'error');
            } else {
                throw error;
            }
            return;
        }

        // Handle leader change — remove old, assign new
        if (previousLeaderId !== newLeaderId) {
            if (previousLeaderId) {
                await _supabase
                    .from('user_settings')
                    .update({ is_team_leader: false, team_leader_for_team_id: null })
                    .eq('user_id', previousLeaderId);
            }
            if (newLeaderId) {
                await _supabase
                    .from('user_settings')
                    .update({
                        is_team_leader: true,
                        team_leader_for_team_id: teamId,
                        team_id: teamId
                    })
                    .eq('user_id', newLeaderId);
            }
        }

        showNotification('Success', `Team "${name}" updated successfully`, 'success');
        closeEditTeamModal();
        await loadAllTeams();

    } catch (err) {
        console.error('[TeamsManagement] Error editing team:', err);
        showNotification('Error', err.message, 'error');
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Save Changes';
    }
}

export async function deactivateTeam(teamId) {
    const team = teamsState.allTeams.find(t => t.id === teamId);
    if (!team) return;

    if (!confirm(`Deactivate team "${team.name}"?\n\nThe team and its members will still exist but the team will be hidden from new user assignments.`)) {
        return;
    }

    try {
        const { error } = await _supabase
            .from('teams')
            .update({ is_active: false })
            .eq('id', teamId);

        if (error) throw error;

        showNotification('Success', `Team "${team.name}" deactivated`, 'success');
        await loadAllTeams();

    } catch (err) {
        console.error('[TeamsManagement] Error deactivating team:', err);
        showNotification('Error', err.message, 'error');
    }
}

export async function reactivateTeam(teamId) {
    const team = teamsState.allTeams.find(t => t.id === teamId);
    if (!team) return;

    try {
        const { error } = await _supabase
            .from('teams')
            .update({ is_active: true })
            .eq('id', teamId);

        if (error) throw error;

        showNotification('Success', `Team "${team.name}" reactivated`, 'success');
        await loadAllTeams();

    } catch (err) {
        console.error('[TeamsManagement] Error reactivating team:', err);
        showNotification('Error', err.message, 'error');
    }
}

// ============================================
// HELPERS
// ============================================

/**
 * Populate a leader <select> dropdown with all users
 */
function populateLeaderDropdown(selectId, selectedUserId = null) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = '<option value="">No leader (assign later)</option>' +
        teamsState.allUsers
            .sort((a, b) => (a.display_name || a.system_username).localeCompare(b.display_name || b.system_username))
            .map(u => {
                const label = escapeHtml(u.display_name || u.system_username);
                const selected = u.user_id === selectedUserId ? 'selected' : '';
                return `<option value="${u.user_id}" ${selected}>${label}</option>`;
            }).join('');
}

function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showModal(id) {
    const modal = document.getElementById(id);
    if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
}

function hideModal(id) {
    const modal = document.getElementById(id);
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

// ============================================
// EVENT LISTENERS
// ============================================

function setupTeamEventListeners() {
    document.getElementById('team-search-input')?.addEventListener('input', applyTeamFilters);
    document.getElementById('team-status-filter')?.addEventListener('change', applyTeamFilters);
    document.getElementById('create-team-form')?.addEventListener('submit', handleCreateTeam);
    document.getElementById('edit-team-form')?.addEventListener('submit', handleEditTeam);

    // Close modals on backdrop click
    ['create-team-modal', 'edit-team-modal', 'view-members-modal'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', e => {
            if (e.target.id === id) hideModal(id);
        });
    });
}

// ============================================
// EXPOSE TO WINDOW (for onclick handlers in HTML)
// ============================================

window.adminTeams = {
    openCreateTeamModal,
    closeCreateTeamModal,
    openEditTeamModal,
    closeEditTeamModal,
    openViewMembersModal,
    closeViewMembersModal,
    deactivateTeam,
    reactivateTeam
};
