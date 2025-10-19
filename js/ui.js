// js/ui.js

import { appState } from './state.js';
import { _supabase } from './config.js';
import * as tickets from './tickets.js';


let confirmCallback = null;

// --- UTILITY FUNCTIONS ---
const USER_COLORS = [
    { bg: 'bg-slate-500/30', text: 'text-slate-300' }, { bg: 'bg-gray-500/30', text: 'text-gray-300' }, { bg: 'bg-zinc-500/30', text: 'text-zinc-300' },
    { bg: 'bg-neutral-500/30', text: 'text-neutral-300' }, { bg: 'bg-stone-500/30', text: 'text-stone-300' }, { bg: 'bg-red-500/30', text: 'text-red-300' },
    { bg: 'bg-orange-500/30', text: 'text-orange-300' }, { bg: 'bg-amber-500/30', text: 'text-amber-300' }, { bg: 'bg-yellow-500/30', text: 'text-yellow-300' },
    { bg: 'bg-lime-500/30', text: 'text-lime-300' }, { bg: 'bg-green-500/30', text: 'text-green-300' }, { bg: 'bg-emerald-500/30', text: 'text-emerald-300' },
    { bg: 'bg-teal-500/30', text: 'text-teal-300' }, { bg: 'bg-cyan-500/30', text: 'text-cyan-300' }, { bg: 'bg-sky-500/30', text: 'text-sky-300' },
    { bg: 'bg-blue-500/30', text: 'text-blue-300' }, { bg: 'bg-indigo-500/30', text: 'text-indigo-300' }, { bg: 'bg-violet-500/30', text: 'text-violet-300' },
    { bg: 'bg-purple-500/30', text: 'text-purple-300' }, { bg: 'bg-fuchsia-500/30', text: 'text-fuchsia-300' }, { bg: 'bg-pink-500/30', text: 'text-pink-300' },
    { bg: 'bg-rose-500/30', text: 'text-rose-300' }
];

export function getUserColor(username) {
    let hash = 0;
    if (!username) return USER_COLORS[0];
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return USER_COLORS[Math.abs(hash % USER_COLORS.length)];
}

export async function switchView(viewName, clickedButton) {
    appState.currentView = viewName;
    const indicator = document.getElementById('tab-indicator');
    const tabs = document.querySelectorAll('.tab-btn');

    tabs.forEach(tab => {
        tab.classList.remove('text-white');
        tab.classList.add('text-gray-400');
    });

    if (clickedButton) {
        clickedButton.classList.remove('text-gray-400');
        clickedButton.classList.add('text-white');

        indicator.style.left = `${clickedButton.offsetLeft}px`;
        indicator.style.width = `${clickedButton.offsetWidth}px`;
        const colors = { dashboard: 'bg-indigo-600', tickets: 'bg-amber-600', done: 'bg-green-600', 'follow-up': 'bg-slate-600' };
        indicator.className = `absolute top-0 bottom-0 h-full rounded-md transition-all duration-300 ease-in-out ${colors[viewName]}`;
    }

    const views = { dashboard: 'dashboard-view', tickets: 'tickets-view', done: 'done-view', 'follow-up': 'follow-up-view' };
    Object.values(views).forEach(v => {
        const viewEl = document.getElementById(v);
        if (viewEl) viewEl.classList.add('hidden');
    });

    const currentViewEl = document.getElementById(views[viewName]);
    if (currentViewEl) currentViewEl.classList.remove('hidden');

    const filterBar = document.getElementById('tickets-filter-bar');
    if (filterBar) {
        filterBar.style.display = 'none';
    }

    if (['tickets', 'done', 'follow-up'].includes(viewName)) {
        if (viewName === 'follow-up') {
            document.getElementById('follow-up-dot').classList.add('hidden');
            _supabase.auth.updateUser({ data: { last_followup_view: new Date().toISOString() } });
        }
        if (filterBar) {
            filterBar.style.display = 'block';
        }
        await window.main.applyFilters();
    } else if (viewName === 'dashboard') {
        await window.main.renderDashboard();
        await window.main.renderStats();
    }
}

// --- NOTIFICATIONS ---
export function showNotification(title, body, type = 'info', createSystemNotification = true) {
    const panel = document.getElementById('notification-panel');
    if (!panel) return;
    const id = `notif-${Date.now()}`;
    const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-indigo-500' };
    const notification = document.createElement('div');
    notification.id = id;
    notification.className = `notification w-full p-4 rounded-lg shadow-lg text-white ${colors[type]} glassmorphism`;
    notification.innerHTML = `<p class="font-bold">${title}</p><p class="text-sm">${body}</p>`;
    panel.appendChild(notification);
    setTimeout(() => { notification.classList.add('show'); }, 10);
    setTimeout(() => { notification.classList.remove('show'); setTimeout(() => notification.remove(), 500); }, 5000);
    if (Notification.permission === 'granted' && createSystemNotification) { new Notification(title, { body }); }
}

export function playSoundAlert() {
    console.log("Audio alert would play here.");
}

// --- LOADERS ---
export function showLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('hidden');
}

export function hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.add('hidden');
}

// js/ui.js

export function openEditModal(id) {
    const ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === id);
    if (!ticket) return;

    document.getElementById('edit-ticket-id').value = id;
    document.getElementById('edit-subject').value = ticket.subject;
    document.getElementById('edit-status').value = ticket.status;
    document.getElementById('edit-priority').value = ticket.priority || 'Medium';
    
    // Correctly handle the multi-select tag element
    const tagsSelect = document.getElementById('edit-tags');
    const ticketTags = ticket.tags || [];

    // Use a standard for loop for compatibility to select the ticket's current tags
    for (let i = 0; i < tagsSelect.options.length; i++) {
        const option = tagsSelect.options[i];
        option.selected = ticketTags.includes(option.value);
    }

    const complexityContainer = document.getElementById('complexity-container');
    if (appState.currentUserRole === 'admin') {
        document.getElementById('edit-complexity').value = ticket.complexity || 1;
        complexityContainer.classList.remove('hidden');
    } else {
        complexityContainer.classList.add('hidden');
    }
    
    openModal('edit-modal');
}



// ========== RELATIONSHIP MODAL ==========
export function closeRelationshipModal() {
    const modal = document.getElementById('relationship-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
        }, 300);
    }
}

// ========== pinned TICKETS TAB ==========

export async function openPinnedTicketsView() {
    appState.currentView = 'pinned';
    
    const views = {
        dashboard: 'dashboard-view',
        tickets: 'tickets-view',
        done: 'done-view',
        'follow-up': 'follow-up-view',
        pinned: 'pinned-view'
    };
    
    Object.values(views).forEach(v => {
        const viewEl = document.getElementById(v);
        if (viewEl) viewEl.classList.add('hidden');
    });

    const pinnedView = document.getElementById('pinned-view');
    if (pinnedView) {
        pinnedView.classList.remove('hidden');
    }

    // Fetch and display pinned tickets
    const pinnedIds = await tickets.fetchUserPinnedTickets();
    
    const pinnedList = document.getElementById('pinned-ticket-list');
    if (!pinnedList) return;

    pinnedList.innerHTML = '';

    if (pinnedIds.length === 0) {
        pinnedList.innerHTML = '<div class="text-center text-gray-400 mt-8">No pinned tickets yet. Click the pin icon on any ticket to add it here.</div>';
        return;
    }

    try {
        // Fetch full ticket data
        const { data: pinnedTickets, error } = await _supabase
            .from('tickets')
            .select('*')
            .in('id', pinnedIds)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        if (!pinnedTickets || pinnedTickets.length === 0) {
            pinnedList.innerHTML = '<div class="text-center text-gray-400 mt-8">No pinned tickets found.</div>';
            return;
        }

        for (const ticket of pinnedTickets) {
            const ticketElement = await tickets.createTicketElement(ticket);
            pinnedList.appendChild(ticketElement);
        }
    } catch (err) {
        console.error('Error fetching pinned tickets:', err);
        pinnedList.innerHTML = '<div class="text-center text-red-400 mt-8">Error loading pinned tickets</div>';
    }
}

// Make openModal available as a public function
export function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove('hidden');
    setTimeout(() => modal.classList.remove('opacity-0'), 10);
}

export function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('opacity-0');
    setTimeout(() => modal.classList.add('hidden'), 300);
}



export function closeEditModal() { closeModal('edit-modal'); }

export function openConfirmModal(title, message, callback) {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    confirmCallback = callback;
    openModal('confirm-modal');
    const confirmBtn = document.getElementById('confirm-btn');
    confirmBtn.onclick = () => {
        if (confirmCallback) confirmCallback();
        closeConfirmModal();
    };
}
export function closeConfirmModal() {
    closeModal('confirm-modal');
    confirmCallback = null;
}

export function openNewPasswordModal() { openModal('new-password-modal'); }
export function closeNewPasswordModal() { closeModal('new-password-modal'); }

export function openAdminModal() { openModal('admin-panel-modal'); }
export function closeAdminModal() { closeModal('admin-panel-modal'); }

export function openScheduleModal() {
    openModal('schedule-modal');
    document.getElementById('schedule-date-picker').value = new Date().toISOString().split('T')[0];
    window.schedule.fetchSchedule();
    window.schedule.highlightOverriddenDates();
    if (appState.currentUserRole === 'admin') {
        document.getElementById('admin-schedule-buttons').classList.remove('hidden');
    }
    const scheduleBtn = document.getElementById('schedule-btn');
    scheduleBtn.classList.remove('glowing-pulse');
    document.getElementById('schedule-dot').classList.add('hidden');
    _supabase.auth.updateUser({ data: { last_schedule_view: new Date().toISOString() } });
}
export function closeScheduleModal() {
    closeModal('schedule-modal');
    window.schedule.toggleScheduleEdit(false);
}

export function openDefaultScheduleModal() {
    openModal('default-schedule-modal');
    window.schedule.switchDayTab(document.querySelector('.tab-button[data-day="1"]'), 1);
}
export function closeDefaultScheduleModal() { closeModal('default-schedule-modal'); }

export function openCompletedItemsModal() {
    openModal('completed-items-modal');
    window.schedule.fetchCompletedItems();
}
export function closeCompletedItemsModal() { closeModal('completed-items-modal'); }

export function openEditScheduleItemModal(itemId) {
    const itemToEdit = appState.deploymentNotes.find(note => note.id === itemId);
    if (!itemToEdit) return;
    document.getElementById('edit-item-id').value = itemToEdit.id;
    document.getElementById('edit-item-text').value = itemToEdit.note_text;
    document.getElementById('edit-item-type').value = itemToEdit.type;
    document.getElementById('edit-item-date').value = itemToEdit.deployment_date;
    document.getElementById('edit-item-time').value = itemToEdit.deployment_time;
    openModal('edit-schedule-item-modal');
}
export function closeEditScheduleItemModal() { closeModal('edit-schedule-item-modal'); }

export function openPerformanceModal() {
    openModal('performance-modal');
    window.main.renderPerformanceAnalytics();
}
export function closePerformanceModal() { closeModal('performance-modal'); }

export function openHistoryModal() {
    openModal('history-modal');
    window.main.renderLeaderboardHistory();
}
export function closeHistoryModal() { closeModal('history-modal'); }

export function openImageViewer(imageUrl) {
    const modal = document.getElementById('image-viewer-modal');
    const img = document.getElementById('full-image-view');  // <- CORRECT ID
    if (modal && img) {
        img.src = imageUrl;
        openModal('image-viewer-modal');
    }
}

export function closeImageViewer() {
    closeModal('image-viewer-modal');
}

export function closeAllModals() {
    ['edit-modal', 'confirm-modal', 'schedule-modal', 'default-schedule-modal', 'admin-panel-modal', 'completed-items-modal', 'edit-schedule-item-modal', 'performance-modal', 'history-modal', 'new-password-modal', 'image-viewer-modal'].forEach(closeModal);
    toggleActivityLog(true);
}


// --- UI TOGGLES & HELPERS ---

export function toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('-translate-x-full');
    document.getElementById('sidebar-backdrop')?.classList.toggle('hidden');
}

export function toggleRightSidebar() {
    document.getElementById('on-leave-sidebar')?.classList.toggle('translate-x-full');
    document.getElementById('right-sidebar-backdrop')?.classList.toggle('hidden');
}

export function toggleTicketCollapse(ticketId) {
    const ticket = document.getElementById(`ticket-${ticketId}`);
    if (!ticket) return;

    const body = ticket.querySelector('.ticket-body');
    const icon = ticket.querySelector('.ticket-collapse-btn svg');

    if (body && icon) {
        const isExpanding = body.classList.contains('hidden');

        if (isExpanding) {
            // Mark as "read" when expanding
            const ticketData = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === ticketId);
            if (ticketData) {
                appState.seenTickets[ticketId] = ticketData.updated_at;
                localStorage.setItem('seenTickets', JSON.stringify(appState.seenTickets));
                
                // Remove the red dot
                const redDot = ticket.querySelector(`#unread-note-dot-${ticketId}`);
                if (redDot) {
                    redDot.classList.add('hidden');
                }
            }
        }

        body.classList.toggle('hidden');
        icon.classList.toggle('rotate-180');
    }
}


export function toggleItemForm() {
    const form = document.getElementById('deployment-form');
    const btn = document.getElementById('add-deployment-btn');
    if (!form || !btn) return;
    if (form.classList.toggle('hidden')) {
        btn.textContent = 'Add ➕';
        btn.classList.remove('bg-red-600', 'hover:bg-red-700');
        btn.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        document.getElementById('deployment-note-text').value = '';
        document.getElementById('deployment-date').value = '';
        document.getElementById('deployment-time').value = '';
    } else {
        btn.textContent = 'Cancel ❌';
        btn.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');
        btn.classList.add('bg-red-600', 'hover:bg-red-700');
        document.getElementById('deployment-date').value = new Date().toISOString().split('T')[0];
    }
}

export function updateCharCounter(inputId, counterId, maxLength) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(counterId);
    if (!input || !counter) return;
    const remaining = maxLength - input.value.length;
    counter.textContent = `${remaining} characters remaining`;
    counter.classList.toggle('warning', remaining <= 50 && remaining > 20);
    counter.classList.toggle('danger', remaining <= 20);
}

export function formatTime(timeString) {
    if (!timeString) return '';
    const [hour, minute] = timeString.split(':');
    let h = parseInt(hour, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${minute.padStart(2, '0')} ${ampm}`;
}

export function formatSeconds(seconds) {
    if (seconds === 0) return '0m';
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return `${h > 0 ? h + 'h ' : ''}${m}m`;
}

export function toggleCustomDaysInput() {
    const statsPeriod = document.getElementById('stats-period');
    const customDaysInput = document.getElementById('custom-days-input');
    if (statsPeriod.value === 'custom') {
        customDaysInput.classList.remove('hidden');
        customDaysInput.focus();
    } else {
        customDaysInput.classList.add('hidden');
        window.main.applyFilters();
    }
}

// --- BROADCAST MESSAGES ---
export async function fetchBroadcastMessage() {
    try {
        const { data, error } = await _supabase.from('broadcast_messages').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1).single();
        if (error && error.code !== 'PGRST116') throw error;
        const container = document.getElementById('broadcast-message-container');
        if (!container) return;
        if (data) {
            const dismissedId = sessionStorage.getItem('dismissedBroadcastId');
            if (dismissedId === data.id.toString()) {
                container.classList.add('hidden');
                return;
            }
            document.getElementById('broadcast-message-text').textContent = data.message;
            container.dataset.id = data.id;
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
        }
    } catch (err) {
        console.error("Error fetching broadcast:", err);
    }
}

export function dismissBroadcast() {
    const container = document.getElementById('broadcast-message-container');
    if (!container) return;
    const messageId = container.dataset.id;
    if (messageId) {
        sessionStorage.setItem('dismissedBroadcastId', messageId);
    }
    container.classList.add('hidden');
}

// --- ACTIVITY LOG ---
export async function toggleActivityLog(forceClose = false) {
    const log = document.getElementById('activity-log');
    if (!log) return;
    if (forceClose) {
        log.classList.add('hidden');
        return;
    }
    log.classList.toggle('hidden');
    if (!log.classList.contains('hidden')) {
        document.getElementById('activity-dot').classList.add('hidden');
        fetchActivities();
        setTimeout(async () => {
            try {
                await _supabase.auth.updateUser({ data: { last_activity_view: new Date().toISOString() } });
                await fetchActivities();
            } catch (err) {
                console.error('Error marking activities as read:', err);
            }
        }, 3000);
    }
}

async function fetchActivities() {
    try {
        const { data: { user } } = await _supabase.auth.getUser();
        if (!user) return;
        const lastActivityView = user.user_metadata.last_activity_view || '1970-01-01T00:00:00.000Z';
        const { data, error } = await _supabase
            .from('activity_log')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);
        
        if (error) throw error;
        
        const list = document.getElementById('activity-list');
        if (!list) return;

        if (!data || data.length === 0) {
            list.innerHTML = `
                <div class="text-center text-gray-400 py-8">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <p class="text-sm">No recent activity</p>
                </div>
            `;
            return;
        }

        list.innerHTML = data.map(activity => {
            const isUnread = new Date(activity.created_at) > new Date(lastActivityView) && activity.user_id !== appState.currentUser.id;
            const activityIcon = getActivityIcon(activity.activity_type);
            const activityColor = getActivityColor(activity.activity_type);
            
            return `
                <div class="activity-item ${isUnread ? 'unread-activity' : ''}">
                    <div class="flex items-start gap-3">
                        <div class="flex-shrink-0 w-8 h-8 rounded-full ${activityColor.bg} flex items-center justify-center ${activityColor.text}">
                            ${activityIcon}
                        </div>
                        <div class="flex-grow min-w-0">
                            <p class="text-sm">
                                <span class="activity-username">${activity.username}</span>
                                <span class="activity-action"> ${formatActivityAction(activity.activity_type, activity.details)}</span>
                            </p>
                            <p class="activity-time mt-1">${formatTimeAgo(activity.created_at)}</p>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Error fetching activities:', err);
        const list = document.getElementById('activity-list');
        if (list) {
            list.innerHTML = '<div class="text-center text-red-400 py-8">Error loading activities</div>';
        }
    }
}

// Helper function to get activity icon
function getActivityIcon(activityType) {
    const icons = {
        'TICKET_CREATED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" /></svg>',
        'TICKET_EDITED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" /></svg>',
        'STATUS_CHANGED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" /></svg>',
        'NOTE_ADDED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z" clip-rule="evenodd" /></svg>',
        'NOTE_DELETED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>',
        'TICKET_DELETED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>',
        'TICKET_ASSIGNED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" /></svg>',
        'KUDOS_GIVEN': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" /></svg>',
        'SHIFT_START': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" /></svg>',
        'SHIFT_END': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd" /></svg>',
        'SCHEDULE_UPDATED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd" /></svg>',
        'FOLLOWUP_ADDED': '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>'
    };
    return icons[activityType] || '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd" /></svg>';
}



// Time ago helper (if not already in this file)
function formatTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return time.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Helper function to get activity color
function getActivityColor(activityType) {
    const colors = {
        'TICKET_CREATED': { bg: 'bg-green-500/20', text: 'text-green-400' },
        'TICKET_EDITED': { bg: 'bg-blue-500/20', text: 'text-blue-400' },
        'STATUS_CHANGED': { bg: 'bg-purple-500/20', text: 'text-purple-400' },
        'NOTE_ADDED': { bg: 'bg-indigo-500/20', text: 'text-indigo-400' },
        'NOTE_DELETED': { bg: 'bg-orange-500/20', text: 'text-orange-400' },
        'TICKET_DELETED': { bg: 'bg-red-500/20', text: 'text-red-400' },
        'TICKET_ASSIGNED': { bg: 'bg-amber-500/20', text: 'text-amber-400' },
        'KUDOS_GIVEN': { bg: 'bg-pink-500/20', text: 'text-pink-400' },
        'SHIFT_START': { bg: 'bg-teal-500/20', text: 'text-teal-400' },
        'SHIFT_END': { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
        'SCHEDULE_UPDATED': { bg: 'bg-sky-500/20', text: 'text-sky-400' },
        'FOLLOWUP_ADDED': { bg: 'bg-yellow-500/20', text: 'text-yellow-400' }
    };
    return colors[activityType] || { bg: 'bg-gray-500/20', text: 'text-gray-400' };
}

function formatActivityAction(activityType, details) {
    const actions = {
        'TICKET_CREATED': `created ticket "${details?.subject || 'Untitled'}"`,
        'TICKET_EDITED': `edited ticket "${details?.subject || 'Untitled'}"`,
        'STATUS_CHANGED': `changed ticket status to ${details?.status || 'unknown'}`,
        'NOTE_ADDED': 'added a note to a ticket',
        'NOTE_DELETED': 'deleted a note from a ticket',
        'TICKET_DELETED': 'deleted a ticket',
        'TICKET_ASSIGNED': 'took assignment of a ticket',
        'KUDOS_GIVEN': `gave kudos to ${details?.receiver || 'someone'}`,
        'SHIFT_START': 'started their shift',
        'SHIFT_END': 'ended their shift',
        'SCHEDULE_UPDATED': `updated the schedule for ${details?.date || 'a date'}`,
        'DEFAULT_SCHEDULE_SAVED': `saved the default schedule for ${details?.day || 'a day'}`,
        'FOLLOWUP_ADDED': 'flagged a ticket for follow-up'
    };
    return actions[activityType] || 'performed an action';
}



export async function checkForUnreadActivities() {
    try {
        const { data: { user } } = await _supabase.auth.getUser();
        if (!user) return;
        const lastActivityView = user.user_metadata.last_activity_view || '1970-01-01T00:00:00.000Z';
        const { count, error } = await _supabase.from('activity_log')
            .select('*', { count: 'exact', head: true })
            .gt('created_at', lastActivityView)
            .neq('user_id', appState.currentUser.id);
        if (error) throw error;
        const activityDot = document.getElementById('activity-dot');
        if (activityDot) {
            activityDot.classList.toggle('hidden', count === 0);
        }
    } catch (err) {
        console.error('Error checking for unread activities:', err);
    }
}

export async function checkForUnreadFollowUps() {
    try {
        const { data: { user } } = await _supabase.auth.getUser();
        if (!user) return;
        const lastFollowUpView = user.user_metadata.last_followup_view || '1970-01-01T00:00:00.000Z';
        const { count, error } = await _supabase.from('tickets')
            .select('*', { count: 'exact', head: true })
            .eq('needs_followup', true)
            .gt('updated_at', lastFollowUpView);
        if (error) throw error;
        const followUpDot = document.getElementById('follow-up-dot');
        if (followUpDot) {
            followUpDot.classList.toggle('hidden', count === 0);
        }
    } catch (err) {
        console.error("Exception checking follow-ups", err);
    }
}

export async function handleActivityLogUpdate(payload) {
    const activity = payload.new;
    const isOriginator = activity.user_id === appState.currentUser.id;
    const isLogOpen = !document.getElementById('activity-log').classList.contains('hidden');
    showNotification(isOriginator ? 'Action Logged' : 'New Team Activity', formatActivity(activity), isOriginator ? 'success' : 'info', !isOriginator);
    if (!isOriginator && !isLogOpen) {
        document.getElementById('activity-dot').classList.remove('hidden');
    }
    if (isLogOpen) {
        await fetchActivities();
    }
}

function formatActivity(log) {
    const { username, activity_type, details } = log;
    const userHtml = `<strong>${username}</strong>`;
    switch (activity_type) {
        case 'KUDOS_GIVEN': return `${userHtml} gave kudos to <strong>${details.receiver}</strong> on a ticket.`;
        case 'TICKET_CREATED': return `${userHtml} created ticket: "${details.subject || ''}"`;
        case 'STATUS_CHANGED': return `${userHtml} set a ticket's status to <strong>${details.status}</strong>`;
        case 'TICKET_ASSIGNED': return `${userHtml} took assignment of a ticket.`;
        case 'TICKET_EDITED': return `${userHtml} edited ticket: "${details.subject || ''}"`;
        case 'NOTE_ADDED': return `${userHtml} added a note to a ticket.`;
        case 'NOTE_DELETED': return `${userHtml} deleted a note from a ticket.`;
        case 'TICKET_DELETED': return `${userHtml} deleted a ticket.`;
        case 'SHIFT_START': return `${userHtml} started their shift.`;
        case 'SHIFT_END': return `${userHtml} ended their shift.`;
        case 'SCHEDULE_UPDATED': return `${userHtml} updated the schedule for <strong>${details.date}</strong>.`;
        case 'DEFAULT_SCHEDULE_SAVED': return `${userHtml} saved the default schedule for <strong>${details.day}</strong>.`;
        case 'FOLLOWUP_ADDED': return `${userHtml} flagged a ticket for follow-up.`;
        default: return `${userHtml} performed an action.`;
    }
}

// --- CHART RENDERING ---
export function renderChart(containerId, chartKey, type, data, title) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `<canvas id="${chartKey}"></canvas>`;
    if (appState.charts[chartKey]) { appState.charts[chartKey].destroy(); }
    const ctx = document.getElementById(chartKey).getContext('2d');
    appState.charts[chartKey] = new Chart(ctx, {
        type,
        data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'top', labels: { color: '#d1d5db' } },
                title: { display: true, text: title, color: '#d1d5db', font: { size: 16 } }
            },
            scales: type === 'bar' ? {
                y: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } },
                x: { ticks: { color: '#9ca3af' }, grid: { color: '#374151' } }
            } : {}
        }
    });
}
