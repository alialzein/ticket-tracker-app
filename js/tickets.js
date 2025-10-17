// js/tickets.js

import { _supabase } from './config.js';
import { appState } from './state.js';
import { showNotification, openEditModal, openConfirmModal, hideLoading, showLoading, getUserColor, closeEditModal } from './ui.js';
import { awardPoints, logActivity } from './main.js';

export const PRIORITY_STYLES = { 'Urgent': { bg: 'bg-red-500', text: 'text-white' }, 'High': { bg: 'bg-orange-500', text: 'text-white' }, 'Medium': { bg: 'bg-yellow-500', text: 'text-gray-900' }, 'Low': { bg: 'bg-green-500', text: 'text-white' } };

// Map to store Quill editor instances for each ticket
const quillInstances = new Map();

// Helper function to handle file uploads to Supabase Storage
async function uploadFile(ticketId, file) {
    if (!file) return null;

    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${appState.currentUser.id}/${ticketId}/${fileName}`;

    const { error: uploadError } = await _supabase.storage
        .from('ticket-attachments')
        .upload(filePath, file);

    if (uploadError) throw uploadError;

    return {
        name: file.name,
        path: filePath,
        uploaded_at: new Date().toISOString()
    };
}


export async function createTicket() {
    const ticketSubjectInput = document.getElementById('ticket-subject');
    const assignToSelect = document.getElementById('assign-to');
    const prioritySelect = document.getElementById('ticket-priority');
    const attachmentInput = document.getElementById('ticket-attachment');

    if (!appState.currentShiftId) {
        return showNotification('Shift Not Started', 'You must start your shift before creating tickets.', 'error');
    }
    const subject = ticketSubjectInput.value.trim();
    const assignToName = assignToSelect.value;
    const priority = prioritySelect.value;
    const file = attachmentInput.files[0];

    if (!subject || !appState.selectedSource) {
        return showNotification('Missing Info', 'Please select a source and enter a subject.', 'error');
    }

    try {
        const { count, error: checkError } = await _supabase
            .from('tickets')
            .select('*', { count: 'exact', head: true })
            .eq('subject', subject)
            .eq('status', 'In Progress');

        if (checkError) throw checkError;

        if (count > 0) {
            showNotification('Duplicate Ticket', 'A ticket with this subject is already in progress.', 'error');
            return;
        }

        showLoading();

        const username = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
        const handled_by = [assignToName || username];

        const ticketData = {
            user_id: appState.currentUser.id,
            username,
            source: appState.selectedSource,
            subject,
            status: 'In Progress',
            assigned_to_name: assignToName || null,
            priority,
            attachments: [],
            handled_by,
            tags: [],
            created_by: appState.currentUser.id,
            assignment_status: assignToName ? 'pending' : null,
            assigned_at: assignToName ? new Date().toISOString() : null
        };

        const { data: newTicket, error } = await _supabase.from('tickets').insert(ticketData).select().single();

        if (error) throw error;

        if (file) {
            const uploadedFile = await uploadFile(newTicket.id, file);
            if (uploadedFile) {
                const { error: updateError } = await _supabase
                    .from('tickets')
                    .update({ attachments: [uploadedFile] })
                    .eq('id', newTicket.id);

                if (updateError) {
                    console.error('Failed to link attachment:', updateError);
                    showNotification('Attachment Warning', 'Ticket created, but failed to link the attachment.', 'error');
                }
            }
        }

        awardPoints('TICKET_OPENED', { ticketId: newTicket.id, priority: priority });
        logActivity('TICKET_CREATED', { ticket_id: newTicket.id, subject: newTicket.subject });

        ticketSubjectInput.value = '';
        assignToSelect.value = '';
        attachmentInput.value = '';
        document.querySelectorAll('.source-btn').forEach(btn => btn.dataset.selected = 'false');
        appState.selectedSource = null;
        const fileLabel = document.getElementById('ticket-attachment-filename');
        if (fileLabel) {
            fileLabel.textContent = 'Attach File';
        }

    } catch (error) {
        showNotification('Error Creating Ticket', error.message, 'error');
    } finally {
        hideLoading();
    }
}

export async function fetchTickets(isNew = false) {
    const searchInput = document.getElementById('search-input');
    const periodSelect = document.getElementById('stats-period');
    if (!searchInput || !periodSelect) {
        setTimeout(() => fetchTickets(isNew), 100);
        return;
    }

    if (isNew) {
        showLoading();
    } else {
        const btnId = appState.currentView === 'done' ? 'load-more-btn-done' : 'load-more-btn';
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.innerHTML = '<div class="loading-spinner w-5 h-5 mx-auto"></div>';
            btn.disabled = true;
        }
    }

    try {
        const isDoneView = appState.currentView === 'done';
        const isFollowUpView = appState.currentView === 'follow-up';
        let pageToFetch = isDoneView ? appState.doneCurrentPage : appState.currentPage;
        if (isNew) pageToFetch = 0;

        const searchTerm = searchInput.value.trim();
        let daysToFilter = parseInt(periodSelect.value);
        if (periodSelect.value === 'custom') {
            daysToFilter = parseInt(document.getElementById('custom-days-input').value) || 0;
        }
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - (daysToFilter - 1));

        let query;
        if (isFollowUpView) {
            query = _supabase.from('tickets').select('*').eq('needs_followup', true);
            query = query.gte('updated_at', startDate.toISOString());
        } else {
            const statusToFetch = isDoneView ? 'Done' : 'In Progress';
            query = _supabase.from('tickets').select('*').eq('status', statusToFetch);
            query = query.gte('updated_at', startDate.toISOString());
        }

        if (searchTerm) query = query.ilike('subject', `%${searchTerm}%`);
        const userFilter = document.getElementById('filter-user').value;
        if (userFilter) query = query.or(`username.eq.${userFilter},assigned_to_name.eq.${userFilter}`);
        const sourceFilter = document.getElementById('filter-source').value;
        if (sourceFilter) query = query.eq('source', sourceFilter);
        const priorityFilter = document.getElementById('filter-priority').value;
        if (priorityFilter) query = query.eq('priority', priorityFilter);
        const tagFilter = document.getElementById('filter-tag').value;
        if (tagFilter) query = query.contains('tags', `["${tagFilter}"]`);

        query = query.order('updated_at', { ascending: false });
        query = query.range(pageToFetch * appState.TICKETS_PER_PAGE, (pageToFetch + 1) * appState.TICKETS_PER_PAGE - 1);

        const { data, error } = await query;
        if (error) throw error;

        if (isFollowUpView) {
            appState.followUpTickets = data || [];
        } else if (data && data.length > 0) {
            if (isDoneView) {
                if (isNew) { appState.doneTickets = data; } else { appState.doneTickets.push(...data); }
                appState.doneCurrentPage++;
                document.getElementById('load-more-btn-done').style.display = (data.length === appState.TICKETS_PER_PAGE) ? 'inline-block' : 'none';
            } else {
                if (isNew) { appState.tickets = data; } else { appState.tickets.push(...data); }
                appState.currentPage++;
                document.getElementById('load-more-btn').style.display = (data.length === appState.TICKETS_PER_PAGE) ? 'inline-block' : 'none';
            }
        } else {
            if (isNew) {
                if (isDoneView) { appState.doneTickets = []; } else { appState.tickets = []; }
            }
            const loadMoreBtnDone = document.getElementById('load-more-btn-done');
            const loadMoreBtn = document.getElementById('load-more-btn');
            if (isDoneView && loadMoreBtnDone) { loadMoreBtnDone.style.display = 'none'; }
            else if (loadMoreBtn) { loadMoreBtn.style.display = 'none'; }
        }

        await renderTickets(isNew);
    } catch (err) {
        console.error('Exception fetching tickets:', err);
    } finally {
        if (isNew) {
            hideLoading();
        } else {
            const btnId = appState.currentView === 'done' ? 'load-more-btn-done' : 'load-more-btn';
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.innerHTML = 'Load More';
                btn.disabled = false;
            }
        }
        checkReminders(appState.currentView === 'done' ? appState.doneTickets : appState.tickets);
    }
}

export function handleTicketToggle(ticketId) {
    const ticket = document.getElementById(`ticket-${ticketId}`);
    if (!ticket) return;

    const body = ticket.querySelector('.ticket-body');
    if (!body) return;

    const isExpanding = body.classList.contains('hidden');
    
    if (isExpanding) {
        // Expanding - set as active ticket
        appState.expandedTicketId = ticketId;
        console.log('Ticket expanded:', ticketId);
        // Start tracking presence
        if (window.tickets && window.tickets.startTrackingTicket) {
            window.tickets.startTrackingTicket(ticketId);
        }
    } else {
        // Collapsing - clear active ticket
        appState.expandedTicketId = null;
        console.log('Ticket collapsed:', ticketId);
        // Stop tracking presence
        if (window.tickets && window.tickets.stopTrackingTicket) {
            window.tickets.stopTrackingTicket(ticketId);
        }
    }

    // Toggle collapse
    if (window.ui && window.ui.toggleTicketCollapse) {
        window.ui.toggleTicketCollapse(ticketId);
    }
}


// ========== FUNCTION 1: createTicketElement ==========
// Modified to accept linkedSubjectsMap
export async function createTicketElement(ticket, linkedSubjectsMap = {}) {
    const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
    const { data: kudosData } = await _supabase.from('kudos').select('*').eq('ticket_id', ticket.id);
    const kudosCounts = new Map();
    const kudosIHaveGiven = new Set();
    if (kudosData) {
        kudosData.forEach(kudo => {
            const key = `${kudo.ticket_id}-${kudo.note_index}`;
            kudosCounts.set(key, (kudosCounts.get(key) || 0) + 1);
            if (kudo.giver_user_id === appState.currentUser.id) kudosIHaveGiven.add(key);
        });
    }

    // Use a simpler query just for checking existence
    const { count: pinCount, error: pinError } = await _supabase
        .from('ticket_pins')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', appState.currentUser.id)
        .eq('ticket_id', ticket.id);
    if(pinError) console.error("Pin check error:", pinError);
    const isPinned = (pinCount || 0) > 0;


    const attachmentUrlMap = new Map();
    const attachmentPaths = (ticket.attachments || []).filter(file => file && file.path).map(file => file.path);
    if (attachmentPaths.length > 0) {
        const { data } = await _supabase.storage.from('ticket-attachments').createSignedUrls(attachmentPaths, 3600);
        if (data) {
            data.forEach((urlData, index) => {
                if (urlData.signedUrl) attachmentUrlMap.set(attachmentPaths[index], urlData.signedUrl);
            });
        }
    }

    const readNotes = JSON.parse(localStorage.getItem('readNotes')) || {};
    const isDone = ticket.status === 'Done';
    const isMineCreator = appState.currentUser && ticket.created_by === appState.currentUser.id;
    const isAssignedToMe = appState.currentUser && ticket.assigned_to_name === myName;
    const userColor = getUserColor(ticket.username);
    let borderColorClass = 'border-l-4 border-transparent';
    if (ticket.user_id === appState.currentUser.id && !isAssignedToMe) borderColorClass = 'border-l-4 border-indigo-500';
    if (isAssignedToMe) borderColorClass = 'border-l-4 border-purple-500';
    
    // Default to collapsed unless explicitly set to expand
    const isCollapsed = ticket.id !== appState.expandedTicketId;

    const lastNote = ticket.notes && ticket.notes.length > 0 ? ticket.notes[ticket.notes.length - 1] : null;
    let hasUnreadNote = false;
    if (lastNote && lastNote.user_id !== appState.currentUser.id) {
        const lastReadTimestamp = readNotes[ticket.id];
        if (!lastReadTimestamp || new Date(lastNote.timestamp) > new Date(lastReadTimestamp)) hasUnreadNote = true;
    }

    const ticketElement = document.createElement('div');
    ticketElement.id = `ticket-${ticket.id}`;
    ticketElement.dataset.ticketId = ticket.id; // Consistent data attribute
    // Removed dataset.activeTicketId as it was potentially conflicting
    ticketElement.className = `ticket-card glassmorphism rounded-lg p-3 shadow-md flex flex-col gap-2 transition-all hover:bg-gray-700/30 fade-in ${isDone ? 'opacity-60' : ''} ${borderColorClass}`;

    const priority = ticket.priority || 'Medium';
    const priorityStyle = PRIORITY_STYLES[priority];
    const tagsHTML = (ticket.tags || []).map(tag => `<span class="bg-gray-600/50 text-gray-300 text-xs font-semibold px-2 py-0.5 rounded-full border border-gray-500">${tag}</span>`).join('');
    const reopenFlagHTML = ticket.is_reopened ? `<span class="reopen-flag text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30" title="Re-opened by ${ticket.reopened_by_name || 'N/A'}">Re-opened</span>` : '';

    let closedByInfoHTML = '';
    if (ticket.completed_by_name) {
        const label = ticket.status === 'Done' ? 'Closed by:' : 'Last closed by:';
        closedByInfoHTML = `<p class="status-change-info pl-2 border-l border-gray-600" title="on ${new Date(ticket.completed_at).toLocaleString()}">${label} ${ticket.completed_by_name}</p>`;
    }

    const attachmentsHTML = (ticket.attachments && ticket.attachments.length > 0) ? `<div class="mt-2 pt-2 border-t border-gray-700/50"><h4 class="text-xs font-semibold text-gray-400 mb-2">Attachments:</h4><div class="flex flex-wrap gap-2">${ticket.attachments.filter(file => file && file.path && file.name).map(file => { const signedUrl = attachmentUrlMap.get(file.path); if (!signedUrl) return ''; const isImage = (name) => ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(name.split('.').pop().toLowerCase()); if (isImage(file.name)) { return `<div class="relative group"><img src="${signedUrl}" alt="${file.name}" class="attachment-thumbnail" onclick="event.stopPropagation(); ui.openImageViewer('${signedUrl}')"><button onclick="event.stopPropagation(); tickets.deleteAttachment(${ticket.id}, '${file.path}')" class="attachment-delete-btn" title="Delete attachment">&times;</button></div>`; } else { return `<div class="flex items-center justify-between bg-gray-700/50 p-2 rounded-md w-full"><a href="${signedUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" class="text-indigo-400 hover:underline text-sm truncate flex-grow">${file.name}</a><button onclick="event.stopPropagation(); tickets.deleteAttachment(${ticket.id}, '${file.path}')" class="text-gray-400 hover:text-red-400 p-1 flex-shrink-0" title="Delete attachment"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button></div>`; } }).join('')}</div></div>` : '';
    
    // Pass the full notes array to createNoteHTML for correct reply rendering
    const notesHTML = (ticket.notes || []).map((note, index) => createNoteHTML(note, ticket.id, index, kudosCounts, kudosIHaveGiven, ticket.notes)).join('');
    
    // Call renderRelationshipsOnTicket with the fetched subjects
    const relationshipsHTML = renderRelationshipsOnTicket(ticket, linkedSubjectsMap);

    const warningIconHTML = ticket.reminder_requested_at ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-yellow-400 ml-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" title="A reminder was sent for this ticket"><path fill-rule="evenodd" d="M8.257 3.099c.636-1.1 2.29-1.1 2.926 0l6.847 11.982c.636 1.1-.19 2.419-1.463 2.419H2.873c-1.272 0-2.1-1.319-1.463-2.419L8.257 3.099zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>` : '';
    
    // BUILD LINKED TICKETS BADGES using the fetched map
    const linkedTicketsBadges = ticket.related_tickets && ticket.related_tickets.length > 0
        ? `<div class="flex flex-wrap gap-1 ml-1">${ticket.related_tickets.map(rel => `<span class="text-xs bg-blue-500/30 text-blue-300 px-2 py-0.5 rounded-full border border-blue-400/50 font-medium cursor-pointer hover:bg-blue-500/50" onclick="event.stopPropagation(); tickets.navigateToRelatedTicket(${rel.ticket_id})" title="${rel.relationship_type}: ${linkedSubjectsMap[rel.ticket_id] || 'Ticket #' + rel.ticket_id}">🔗 #${rel.ticket_id}</span>`).join('')}</div>`
        : '';

    ticketElement.innerHTML = `
        <div class="ticket-header flex items-start gap-3 cursor-pointer" onclick="tickets.handleTicketToggle(${ticket.id})">
            <div class="flex-shrink-0 w-10 h-10 rounded-full ${userColor.bg} flex items-center justify-center font-bold text-sm border-2 border-gray-600/50 shadow-md">${ticket.username.substring(0, 2).toUpperCase()}</div>
            <div class="flex-grow min-w-0">
                <div class="flex justify-between items-center mb-1">
                     <p class="text-xs">
                        <span class="font-bold text-indigo-300">#${ticket.id}</span>
                        <span class="font-bold ${userColor.text} ml-2">${ticket.username}</span>
                        <span class="assignment-info">${ticket.assigned_to_name ? `→ <span class="font-bold text-purple-400">${ticket.assigned_to_name}</span>` : ''}</span>
                    </p>
                    <div class="flex items-center gap-2 flex-shrink-0">
                        <span id="unread-note-dot-${ticket.id}" class="h-3 w-3 bg-red-500 rounded-full ${hasUnreadNote ? '' : 'hidden'}"></span>
                        ${reopenFlagHTML}
                        <span class="text-xs font-semibold px-2 py-0.5 rounded-full border ${ticket.source === 'Outlook' ? 'bg-blue-500/20 text-blue-300 border-blue-400/30' : 'bg-purple-500/20 text-purple-300 border-purple-400/30'}">${ticket.source}</span>
                        <span class="priority-badge text-xs font-semibold px-2 py-0.5 rounded-full ${priorityStyle.bg} ${priorityStyle.text}">${priority}</span>
                    </div>
                </div>
                <div class="text-white text-sm font-normal mb-2 leading-snug flex items-center flex-wrap gap-2">
                    <div class="flex flex-wrap gap-1 mr-2">${tagsHTML}</div>
                    <span>${ticket.subject}</span>
                    ${linkedTicketsBadges}
                    ${warningIconHTML}
                </div>
                <div id="presence-${ticket.id}"></div>
            </div>
            <div class="flex items-center gap-2">
                <div onclick="event.stopPropagation(); tickets.toggleTicketStatus(${ticket.id}, '${ticket.status}')" class="cursor-pointer text-xs font-semibold py-1 px-3 rounded-full h-fit transition-colors border ${isDone ? 'bg-green-500/20 text-green-300 border-green-400/30 hover:bg-green-500/30' : 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30 hover:bg-yellow-500/30'}">${ticket.status}</div>
                <button class="ticket-collapse-btn p-1 rounded-full hover:bg-gray-700/50"><svg class="w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-180'}" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button>
            </div>
        </div>
        <div class="ticket-body ${isCollapsed ? 'hidden' : ''}" onclick="event.stopPropagation()">
            <div class="pt-2 mt-2 border-t border-gray-700/30">${attachmentsHTML}${relationshipsHTML}<div class="space-y-2 mb-2" id="notes-list-${ticket.id}">${notesHTML}</div><div class="note-container relative"><div id="note-editor-${ticket.id}" class="note-editor"></div><div class="flex justify-end mt-2"><button onclick="event.stopPropagation(); tickets.addNote(${ticket.id})" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors hover-scale">Add Note</button></div></div></div>
        </div>
        <div class="mt-2 pt-3 border-t border-gray-700/50 flex justify-between items-center" onclick="event.stopPropagation()">
            <div class="flex items-center gap-2 text-gray-400 text-xs">
                <p>Created: ${new Date(ticket.created_at).toLocaleString()}</p>
                <p class="pl-2 border-l border-gray-600">Updated: ${new Date(ticket.updated_at).toLocaleString()}</p>
                ${closedByInfoHTML}
            </div>
            <div class="flex justify-end items-center gap-2 flex-wrap">
                <label for="add-attachment-${ticket.id}" class="cursor-pointer text-gray-400 hover:text-indigo-400 p-2 transition-colors hover-scale" title="Add Attachment" onclick="event.stopPropagation();"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z"/></svg></label>
                <input type="file" id="add-attachment-${ticket.id}" class="hidden" onchange="tickets.addAttachment(${ticket.id}, this)">
                ${isAssignedToMe && ticket.assignment_status === 'pending' ? `<button onclick="event.stopPropagation(); tickets.acceptAssignment(${ticket.id})" class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-xs hover-scale">Accept</button>` : ''}
                ${ticket.assignment_status === 'accepted' ? `<span class="text-green-400 text-xs font-semibold">Accepted</span>` : ''}
                ${ticket.assigned_to_name && isMineCreator && ticket.assignment_status !== 'accepted' && !ticket.reminder_requested_at ? `<button onclick="event.stopPropagation(); tickets.requestReminder(${ticket.id})" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded-md text-xs hover-scale">Remind</button>` : ''}
                <button onclick="event.stopPropagation(); tickets.toggleFollowUp(${ticket.id}, ${ticket.needs_followup})" title="Toggle Follow-up (Ctrl+F key)" class="p-1 rounded-full hover:bg-gray-700/50"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${ticket.needs_followup ? 'text-yellow-400 fill-current' : 'text-gray-500'}" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg></button>
<button onclick="event.stopPropagation(); tickets.openRelationshipModal(${ticket.id})" title="Link Related Tickets (Ctrl+L key)" class="p-1 rounded-full hover:bg-gray-700/50 text-gray-400 hover:text-indigo-400">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
        <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
    </svg>
</button>               
 <button onclick="event.stopPropagation(); tickets.togglePinTicket(${ticket.id})" title="Pin Ticket (Ctrl+* key)" class="p-1 rounded-full hover:bg-gray-700/50 transition-colors" id="pin-btn-${ticket.id}"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${isPinned ? 'text-red-400 fill-current' : 'text-gray-500'}" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5.951-1.429 5.951 1.429a1 1 0 001.169-1.409l-7-14z" /></svg></button>
              ${!isAssignedToMe ? `<button onclick="event.stopPropagation(); tickets.assignToMe(${ticket.id})" class="text-gray-400 hover:text-green-400 p-2 transition-colors hover-scale" title="Assign to Me (Ctrl+A key)"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/><path fill-rule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0-5.468 11.37C3.242 11.226 4.805 10 8 10s4.757 1.225 5.468 2.37A7 7 0 0 0 8 1z"/></svg></button>` : ''}
                <button onclick="event.stopPropagation(); ui.openEditModal(${ticket.id})" class="text-gray-400 hover:text-indigo-400 p-2 transition-colors hover-scale" title="Edit Ticket (Ctrl+P key)"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/></svg></button>
                ${ticket.user_id === appState.currentUser.id ? `<button onclick="event.stopPropagation(); tickets.deleteTicket(${ticket.id})" class="text-gray-400 hover:text-red-500 p-2 transition-colors hover-scale" title="Delete Ticket"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>` : ''}
            </div>
        </div>`;
    return ticketElement;
}

// js/tickets.js

// js/tickets.js
export async function prependTicketToView(ticket) {
    let ticketList, targetStateArray;
    if (appState.currentView === 'tickets') {
        ticketList = document.getElementById('ticket-list');
        targetStateArray = appState.tickets;
    } else if (appState.currentView === 'done') {
        ticketList = document.getElementById('done-ticket-list');
        targetStateArray = appState.doneTickets;
    } else if (appState.currentView === 'follow-up') {
        ticketList = document.getElementById('follow-up-ticket-list');
        targetStateArray = appState.followUpTickets;
    }
    if (!ticketList) return;

    targetStateArray.unshift(ticket);
    
    // Fetch linked ticket subjects for this single ticket
    let linkedSubjectsMap = {};
    if (ticket.related_tickets && ticket.related_tickets.length > 0) {
        linkedSubjectsMap = await fetchLinkedTicketSubjects(ticket.related_tickets);
    }
    
    const ticketElement = await createTicketElement(ticket, linkedSubjectsMap);
    ticketList.prepend(ticketElement);

    if (document.getElementById(`note-editor-${ticket.id}`) && !quillInstances.has(ticket.id)) {
        const quill = new Quill(`#note-editor-${ticket.id}`, {
            modules: { toolbar: [['bold', 'italic'], [{ 'list': 'ordered' }, { 'list': 'bullet' }], ['code-block']] },
            placeholder: 'Add a note...',
            theme: 'snow'
        });
        quillInstances.set(ticket.id, quill);
    }
}


// js/tickets.js



// ========== FUNCTION 2: renderTickets ==========
// Modified to fetch linked subjects upfront
export async function renderTickets(isNew = false) {
    let ticketData, ticketList;
    const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
    const isDoneView = appState.currentView === 'done';
    const isFollowUpView = appState.currentView === 'follow-up';

    if (isFollowUpView) {
        ticketData = appState.followUpTickets;
        ticketList = document.getElementById('follow-up-ticket-list');
    } else if (isDoneView) {
        ticketData = appState.doneTickets;
        ticketList = document.getElementById('done-ticket-list');
    } else {
        ticketData = appState.tickets;
        ticketList = document.getElementById('ticket-list');
    }

    if (!ticketList) return;

    if (isNew) {
        ticketList.innerHTML = '';
        quillInstances.clear();
    }

    const ticketsToRender = isNew ? ticketData : ticketData.slice(-appState.TICKETS_PER_PAGE);

    if (ticketData.length === 0 && isNew) {
        ticketList.innerHTML = `<div class="text-center text-gray-400 mt-8 fade-in"><p>No tickets match your current filters.</p></div>`;
        return;
    }

    const visibleTicketIds = ticketsToRender.map(t => t.id);
    const kudosCounts = new Map();
    const kudosIHaveGiven = new Set();
    const attachmentUrlMap = new Map();
    
    // OPTIMIZATION: Fetch all pinned tickets in ONE query (not N queries)
    const pinnedTicketsMap = new Map();
    if (visibleTicketIds.length > 0) {
        try {
            const { data: pinnedData, error: pinnedError } = await _supabase
                .from('ticket_pins')
                .select('ticket_id')
                .eq('user_id', appState.currentUser.id)
                .in('ticket_id', visibleTicketIds);
            
            if (pinnedError) {
                console.error("Error fetching pinned tickets:", pinnedError);
            } else if (pinnedData) {
                pinnedData.forEach(pin => {
                    pinnedTicketsMap.set(pin.ticket_id, true);
                });
            }
        } catch (err) {
            console.error("Exception fetching pinned:", err);
        }
    }

    // Fetch kudos data
    if (visibleTicketIds.length > 0) {
        const { data: kudosData, error } = await _supabase.from('kudos').select('*').in('ticket_id', visibleTicketIds);
        if (error) console.error("Error fetching kudos:", error);

        if (kudosData) {
            kudosData.forEach(kudo => {
                const key = `${kudo.ticket_id}-${kudo.note_index}`;
                kudosCounts.set(key, (kudosCounts.get(key) || 0) + 1);
                if (kudo.giver_user_id === appState.currentUser.id) {
                    kudosIHaveGiven.add(key);
                }
            });
        }
    }

    // Fetch attachment URLs
    const allAttachmentPaths = ticketsToRender
        .flatMap(ticket => ticket.attachments || [])
        .filter(file => file && file.path)
        .map(file => file.path);

    if (allAttachmentPaths.length > 0) {
        const { data, error } = await _supabase.storage.from('ticket-attachments').createSignedUrls(allAttachmentPaths, 3600);
        if (error) {
            console.error("Error creating signed URLs:", error);
        }
        if (data) {
            data.forEach((urlData, index) => {
                if (urlData.signedUrl) {
                    attachmentUrlMap.set(allAttachmentPaths[index], urlData.signedUrl);
                }
            });
        }
    }

    // FETCH ALL LINKED TICKET SUBJECTS IN ONE QUERY
    const allLinkedTicketIds = new Set();
    ticketsToRender.forEach(ticket => {
        if (ticket.related_tickets && ticket.related_tickets.length > 0) {
            ticket.related_tickets.forEach(rel => allLinkedTicketIds.add(rel.ticket_id));
        }
    });

    const linkedTicketsDataMap = {};
    if (allLinkedTicketIds.size > 0) {
        try {
            const { data: linkedTickets, error: linkedError } = await _supabase
                .from('tickets')
                .select('id, subject')
                .in('id', Array.from(allLinkedTicketIds));
            
            if (linkedError) {
                console.error('Error fetching linked tickets:', linkedError);
            } else if (linkedTickets) {
                linkedTickets.forEach(t => {
                    linkedTicketsDataMap[t.id] = t.subject;
                });
            }
        } catch (err) {
            console.error('Error in linked tickets fetch:', err);
        }
    }

    const fragment = document.createDocumentFragment();
    const readNotes = JSON.parse(localStorage.getItem('readNotes')) || {};

    // Use for loop for efficiency
    for (const ticket of ticketsToRender) {
        const isDone = ticket.status === 'Done';
        const isMineCreator = appState.currentUser && ticket.created_by === appState.currentUser.id;
        const isAssignedToMe = appState.currentUser && ticket.assigned_to_name === myName;
        const wasReminded = !!ticket.reminder_requested_at;
        const userColor = getUserColor(ticket.username);
        
        let borderColorClass = 'border-l-4 border-transparent';
        if (ticket.user_id === appState.currentUser.id && !isAssignedToMe) {
            borderColorClass = 'border-l-4 border-indigo-500';
        }
        if (isAssignedToMe) {
            borderColorClass = 'border-l-4 border-purple-500';
        }

        let isCollapsed = true;
        if (appState.expandedTicketId && ticket.id === appState.expandedTicketId) {
            isCollapsed = false;
        }

        const lastNote = ticket.notes && ticket.notes.length > 0 ? ticket.notes[ticket.notes.length - 1] : null;
        let hasUnreadNote = false;
        if (lastNote && lastNote.user_id !== appState.currentUser.id) {
            const lastReadTimestamp = readNotes[ticket.id];
            if (!lastReadTimestamp || new Date(lastNote.timestamp) > new Date(lastReadTimestamp)) {
                hasUnreadNote = true;
            }
        }

        const ticketElement = document.createElement('div');
        ticketElement.id = `ticket-${ticket.id}`;
        ticketElement.dataset.ticketId = ticket.id;
        ticketElement.className = `ticket-card glassmorphism rounded-lg p-3 shadow-md flex flex-col gap-2 transition-all hover:bg-gray-700/30 fade-in ${isDone ? 'opacity-60' : ''} ${borderColorClass}`;

        const priority = ticket.priority || 'Medium';
        const priorityStyle = PRIORITY_STYLES[priority];
        const tagsHTML = (ticket.tags || []).map(tag => `<span class="bg-gray-600/50 text-gray-300 text-xs font-semibold px-2 py-0.5 rounded-full border border-gray-500">${tag}</span>`).join('');

        const reopenFlagHTML = ticket.is_reopened ? `<span class="reopen-flag text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30" title="Re-opened by ${ticket.reopened_by_name || 'N/A'}">Re-opened</span>` : '';

        let closedByInfoHTML = '';
        if (ticket.completed_by_name) {
            const label = ticket.status === 'Done' ? 'Closed by:' : 'Last closed by:';
            closedByInfoHTML = `<p class="status-change-info pl-2 border-l border-gray-600" title="on ${new Date(ticket.completed_at).toLocaleString()}">${label} ${ticket.completed_by_name}</p>`;
        }

        const isImage = (fileName) => {
            if (!fileName || typeof fileName !== 'string') return false;
            const extension = fileName.split('.').pop().toLowerCase();
            return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension);
        };

        const attachmentsHTML = (ticket.attachments && ticket.attachments.length > 0) ? `<div class="mt-2 pt-2 border-t border-gray-700/50"><h4 class="text-xs font-semibold text-gray-400 mb-2">Attachments:</h4><div class="flex flex-wrap gap-2">${ticket.attachments.filter(file => file && file.path && file.name).map(file => {
            const signedUrl = attachmentUrlMap.get(file.path);
            if (!signedUrl) return '';
            if (isImage(file.name)) {
                return `<div class="relative group"><img src="${signedUrl}" alt="${file.name}" class="attachment-thumbnail" onclick="event.stopPropagation(); ui.openImageViewer('${signedUrl}')"><button onclick="event.stopPropagation(); tickets.deleteAttachment(${ticket.id}, '${file.path}')" class="attachment-delete-btn" title="Delete attachment">&times;</button></div>`;
            } else {
                return `<div class="flex items-center justify-between bg-gray-700/50 p-2 rounded-md w-full"><a href="${signedUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" class="text-indigo-400 hover:underline text-sm truncate flex-grow">${file.name}</a><button onclick="event.stopPropagation(); tickets.deleteAttachment(${ticket.id}, '${file.path}')" class="text-gray-400 hover:text-red-400 p-1 flex-shrink-0" title="Delete attachment"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button></div>`;
            }
        }).join('')}</div></div>` : '';

        const notesHTML = (ticket.notes || []).map((note, index) => createNoteHTML(note, ticket.id, index, kudosCounts, kudosIHaveGiven, ticket.notes)).join('');
        
        const warningIconHTML = wasReminded ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-yellow-400 ml-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" title="A reminder was sent for this ticket"><path fill-rule="evenodd" d="M8.257 3.099c.636-1.1 2.29-1.1 2.926 0l6.847 11.982c.636 1.1-.19 2.419-1.463 2.419H2.873c-1.272 0-2.1-1.319-1.463-2.419L8.257 3.099zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>` : '';

        // Get isPinned from the map we fetched earlier
        const isPinned = pinnedTicketsMap.has(ticket.id);

        // BUILD LINKED TICKETS BADGES - using the pre-fetched data
        const linkedTicketsBadges = ticket.related_tickets && ticket.related_tickets.length > 0
            ? `<div class="flex flex-wrap gap-1 ml-1">${ticket.related_tickets.map(rel => `<span class="text-xs bg-blue-500/30 text-blue-300 px-2 py-0.5 rounded-full border border-blue-400/50 font-medium cursor-default" title="${rel.relationship_type}: Ticket #${rel.ticket_id}">🔗 #${rel.ticket_id}</span>`).join('')}</div>`
            : '';

        ticketElement.innerHTML = `
<div class="ticket-header flex items-start gap-3 cursor-pointer" onclick="tickets.handleTicketToggle(${ticket.id})">
    <div class="flex-shrink-0 w-10 h-10 rounded-full ${userColor.bg} flex items-center justify-center font-bold text-sm border-2 border-gray-600/50 shadow-md">${ticket.username.substring(0, 2).toUpperCase()}</div>
    <div class="flex-grow min-w-0">
        <div class="flex justify-between items-center mb-1">
            <p class="text-xs">
                <span class="font-bold text-indigo-300">#${ticket.id}</span>
                <span class="font-bold ${userColor.text} ml-2">${ticket.username}</span>
                <span class="assignment-info">${ticket.assigned_to_name ? `→ <span class="font-bold text-purple-400">${ticket.assigned_to_name}</span>` : ''}</span>
            </p>
            <div class="flex items-center gap-2 flex-shrink-0">
                <span id="unread-note-dot-${ticket.id}" class="h-3 w-3 bg-red-500 rounded-full ${hasUnreadNote ? '' : 'hidden'}"></span>
                ${reopenFlagHTML}
                <span class="text-xs font-semibold px-2 py-0.5 rounded-full border ${ticket.source === 'Outlook' ? 'bg-blue-500/20 text-blue-300 border-blue-400/30' : 'bg-purple-500/20 text-purple-300 border-purple-400/30'}">${ticket.source}</span>
                <span class="priority-badge text-xs font-semibold px-2 py-0.5 rounded-full ${priorityStyle.bg} ${priorityStyle.text}">${priority}</span>
            </div>
        </div>
        <div class="text-white text-sm font-normal mb-2 leading-snug flex items-center flex-wrap gap-2">
            <div class="flex flex-wrap gap-1 mr-2">${tagsHTML}</div>
            <span>${ticket.subject}</span>
            ${linkedTicketsBadges}
            ${warningIconHTML}
        </div>
        <div id="presence-${ticket.id}"></div>
    </div>
    <div class="flex items-center gap-2">
        <div onclick="event.stopPropagation(); tickets.toggleTicketStatus(${ticket.id}, '${ticket.status}')" class="cursor-pointer text-xs font-semibold py-1 px-3 rounded-full h-fit transition-colors border ${isDone ? 'bg-green-500/20 text-green-300 border-green-400/30 hover:bg-green-500/30' : 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30 hover:bg-yellow-500/30'}">${ticket.status}</div>
        <button class="ticket-collapse-btn p-1 rounded-full hover:bg-gray-700/50"><svg class="w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-180'}" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button>
    </div>
</div>
<div class="ticket-body ${isCollapsed ? 'hidden' : ''}" onclick="event.stopPropagation()">
    <div class="pt-2 mt-2 border-t border-gray-700/30">${attachmentsHTML}${renderRelationshipsOnTicket(ticket, linkedTicketsDataMap)}<div class="space-y-2 mb-2" id="notes-list-${ticket.id}">${notesHTML}</div><div class="note-container relative"><div id="note-editor-${ticket.id}" class="note-editor"></div><div class="flex justify-end mt-2"><button onclick="event.stopPropagation(); tickets.addNote(${ticket.id})" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors hover-scale">Add Note</button></div></div></div>
</div>
<div class="mt-2 pt-3 border-t border-gray-700/50 flex justify-between items-center" onclick="event.stopPropagation()">
    <div class="flex items-center gap-2 text-gray-400 text-xs">
        <p>Created: ${new Date(ticket.created_at).toLocaleString()}</p>
        <p class="pl-2 border-l border-gray-600">Updated: ${new Date(ticket.updated_at).toLocaleString()}</p>
        ${closedByInfoHTML}
    </div>
    <div class="flex justify-end items-center gap-2 flex-wrap">
        <label for="add-attachment-${ticket.id}" class="cursor-pointer text-gray-400 hover:text-indigo-400 p-2 transition-colors hover-scale" title="Add Attachment" onclick="event.stopPropagation();"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z"/></svg></label>
        <input type="file" id="add-attachment-${ticket.id}" class="hidden" onchange="tickets.addAttachment(${ticket.id}, this)">
        ${isAssignedToMe && ticket.assignment_status === 'pending' ? `<button onclick="event.stopPropagation(); tickets.acceptAssignment(${ticket.id})" class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-xs hover-scale">Accept</button>` : ''}
        ${ticket.assignment_status === 'accepted' ? `<span class="text-green-400 text-xs font-semibold">Accepted</span>` : ''}
        ${ticket.assigned_to_name && isMineCreator && ticket.assignment_status !== 'accepted' && !ticket.reminder_requested_at ? `<button onclick="event.stopPropagation(); tickets.requestReminder(${ticket.id})" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded-md text-xs hover-scale">Remind</button>` : ''}
        <button onclick="event.stopPropagation(); tickets.toggleFollowUp(${ticket.id}, ${ticket.needs_followup})" title="Toggle Follow-up (Ctrl+F key)" class="p-1 rounded-full hover:bg-gray-700/50"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${ticket.needs_followup ? 'text-yellow-400 fill-current' : 'text-gray-500'}" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg></button>
<button onclick="event.stopPropagation(); tickets.openRelationshipModal(${ticket.id})" title="Link Related Tickets (Ctrl+L key)" class="p-1 rounded-full hover:bg-gray-700/50 text-gray-400 hover:text-indigo-400">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
        <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
    </svg>
</button>       
 <button onclick="event.stopPropagation(); tickets.togglePinTicket(${ticket.id})" title="Pin Ticket (Ctrl+* key)" class="p-1 rounded-full hover:bg-gray-700/50 transition-colors" id="pin-btn-${ticket.id}"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${isPinned ? 'text-red-400 fill-current' : 'text-gray-500'}" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5.951-1.429 5.951 1.429a1 1 0 001.169-1.409l-7-14z" /></svg></button>
        ${!isAssignedToMe ? `<button onclick="event.stopPropagation(); tickets.assignToMe(${ticket.id})" class="text-gray-400 hover:text-green-400 p-2 transition-colors hover-scale" title="Assign to Me (Ctrl+A key)"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/><path fill-rule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0-5.468 11.37C3.242 11.226 4.805 10 8 10s4.757 1.225 5.468 2.37A7 7 0 0 0 8 1z"/></svg></button>` : ''}
        <button onclick="event.stopPropagation(); ui.openEditModal(${ticket.id})" class="text-gray-400 hover:text-indigo-400 p-2 transition-colors hover-scale" title="Edit Ticket (Ctrl+P key)"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/></svg></button>
        ${ticket.user_id === appState.currentUser.id ? `<button onclick="event.stopPropagation(); tickets.deleteTicket(${ticket.id})" class="text-gray-400 hover:text-red-500 p-2 transition-colors hover-scale" title="Delete Ticket"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>` : ''}
    </div>
</div>`;
        fragment.appendChild(ticketElement);
    }

    ticketList.appendChild(fragment);

    // Initialize Quill editors for new tickets
    ticketsToRender.forEach(ticket => {
        if (document.getElementById(`note-editor-${ticket.id}`) && !quillInstances.has(ticket.id)) {
            const quill = new Quill(`#note-editor-${ticket.id}`, {
                modules: {
                    toolbar: [['bold', 'italic'], [{ 'list': 'ordered' }, { 'list': 'bullet' }], ['code-block']]
                },
                placeholder: 'Add a note...',
                theme: 'snow'
            });
            quillInstances.set(ticket.id, quill);
        }
    });
}

export async function updateTicketInPlace(updatedTicket) {
    // Find and update the ticket in the local state array first
    const ticketLists = [appState.tickets, appState.doneTickets, appState.followUpTickets];
    for (const list of ticketLists) {
        const index = list.findIndex(t => t.id === updatedTicket.id);
        if (index !== -1) {
            list[index] = updatedTicket;
            break;
        }
    }

    const ticketElement = document.getElementById(`ticket-${updatedTicket.id}`);
    if (!ticketElement) return; // Ticket is not visible on the current screen, so do nothing

    // Update notes by appending or rebuilding if necessary
    const notesListElement = document.getElementById(`notes-list-${updatedTicket.id}`);
    if (notesListElement) {
        const existingNotesCount = notesListElement.children.length;
        const newNotes = updatedTicket.notes || [];
        if (newNotes.length > existingNotesCount) {
            for (let i = existingNotesCount; i < newNotes.length; i++) {
                const note = newNotes[i];
                const noteHTML = createNoteHTML(note, updatedTicket.id, i);
                notesListElement.insertAdjacentHTML('beforeend', noteHTML);
                if (note.user_id !== appState.currentUser.id) {
                    const unreadDot = document.getElementById(`unread-note-dot-${updatedTicket.id}`);
                    if (unreadDot) unreadDot.classList.remove('hidden');
                }
            }
        } else if (newNotes.length < existingNotesCount) {
            notesListElement.innerHTML = newNotes.map((note, index) => createNoteHTML(note, updatedTicket.id, index)).join('');
        }
    }

    // Update simple text fields
    const subjectSpan = ticketElement.querySelector('.leading-snug > span');
    if (subjectSpan && subjectSpan.textContent !== updatedTicket.subject) {
        subjectSpan.textContent = updatedTicket.subject;
    }

    const statusDiv = ticketElement.querySelector('.cursor-pointer.text-xs.font-semibold');
    if (statusDiv && statusDiv.textContent.trim() !== updatedTicket.status) {
        statusDiv.textContent = updatedTicket.status;
    }

    // Update timestamps and "Closed by" info
    const timestampContainer = ticketElement.querySelector('.flex.items-center.gap-2.text-gray-400.text-xs');
    if (timestampContainer) {
        const updatedTimestampElement = timestampContainer.querySelector('p:last-child');
        if (updatedTimestampElement) {
            updatedTimestampElement.textContent = `Updated: ${new Date(updatedTicket.updated_at).toLocaleString()}`;
        }

        const existingStatusInfo = timestampContainer.querySelector('.status-change-info');
        if (existingStatusInfo) existingStatusInfo.remove();

        let statusChangeInfoHTML = '';
        if (updatedTicket.completed_by_name) {
            const label = updatedTicket.status === 'Done' ? 'Closed by:' : 'Last closed by:';
            statusChangeInfoHTML = `<p class="status-change-info pl-2 border-l border-gray-600" title="on ${new Date(updatedTicket.completed_at).toLocaleString()}">${label} ${updatedTicket.completed_by_name}</p>`;
        }
        if (statusChangeInfoHTML) {
            timestampContainer.insertAdjacentHTML('beforeend', statusChangeInfoHTML);
        }
    }

    // Update the "Re-opened" flag
    const reopenFlag = ticketElement.querySelector('.reopen-flag');
    if (updatedTicket.is_reopened && !reopenFlag) {
        const unreadDot = ticketElement.querySelector(`#unread-note-dot-${updatedTicket.id}`);
        if (unreadDot) {
            const flagHTML = `<span class="reopen-flag text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30" title="Re-opened by ${updatedTicket.reopened_by_name || 'N/A'}">Re-opened</span>`;
            unreadDot.insertAdjacentHTML('afterend', flagHTML);
        }
    } else if (reopenFlag && updatedTicket.reopened_by_name) {
        reopenFlag.title = `Re-opened by ${updatedTicket.reopened_by_name}`;
    } else if (!updatedTicket.is_reopened && reopenFlag) {
        reopenFlag.remove();
    }

    // Update the tags
    const tagsContainer = ticketElement.querySelector('.leading-snug .flex-wrap');
    if (tagsContainer) {
        const newTagsHTML = (updatedTicket.tags || []).map(tag => `<span class="bg-gray-600/50 text-gray-300 text-xs font-semibold px-2 py-0.5 rounded-full border border-gray-500">${tag}</span>`).join('');
        tagsContainer.innerHTML = newTagsHTML;
    }

    // Update the priority badge and its color
    const priorityBadge = ticketElement.querySelector('.priority-badge');
    if (priorityBadge && priorityBadge.textContent !== updatedTicket.priority) {
        priorityBadge.textContent = updatedTicket.priority;
        const newPriority = updatedTicket.priority || 'Medium';
        const newStyles = PRIORITY_STYLES[newPriority];
        Object.values(PRIORITY_STYLES).forEach(style => {
            priorityBadge.classList.remove(style.bg, style.text);
        });
        priorityBadge.classList.add(newStyles.bg, newStyles.text);
    }

    // Update the follow-up star's color
    const followUpButton = ticketElement.querySelector(`button[onclick*="toggleFollowUp(${updatedTicket.id}"]`);
    if (followUpButton) {
        const starSvg = followUpButton.querySelector('svg');
        if (starSvg) {
            const isFlagged = starSvg.classList.contains('text-yellow-400');
            if (updatedTicket.needs_followup && !isFlagged) {
                starSvg.classList.add('text-yellow-400', 'fill-current');
                starSvg.classList.remove('text-gray-500');
            } else if (!updatedTicket.needs_followup && isFlagged) {
                starSvg.classList.remove('text-yellow-400', 'fill-current');
                starSvg.classList.add('text-gray-500');
            }
        }
    }

    // Update the assignment information
    const assignmentInfo = ticketElement.querySelector('.assignment-info');
    if (assignmentInfo) {
        if (updatedTicket.assigned_to_name) {
            assignmentInfo.innerHTML = `→ <span class="font-bold text-purple-400">${updatedTicket.assigned_to_name}</span>`;
        } else {
            assignmentInfo.innerHTML = '';
        }
    }

    // Finally, move the updated ticket to the top of the list
    const ticketList = ticketElement.parentElement;
    if (ticketList) {
        ticketList.prepend(ticketElement);
    }
}
// Helper function to generate HTML for a single note
export function createNoteHTML(note, ticketId, index, kudosCounts = new Map(), kudosIHaveGiven = new Set(), allNotes = []) {
    const sanitizedText = DOMPurify.sanitize(note.text || '');
    
    // Safely get user_id - fallback if missing
    const isMyNote = note.user_id === appState.currentUser.id;

    // Check if this note is a reply
    const isReply = note.reply_to_note_index !== undefined && note.reply_to_note_index !== null;
    const parentNoteIndex = note.reply_to_note_index;
    const parentNote = isReply && allNotes[parentNoteIndex] ? allNotes[parentNoteIndex] : null;

    // Count replies to this note
    const replyCount = allNotes.filter(n => n.reply_to_note_index === index).length;

    const indentClass = isReply ? 'ml-6 border-l-4 border-indigo-400/50' : '';
    
    const replyBadge = isReply 
        ? (parentNote 
            ? `<span class="text-xs bg-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded-full border border-indigo-400/30">Reply to ${parentNote.username}</span>`
            : `<span class="text-xs bg-gray-500/30 text-gray-300 px-2 py-0.5 rounded-full border border-gray-400/30">Reply to deleted note</span>`)
        : '';

    return `
    <div class="note-container bg-gray-700/30 p-3 rounded-md border border-gray-600/50 slide-in flex justify-between items-start gap-2 ${indentClass}">
        <div class="flex-grow min-w-0"> 
            <div class="flex items-center gap-2 flex-wrap">
                <p class="font-semibold text-gray-400 text-xs">${note.username}</p>
                ${replyBadge}
            </div>
            <div class="ql-snow"><div class="ql-editor note-text-display">${sanitizedText}</div></div>
            <p class="text-xs text-gray-500 mt-2">${new Date(note.timestamp).toLocaleString()}</p>
            ${replyCount > 0 ? `<p class="text-xs text-indigo-400 mt-1 cursor-pointer hover:underline" onclick="tickets.toggleReplies(${ticketId}, ${index})">View ${replyCount} replies</p>` : ''}
        </div>
        <div class="flex gap-1 flex-shrink-0">
            <button onclick="event.stopPropagation(); tickets.toggleReplyMode(${ticketId}, ${index})" class="text-gray-400 hover:text-indigo-400 p-1 transition-colors" title="Reply to this note">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M1.323 13.168A1.5 1.5 0 0 0 0 14.846V16h1.154a1.5 1.5 0 0 0 1.678-1.323l.92-7.373H5.5a.5.5 0 1 0 0-1H3.721L4.5 5H13.5a.5.5 0 0 0 .485-.379l1.5-6A.5.5 0 0 0 15 .5H4.585L3.998 2H.5a.5.5 0 0 0 0 1h2.6l1.223 7.377z"/></svg>
            </button>
            ${isMyNote ? `<button onclick="event.stopPropagation(); tickets.deleteNote(${ticketId}, ${index}, '${note.username}', '${note.user_id || ''}')" class="text-gray-400 hover:text-red-400 transition-colors p-1 opacity-75 hover:opacity-100 flex-shrink-0" title="Delete note">
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
            </button>` : ''}
        </div>
    </div>`;
}

export function toggleReplies(ticketId, parentNoteIndex) {
    const replySection = document.getElementById(`replies-${ticketId}-${parentNoteIndex}`);
    if (replySection) {
        replySection.classList.toggle('hidden');
    }
}

export function toggleReplyMode(ticketId, parentNoteIndex) {
    const replyForm = document.getElementById(`reply-form-${ticketId}-${parentNoteIndex}`);
    if (!replyForm) {
        // Create reply form
        const notesList = document.getElementById(`notes-list-${ticketId}`);
        if (!notesList) return;

        const formHTML = `
            <div id="reply-form-${ticketId}-${parentNoteIndex}" class="ml-6 mt-2 p-2 bg-gray-600/20 rounded-lg border border-indigo-400/30">
                <div id="reply-editor-${ticketId}-${parentNoteIndex}" class="note-editor"></div>
                <div class="flex justify-end gap-2 mt-2">
                    <button onclick="tickets.cancelReply(${ticketId}, ${parentNoteIndex})" class="bg-gray-600 hover:bg-gray-700 text-white text-xs font-semibold py-1 px-3 rounded-lg transition-colors">Cancel</button>
                    <button onclick="tickets.addReplyNote(${ticketId}, ${parentNoteIndex})" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-1 px-3 rounded-lg transition-colors">Reply</button>
                </div>
            </div>
        `;
        notesList.insertAdjacentHTML('beforeend', formHTML);

        // Initialize Quill editor for reply
        const quill = new Quill(`#reply-editor-${ticketId}-${parentNoteIndex}`, {
            modules: { toolbar: [['bold', 'italic'], [{ 'list': 'ordered' }, { 'list': 'bullet' }], ['code-block']] },
            placeholder: 'Write your reply...',
            theme: 'snow'
        });
        quillInstances.set(`reply-${ticketId}-${parentNoteIndex}`, quill);
    } else {
        replyForm.classList.toggle('hidden');
    }
}


export function cancelReply(ticketId, parentNoteIndex) {
    const replyForm = document.getElementById(`reply-form-${ticketId}-${parentNoteIndex}`);
    if (replyForm) {
        replyForm.remove();
    }
    quillInstances.delete(`reply-${ticketId}-${parentNoteIndex}`);
}

// js/tickets.js

export async function addReplyNote(ticketId, parentNoteIndex) {
    const quill = quillInstances.get(`reply-${ticketId}-${parentNoteIndex}`);
    if (!quill) return;

    const text = quill.root.innerHTML;

    if (quill.getLength() <= 1) {
        return showNotification('Empty Reply', 'Cannot add an empty reply.', 'error');
    }

    try {
        const mentionRegex = /@([\w.-]+)/g;
        const mentionedUsernames = [...text.matchAll(mentionRegex)].map(match => match[1]);
        const mentionedUserIds = [];
        mentionedUsernames.forEach(username => {
            if (appState.allUsers.has(username)) {
                mentionedUserIds.push(appState.allUsers.get(username));
            }
        });

        // Fetch current notes first
        const { data: currentTicketData, error: fetchError } = await _supabase.from('tickets').select('notes').eq('id', ticketId).single();
        if (fetchError) throw fetchError;

        const newNote = {
            username: appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0],
            user_id: appState.currentUser.id,
            text,
            timestamp: new Date().toISOString(),
            mentioned_user_ids: mentionedUserIds,
            reply_to_note_index: parentNoteIndex
        };

        // Save the new note
        const { error: updateError } = await _supabase.from('tickets').update({
            notes: [...(currentTicketData.notes || []), newNote],
            updated_at: new Date().toISOString()
        }).eq('id', ticketId);

        if (updateError) throw updateError;

        awardPoints('NOTE_ADDED', { ticketId: ticketId });
        cancelReply(ticketId, parentNoteIndex); // Remove the reply form

        // --- START: FIX ---
        // Fetch the LATEST ticket data AFTER the update to get the correct full notes array
        const { data: updatedTicket, error: fetchAfterError } = await _supabase
            .from('tickets')
            .select('notes') // Only need notes for re-rendering
            .eq('id', ticketId)
            .single();

        if (fetchAfterError) throw fetchAfterError;

        // Re-render notes section with the complete, updated notes list
        const notesListElement = document.getElementById(`notes-list-${ticketId}`);
        if (notesListElement && updatedTicket) {
             // Fetch kudos data again for the updated notes list
            const { data: kudosData } = await _supabase.from('kudos').select('*').eq('ticket_id', ticketId);
            const kudosCounts = new Map();
            const kudosIHaveGiven = new Set();
            if (kudosData) {
                kudosData.forEach(kudo => {
                    const key = `${kudo.ticket_id}-${kudo.note_index}`;
                    kudosCounts.set(key, (kudosCounts.get(key) || 0) + 1);
                    if (kudo.giver_user_id === appState.currentUser.id) kudosIHaveGiven.add(key);
                });
            }
            // Pass the LATEST notes array
            notesListElement.innerHTML = (updatedTicket.notes || []).map((note, index) =>
                createNoteHTML(note, ticketId, index, kudosCounts, kudosIHaveGiven, updatedTicket.notes)
            ).join('');
        }
        // --- END: FIX ---

    } catch (err) {
        showNotification('Error Adding Reply', err.message, 'error');
    }
}


// ========== TICKET RELATIONSHIPS/LINKING ==========

export async function openRelationshipModal(ticketId) {
    const ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === ticketId);
    if (!ticket) return;

    // Remove existing modal if present
    const existingModal = document.getElementById('relationship-modal');
    if (existingModal) existingModal.remove();

    // Create modal HTML dynamically with search functionality
    const modalHTML = `
        <div id="relationship-modal" class="modal fixed inset-0 bg-gray-900 bg-opacity-90 backdrop-blur-md flex items-center justify-center z-40 hidden opacity-0">
            <div class="glassmorphism p-8 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <h2 class="text-2xl font-bold text-white mb-6">Link Tickets</h2>
                
                <div class="space-y-4 mb-6">
                    <div>
                        <label class="block text-sm font-medium text-gray-400 mb-2">Relationship Type</label>
                        <select id="relationship-type" class="w-full bg-gray-700/50 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-gray-600">
                            <option value="duplicate">Duplicate of</option>
                            <option value="blocked-by">Blocked by</option>
                            <option value="blocks">Blocks</option>
                            <option value="related">Related to</option>
                            <option value="child">Child of</option>
                        </select>
                    </div>
                    
                    <div>
                        <label class="block text-sm font-medium text-gray-400 mb-2">Search Ticket by Subject</label>
                        <div class="flex gap-2">
                            <input type="text" id="ticket-search-subject" placeholder="Enter ticket subject..." class="flex-grow bg-gray-700/50 text-white p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 border border-gray-600">
                            <button onclick="tickets.searchTicketsForLink(${ticketId})" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg text-sm">Search</button>
                        </div>
                    </div>

                    <div>
                        <label class="block text-sm font-medium text-gray-400 mb-2">Search Results</label>
                        <div id="search-results-container" class="bg-gray-700/30 p-3 rounded-lg max-h-48 overflow-y-auto">
                            <p class="text-xs text-gray-400">Enter a subject and click Search to find tickets</p>
                        </div>
                    </div>
                </div>

                <div id="existing-relationships" class="mb-6">
                    <h3 class="text-sm font-semibold text-gray-300 mb-3">Currently Linked Tickets</h3>
                    <div id="relationships-list" class="space-y-2 max-h-32 overflow-y-auto"></div>
                </div>

                <div class="flex justify-end gap-4">
                    <button onclick="ui.closeRelationshipModal()" class="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-6 rounded-lg transition-colors hover-scale">Close</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Populate existing relationships
    await renderExistingRelationships(ticketId);

    ui.openModal('relationship-modal');
}

// New function to search tickets for linking
export async function searchTicketsForLink(currentTicketId) {
    const searchTerm = document.getElementById('ticket-search-subject').value.trim();
    
    if (!searchTerm || searchTerm.length < 2) {
        showNotification('Search Required', 'Please enter at least 2 characters to search', 'info');
        return;
    }

    try {
        const { data: results, error } = await _supabase
            .from('tickets')
            .select('id, subject, status, priority')
            .ilike('subject', `%${searchTerm}%`)
            .neq('id', currentTicketId) // Exclude the current ticket
            .limit(10);

        if (error) throw error;

        const resultsContainer = document.getElementById('search-results-container');
        
        if (!results || results.length === 0) {
            resultsContainer.innerHTML = '<p class="text-xs text-gray-400">No tickets found matching your search</p>';
            return;
        }

        resultsContainer.innerHTML = results.map(t => `
            <div class="flex items-center justify-between p-2 bg-gray-600/30 rounded-lg mb-2">
                <div class="flex-grow">
                    <p class="text-sm font-semibold text-white">#${t.id}</p>
                    <p class="text-xs text-gray-300 truncate">${t.subject}</p>
                    <div class="flex gap-2 mt-1">
                        <span class="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-300">${t.status}</span>
                        <span class="text-xs px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300">${t.priority}</span>
                    </div>
                </div>
                <button onclick="tickets.selectTicketForLink(${currentTicketId}, ${t.id})" class="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-1 px-3 rounded-lg text-xs ml-2">Link</button>
            </div>
        `).join('');
    } catch (err) {
        console.error('Error searching tickets:', err);
        showNotification('Search Error', err.message, 'error');
    }
}

// Function to select a ticket for linking
export async function selectTicketForLink(currentTicketId, relatedTicketId) {
    const relationshipType = document.getElementById('relationship-type').value;

    try {
        const ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === currentTicketId);
        const relationships = ticket?.related_tickets || [];

        // Check if already linked
        if (relationships.some(r => r.ticket_id === relatedTicketId)) {
            return showNotification('Already Linked', 'These tickets are already linked', 'info');
        }

        const newRelationship = {
            ticket_id: relatedTicketId,
            relationship_type: relationshipType,
            created_at: new Date().toISOString()
        };

        const { error } = await _supabase.from('tickets').update({
            related_tickets: [...relationships, newRelationship]
        }).eq('id', currentTicketId);

        if (error) throw error;

        showNotification('Success', 'Tickets linked successfully', 'success');
        
        // Clear search and refresh
        document.getElementById('ticket-search-subject').value = '';
        document.getElementById('search-results-container').innerHTML = '<p class="text-xs text-gray-400">Enter a subject and click Search to find tickets</p>';
        
        await renderExistingRelationships(currentTicketId);
    } catch (err) {
        showNotification('Error', err.message, 'error');
    }
}

async function renderExistingRelationships(ticketId) {
    const relationshipsList = document.getElementById('relationships-list');
    if (!relationshipsList) return;

    const ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === ticketId);
    const relationships = ticket?.related_tickets || [];

    if (relationships.length === 0) {
        relationshipsList.innerHTML = '<p class="text-xs text-gray-400">No linked tickets</p>';
        return;
    }

    relationshipsList.innerHTML = relationships.map(rel => `
        <div class="flex items-center justify-between bg-gray-700/50 p-2 rounded-lg text-sm">
            <span>
                <span class="font-semibold text-indigo-300">#${rel.ticket_id}</span>
                <span class="text-gray-400 ml-2">(${rel.relationship_type})</span>
            </span>
            <button onclick="tickets.removeRelationship(${ticketId}, ${rel.ticket_id})" class="text-red-400 hover:text-red-300 text-xs">Remove</button>
        </div>
    `).join('');
}

export async function addRelationship(ticketId) {
    const relationshipType = document.getElementById('relationship-type').value;
    const relatedTicketId = parseInt(document.getElementById('related-ticket-id').value);

    if (!relatedTicketId || relatedTicketId === ticketId) {
        return showNotification('Invalid', 'Select a different ticket', 'error');
    }

    try {
        // Verify ticket exists
        const { data: relatedTicket, error: fetchError } = await _supabase
            .from('tickets')
            .select('id')
            .eq('id', relatedTicketId)
            .single();

        if (fetchError || !relatedTicket) {
            return showNotification('Not Found', 'Ticket not found', 'error');
        }

        const ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === ticketId);
        const relationships = ticket?.related_tickets || [];

        // Check if already linked
        if (relationships.some(r => r.ticket_id === relatedTicketId)) {
            return showNotification('Already Linked', 'These tickets are already linked', 'info');
        }

        const newRelationship = {
            ticket_id: relatedTicketId,
            relationship_type: relationshipType,
            created_at: new Date().toISOString()
        };

        const { error } = await _supabase.from('tickets').update({
            related_tickets: [...relationships, newRelationship]
        }).eq('id', ticketId);

        if (error) throw error;

        showNotification('Success', 'Tickets linked successfully', 'success');
        document.getElementById('related-ticket-id').value = '';
        await renderExistingRelationships(ticketId);
    } catch (err) {
        showNotification('Error', err.message, 'error');
    }
}

export async function removeRelationship(ticketId, relatedTicketId) {
    try {
        const ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === ticketId);
        const relationships = (ticket?.related_tickets || []).filter(r => r.ticket_id !== relatedTicketId);

        const { error } = await _supabase.from('tickets').update({
            related_tickets: relationships
        }).eq('id', ticketId);

        if (error) throw error;

        await renderExistingRelationships(ticketId);
        showNotification('Removed', 'Relationship deleted', 'success', false);
    } catch (err) {
        showNotification('Error', err.message, 'error');
    }
}



export function renderRelationshipsOnTicket(ticket, linkedTicketsData = {}) {
    if (!ticket.related_tickets || ticket.related_tickets.length === 0) return '';

    const linkedTicketsHTML = ticket.related_tickets.map(rel => {
        const subject = linkedTicketsData[rel.ticket_id] || 'Loading...';
        return `
            <div class="flex items-center justify-between bg-blue-500/10 border border-blue-400/30 p-3 rounded-lg hover:bg-blue-500/20 transition-colors cursor-pointer" onclick="event.stopPropagation(); tickets.navigateToRelatedTicket(${rel.ticket_id})">
                <div class="flex items-start gap-2 flex-grow min-w-0">
                    <div class="flex flex-col gap-1 flex-grow min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="text-blue-300 font-bold">🔗 #${rel.ticket_id}</span>
                            <span class="text-xs text-blue-200 bg-blue-900/30 px-2 py-0.5 rounded">${rel.relationship_type}</span>
                        </div>
                        <p class="text-sm text-blue-100 break-words">${subject}</p>
                    </div>
                </div>
                <span class="text-gray-400 hover:text-gray-300 ml-2">→</span>
            </div>
        `;
    }).join('');

    return `
        <div class="mt-2 pt-2 border-t border-gray-700/50">
            <p class="text-xs font-semibold text-gray-400 mb-2">🔗 Linked Tickets:</p>
            <div class="space-y-2">
                ${linkedTicketsHTML}
            </div>
        </div>
    `;
}

export async function navigateToRelatedTicket(ticketId) {
    try {
        // Find the ticket in any of the lists
        let ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets]
            .find(t => t.id === ticketId);

        if (!ticket) {
            // If not found in current lists, fetch it from database
            const { data, error } = await _supabase
                .from('tickets')
                .select('*')
                .eq('id', ticketId)
                .single();

            if (error) {
                showNotification('Error', 'Could not find related ticket', 'error');
                return;
            }
            ticket = data;
        }

        // Determine which view the ticket belongs to
        let targetView = 'tickets'; // default
        if (ticket.status === 'Done') {
            targetView = 'done';
        } else if (ticket.needs_followup) {
            targetView = 'follow-up';
        }

        // Switch to the correct view if needed
        if (appState.currentView !== targetView) {
            const tabMap = {
                'tickets': 'tab-tickets',
                'done': 'tab-done',
                'follow-up': 'tab-follow-up'
            };
            
            const targetTab = document.getElementById(tabMap[targetView]);
            if (targetTab) {
                showNotification('Switching View', `Navigating to ${targetView} view...`, 'info', false);
                await window.ui.switchView(targetView, targetTab);
                
                // Wait a bit for the view to render
                await new Promise(resolve => setTimeout(resolve, 300));
            }
        }

        // Now scroll to and expand the ticket
        const ticketElement = document.getElementById(`ticket-${ticketId}`);
        if (ticketElement) {
            ticketElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Highlight the ticket briefly
            ticketElement.classList.add('ring-2', 'ring-indigo-500');
            setTimeout(() => {
                ticketElement.classList.remove('ring-2', 'ring-indigo-500');
            }, 2000);

            // Set as expanded and toggle to open it
            appState.expandedTicketId = ticketId;
            
            // Expand the ticket if it's collapsed
            const body = ticketElement.querySelector('.ticket-body');
            if (body && body.classList.contains('hidden')) {
                setTimeout(() => {
                    const header = ticketElement.querySelector('.ticket-header');
                    if (header) {
                        header.click();
                    }
                }, 300);
            }

            showNotification('Found', `Navigated to ticket #${ticketId}`, 'success', false);
        } else {
            showNotification('Not Found', `Ticket #${ticketId} is not visible in the current filters`, 'info');
        }
    } catch (err) {
        console.error('Error navigating to related ticket:', err);
        showNotification('Error', err.message, 'error');
    }
}
export async function fetchLinkedTicketSubjects(relatedTickets) {
    if (!relatedTickets || relatedTickets.length === 0) return {};

    const ticketIds = relatedTickets.map(r => r.ticket_id);
    
    try {
        const { data, error } = await _supabase
            .from('tickets')
            .select('id, subject')
            .in('id', ticketIds);

        if (error) {
            console.error('Error fetching linked tickets:', error);
            return {};
        }

        // Create a map of ticket ID -> subject
        const subjectsMap = {};
        if (data) {
            data.forEach(ticket => {
                subjectsMap[ticket.id] = ticket.subject;
            });
        }
        return subjectsMap;
    } catch (err) {
        console.error('Error in fetchLinkedTicketSubjects:', err);
        return {};
    }
}

// ========== TICKET STARRING (PER-USER FAVORITES) ==========

export async function togglePinTicket(ticketId) {
    try {
        // Check if pin exists - removed .single() which was causing 406 error
        const { data: existingPins, error: checkError } = await _supabase
            .from('ticket_pins')
            .select('id')
            .eq('user_id', appState.currentUser.id)
            .eq('ticket_id', ticketId);

        if (checkError) {
            console.error('Check error:', checkError);
            throw checkError;
        }

        if (existingPins && existingPins.length > 0) {
            // Remove pin
            const { error: deleteError } = await _supabase
                .from('ticket_pins')
                .delete()
                .eq('user_id', appState.currentUser.id)
                .eq('ticket_id', ticketId);

            if (deleteError) throw deleteError;
            showNotification('Unpinned', 'Ticket removed from pinned', 'success', false);
        } else {
            // Add pin
            const { error: insertError } = await _supabase
                .from('ticket_pins')
                .insert({
                    user_id: appState.currentUser.id,
                    ticket_id: ticketId
                });

            // 23505 is unique constraint violation - means already pinned
            if (insertError && insertError.code !== '23505') throw insertError;
            showNotification('Pinned', 'Added to your pinned tickets', 'success', false);
        }

        // Update UI
        updatePinIcon(ticketId);
    } catch (err) {
        console.error('Error toggling pin:', err);
        showNotification('Error', err.message, 'error');
    }
}
export async function updatePinIcon(ticketId) {
    try {
        const { data: pinnedData } = await _supabase
            .from('ticket_pins')
            .select('id')
            .eq('user_id', appState.currentUser.id)
            .eq('ticket_id', ticketId);

        const isPinned = pinnedData && pinnedData.length > 0;

        const pinBtn = document.getElementById(`pin-btn-${ticketId}`);
        if (pinBtn) {
            const svg = pinBtn.querySelector('svg');
            if (svg) {
                if (isPinned) {
                    svg.classList.add('text-red-400', 'fill-current');
                    svg.classList.remove('text-gray-500');
                } else {
                    svg.classList.remove('text-red-400', 'fill-current');
                    svg.classList.add('text-gray-500');
                }
            }
        }
    } catch (err) {
        console.error('Error updating pin icon:', err);
    }
}

export async function fetchUserPinnedTickets() {
    try {
        const { data: pinnedIds } = await _supabase
            .from('ticket_pins')
            .select('ticket_id')
            .eq('user_id', appState.currentUser.id);

        return pinnedIds?.map(s => s.ticket_id) || [];
    } catch (err) {
        console.error('Error fetching pinned tickets:', err);
        return [];
    }
}

// ========== REAL-TIME PRESENCE TRACKING ==========

let presenceChannel = null;
let presenceUpdateInterval = null;

export function initializePresenceTracking() {
    if (presenceChannel) return;

    presenceChannel = _supabase.channel('ticket_presence', {
        config: { broadcast: { self: true }, presence: { key: 'user_presence' } }
    });

    presenceChannel.on('presence', { event: 'sync' }, () => {
        updatePresenceIndicators();
    })
        .on('presence', { event: 'join' }, ({ key, newPresences }) => {
            console.log('User joined:', newPresences);
            updatePresenceIndicators();
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
            console.log('User left:', leftPresences);
            updatePresenceIndicators();
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                console.log('Presence channel subscribed');
            }
        });

    // Update presence heartbeat every 30 seconds
    if (presenceUpdateInterval) clearInterval(presenceUpdateInterval);
    presenceUpdateInterval = setInterval(updatePresenceHeartbeat, 30000);
}

export async function startTrackingTicket(ticketId) {
    try {
        const username = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];

        // Insert/update in database
        const { error } = await _supabase.from('ticket_presence').upsert({
            user_id: appState.currentUser.id,
            ticket_id: ticketId,
            username: username,
            last_active: new Date().toISOString()
        }, { onConflict: 'user_id, ticket_id' });

        if (error) console.error('Error tracking ticket:', error);

        // Broadcast via Supabase Realtime
        if (presenceChannel) {
            presenceChannel.track({
                ticket_id: ticketId,
                user_id: appState.currentUser.id,
                username: username,
                timestamp: new Date().toISOString()
            });
        }

        // Fetch and display active viewers
        await displayActiveViewers(ticketId);
    } catch (err) {
        console.error('Error starting ticket tracking:', err);
    }
}

export async function stopTrackingTicket(ticketId) {
    try {
        const { error } = await _supabase
            .from('ticket_presence')
            .delete()
            .eq('user_id', appState.currentUser.id)
            .eq('ticket_id', ticketId);

        if (error) console.error('Error stopping tracking:', error);

        if (presenceChannel) {
            presenceChannel.untrack();
        }
    } catch (err) {
        console.error('Error stopping ticket tracking:', err);
    }
}

async function updatePresenceHeartbeat() {
    // Update presence for the currently expanded ticket
    if (appState.expandedTicketId) {
        const { error } = await _supabase
            .from('ticket_presence')
            .update({ last_active: new Date().toISOString() })
            .eq('user_id', appState.currentUser.id)
            .eq('ticket_id', appState.expandedTicketId);

        if (error) {
            console.error('Error updating presence heartbeat:', error);
        } else {
            console.log('Presence heartbeat updated for ticket:', appState.expandedTicketId);
        }
    }
}

export async function displayActiveViewers(ticketId) {
    try {
        // Use a fresher timeout - 2 minutes instead of 5
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        
        const { data: viewers, error } = await _supabase
            .from('ticket_presence')
            .select('username, last_active')
            .eq('ticket_id', ticketId)
            .neq('user_id', appState.currentUser.id)
            .gt('last_active', twoMinutesAgo);

        if (error) throw error;

        const indicatorContainer = document.getElementById(`presence-${ticketId}`);
        if (!indicatorContainer) return;

        if (!viewers || viewers.length === 0) {
            indicatorContainer.innerHTML = '';
            return;
        }

        // Sort by most recent activity
        viewers.sort((a, b) => new Date(b.last_active) - new Date(a.last_active));

        indicatorContainer.innerHTML = `
            <div class="flex items-center gap-2 p-2 bg-indigo-500/10 border border-indigo-400/30 rounded-lg animate-pulse">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                <span class="text-xs font-semibold text-indigo-300">
                    ${viewers.map(v => v.username).join(', ')} ${viewers.length === 1 ? 'is' : 'are'} viewing
                </span>
            </div>
        `;
    } catch (err) {
        console.error('Error displaying active viewers:', err);
    }
}

async function updatePresenceIndicators() {
    const ticketElements = document.querySelectorAll('[data-ticket-id]');

    ticketElements.forEach(el => {
        const ticketId = el.dataset.ticketId;
        displayActiveViewers(ticketId);
    });
}


export function cleanupPresenceTracking() {
    if (presenceUpdateInterval) clearInterval(presenceUpdateInterval);
    if (presenceChannel) {
        presenceChannel.unsubscribe();
        presenceChannel.untrack();
    }
    presenceChannel = null;
}


export function setupPresenceCleanup() {
    window.addEventListener('beforeunload', () => {
        // Stop tracking the expanded ticket on page unload
        if (appState.expandedTicketId) {
            // Use sendBeacon for reliability on page unload
            navigator.sendBeacon('/api/presence/cleanup', JSON.stringify({
                user_id: appState.currentUser.id,
                ticket_id: appState.expandedTicketId
            }));
            
            // Also try the regular way
            stopTrackingTicket(appState.expandedTicketId);
        }
    });
}


// NEW FUNCTION TO INTELLIGENTLY HANDLE KUDOS UPDATES
export async function updateKudosCount(ticketId, noteIndex) {
    const kudosKey = `${ticketId}-${noteIndex}`;
    const kudosBtn = document.getElementById(`kudos-btn-${kudosKey}`);
    if (!kudosBtn) return; // Button not on screen

    const { count, error } = await _supabase
        .from('kudos')
        .select('*', { count: 'exact', head: true })
        .eq('ticket_id', ticketId)
        .eq('note_index', noteIndex);

    if (error) {
        console.error("Error fetching kudos count", error);
        return;
    }

    // Update the kudos count text inside the button
    const countSpan = kudosBtn.querySelector('span:last-child');
    if (count > 0) {
        if (countSpan) {
            countSpan.textContent = count;
        } else {
            kudosBtn.insertAdjacentHTML('beforeend', `<span class="text-xs font-bold">${count}</span>`);
        }
    } else {
        if (countSpan) countSpan.remove();
    }
}


export async function addNote(ticketId) {
    const quill = quillInstances.get(ticketId);
    if (!quill) return;

    const text = quill.root.innerHTML;

    if (quill.getLength() <= 1) {
        return showNotification('Empty Note', 'Cannot add an empty note.', 'error');
    }

    try {
        const mentionRegex = /@([\w.-]+)/g;
        const mentionedUsernames = [...text.matchAll(mentionRegex)].map(match => match[1]);
        const mentionedUserIds = [];
        mentionedUsernames.forEach(username => {
            if (appState.allUsers.has(username)) {
                mentionedUserIds.push(appState.allUsers.get(username));
            }
        });

        const { data } = await _supabase.from('tickets').select('notes').eq('id', ticketId).single();

        const newNote = {
            username: appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0],
            user_id: appState.currentUser.id,
            text,
            timestamp: new Date().toISOString(),
            mentioned_user_ids: mentionedUserIds
        };

        const { error } = await _supabase.from('tickets').update({
            notes: [...(data.notes || []), newNote],
            updated_at: new Date().toISOString() // Touch the timestamp to move it to the top
        }).eq('id', ticketId);

        if (error) throw error;

        awardPoints('NOTE_ADDED', { ticketId: ticketId });
        quill.setContents([]);
    } catch (err) {
        showNotification('Error Adding Note', err.message, 'error');
    }
}

export async function deleteNote(ticketId, noteIndex, noteAuthor, noteAuthorId) {
    openConfirmModal('Delete Note', 'Are you sure you want to delete this note?', async () => {
        try {
            awardPoints('NOTE_DELETED', {
                ticketId: ticketId,
                noteAuthor: noteAuthor,
                noteAuthorId: noteAuthorId
            });

            const { data } = await _supabase.from('tickets').select('notes').eq('id', ticketId).single();
            const updatedNotes = [...(data.notes || [])];
            updatedNotes.splice(noteIndex, 1);

            const { error } = await _supabase.from('tickets').update({ notes: updatedNotes }).eq('id', ticketId);
            if (error) throw error;

            logActivity('NOTE_DELETED', { ticket_id: ticketId });
        } catch (err) {
            showNotification('Error Deleting Note', err.message, 'error');
        }
    });
}

// Add this to tickets.js
export async function refreshTicketRelationships(ticketId) {
    try {
        // Fetch latest ticket data
        const { data: updatedTicket, error } = await _supabase
            .from('tickets')
            .select('related_tickets')
            .eq('id', ticketId)
            .single();

        if (error) throw error;

        // Update local state
        const ticketLists = [appState.tickets, appState.doneTickets, appState.followUpTickets];
        for (const list of ticketLists) {
            const ticket = list.find(t => t.id === ticketId);
            if (ticket) {
                ticket.related_tickets = updatedTicket.related_tickets;
                break;
            }
        }

        // Fetch linked ticket subjects
        let linkedSubjectsMap = {};
        if (updatedTicket.related_tickets && updatedTicket.related_tickets.length > 0) {
            linkedSubjectsMap = await fetchLinkedTicketSubjects(updatedTicket.related_tickets);
        }

        // Find the ticket element
        const ticketElement = document.getElementById(`ticket-${ticketId}`);
        if (!ticketElement) return;

        const ticketBody = ticketElement.querySelector('.ticket-body');
        if (!ticketBody) return;

        // Find existing relationships section (it's the one with "Linked Tickets:" text)
        const existingRelSection = Array.from(ticketBody.querySelectorAll('.border-t.border-gray-700\\/50'))
            .find(el => el.textContent.includes('🔗 Linked Tickets:'));
        
        // Create new relationships HTML
        const newRelHTML = renderRelationshipsOnTicket({ 
            id: ticketId, 
            related_tickets: updatedTicket.related_tickets 
        }, linkedSubjectsMap);

        if (existingRelSection && newRelHTML) {
            // Replace existing section
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = newRelHTML;
            existingRelSection.replaceWith(tempDiv.firstElementChild);
        } else if (!existingRelSection && newRelHTML) {
            // Add new section after attachments
            const notesListSection = ticketBody.querySelector(`#notes-list-${ticketId}`)?.parentElement;
            if (notesListSection) {
                notesListSection.insertAdjacentHTML('beforebegin', newRelHTML);
            }
        } else if (existingRelSection && !newRelHTML) {
            // Remove section if no relationships
            existingRelSection.remove();
        }

        // Update the badges in the header
        let badgesContainer = ticketElement.querySelector('.leading-snug > div.flex.flex-wrap.gap-1.ml-1');
        
        if (updatedTicket.related_tickets && updatedTicket.related_tickets.length > 0) {
            const badgesHTML = updatedTicket.related_tickets.map(rel => 
                `<span class="text-xs bg-blue-500/30 text-blue-300 px-2 py-0.5 rounded-full border border-blue-400/50 font-medium cursor-pointer hover:bg-blue-500/50" onclick="event.stopPropagation(); tickets.navigateToRelatedTicket(${rel.ticket_id})" title="${rel.relationship_type}: ${linkedSubjectsMap[rel.ticket_id] || 'Ticket #' + rel.ticket_id}">🔗 #${rel.ticket_id}</span>`
            ).join('');
            
            if (badgesContainer) {
                badgesContainer.innerHTML = badgesHTML;
            } else {
                // Create badges container if it doesn't exist
                const subjectSpan = ticketElement.querySelector('.leading-snug > span');
                if (subjectSpan) {
                    subjectSpan.insertAdjacentHTML('afterend', `<div class="flex flex-wrap gap-1 ml-1">${badgesHTML}</div>`);
                }
            }
        } else if (badgesContainer) {
            // Remove badges container if no relationships
            badgesContainer.remove();
        }
    } catch (err) {
        console.error('Error refreshing ticket relationships:', err);
    }
}

// js/tickets.js

export async function toggleTicketStatus(ticketId, currentStatus) {
    try {
        const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
        const newStatus = currentStatus === 'Done' ? 'In Progress' : 'Done';
        let updatePayload = { status: newStatus };

        let ticket = appState.tickets.find(t => t.id === ticketId) || appState.doneTickets.find(t => t.id === ticketId);
        if (!ticket) {
            const { data } = await _supabase.from('tickets').select('*').eq('id', ticketId).single();
            ticket = data;
        }

        if (!ticket) throw new Error("Ticket not found.");

        if (newStatus === 'Done') {
            if (!ticket.completed_at) {
                updatePayload.completed_at = new Date().toISOString();
            }
            updatePayload.completed_by_name = myName; // Save the name of the user who closed it
            awardPoints('TICKET_CLOSED', { ticketId: ticketId, priority: ticket.priority });
        } else if (newStatus === 'In Progress') {
            updatePayload.is_reopened = true;
            updatePayload.reopened_by_name = myName; // Save the name of the user who re-opened it
            awardPoints('TICKET_REOPENED', { ticketId: ticketId, priority: ticket.priority });
        }

        const { error } = await _supabase.from('tickets').update(updatePayload).eq('id', ticketId);
        if (error) throw error;

        const ticketElement = document.getElementById(`ticket-${ticketId}`);
        if (ticketElement) {
            ticketElement.remove();
        }

        logActivity('STATUS_CHANGED', { ticket_id: ticketId, status: newStatus });
    } catch (err) {
        showNotification('Error', err.message, 'error');
        if (window.main && typeof window.main.applyFilters === 'function') {
            window.main.applyFilters();
        }
    }
}

export async function updateTicket() {
    const id = document.getElementById('edit-ticket-id').value;
    const newSubject = document.getElementById('edit-subject').value;
    const newStatus = document.getElementById('edit-status').value;
    const newPriority = document.getElementById('edit-priority').value;
    const newComplexity = document.getElementById('edit-complexity').value;
    const tagsSelect = document.getElementById('edit-tags');
    const tags = Array.from(tagsSelect.selectedOptions).map(option => option.value);

    try {
        const { data: oldTicket, error: fetchError } = await _supabase
            .from('tickets')
            .select('priority, user_id, username, complexity')
            .eq('id', id)
            .single();

        if (fetchError) throw fetchError;

        if (oldTicket.priority !== newPriority || oldTicket.complexity !== parseInt(newComplexity)) {
            awardPoints('SCORE_ADJUSTED', {
                ticketId: id,
                oldPriority: oldTicket.priority,
                newPriority: newPriority,
                oldComplexity: oldTicket.complexity || 1,
                newComplexity: parseInt(newComplexity)
            }, { userId: oldTicket.user_id, username: oldTicket.username });
        }

        let updatePayload = {
            subject: newSubject,
            status: newStatus,
            priority: newPriority,
            tags,
            complexity: newComplexity
        };

        if (newStatus === 'Done') {
            const { data: ticket } = await _supabase.from('tickets').select('completed_at').eq('id', id).single();
            if (ticket && !ticket.completed_at) {
                updatePayload.completed_at = new Date().toISOString();
            }
        }

        const { error } = await _supabase.from('tickets').update(updatePayload).eq('id', id);
        if (error) throw error;

        closeEditModal();
        logActivity('TICKET_EDITED', { ticket_id: id, subject: newSubject });
    } catch (err) {
        showNotification('Error Updating Ticket', err.message, 'error');
    }
}

export async function assignToMe(ticketId) {
    try {
        const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];

        const { data: ticket, error: fetchError } = await _supabase
            .from('tickets')
            .select('handled_by, username, assigned_to_name, status, priority, created_by, created_at, assigned_at')
            .eq('id', ticketId)
            .single();

        if (fetchError) throw fetchError;

        const referenceTimestamp = ticket.assigned_at || ticket.created_at;

        if (ticket.assigned_to_name !== myName) {
            awardPoints('ASSIGN_TO_SELF', {
                ticketId: ticketId,
                referenceTimestamp: referenceTimestamp
            });
        }

        const currentHandlers = ticket.handled_by || [ticket.username];
        const newHandlers = [...new Set([...currentHandlers, myName])];

        const updatePayload = {
            assigned_to_name: myName,
            status: 'In Progress',
            handled_by: newHandlers,
            assignment_status: 'accepted',
            assigned_at: new Date().toISOString()
        };

        if (ticket.status === 'Done') {
            updatePayload.is_reopened = true;
        }

        const { error: updateError } = await _supabase.from('tickets').update(updatePayload).eq('id', ticketId);
        if (updateError) throw updateError;


        logActivity('TICKET_ASSIGNED', { ticket_id: ticketId, assigned_to: myName });

    } catch (err) {
        showNotification('Error assigning ticket', err.message, 'error');
    }
}

export async function acceptAssignment(ticketId) {
    try {
        const { data: ticket, error: fetchError } = await _supabase.from('tickets').select('assigned_at').eq('id', ticketId).single();
        if (fetchError) throw fetchError;

        if (ticket.assigned_at) {
            const assignedTime = new Date(ticket.assigned_at);
            const now = new Date();
            const diffSeconds = (now - assignedTime) / 1000;

            if (diffSeconds < 120) {
                awardPoints('ACCEPT_ASSIGNMENT_QUICKLY', { ticketId: ticketId, timeToAccept: diffSeconds });
            } else if (diffSeconds > 900) {
                awardPoints('SLOW_ACCEPTANCE', { ticketId: ticketId, timeToAccept: diffSeconds });
            }
        }

        const { error } = await _supabase.from('tickets').update({ assignment_status: 'accepted' }).eq('id', ticketId);
        if (error) throw error;
        showNotification('Accepted', `You've accepted the ticket.`, 'success', false);
    } catch (err) {
        showNotification('Error', 'Could not accept assignment.', 'error');
    }
}

export async function requestReminder(ticketId) {
    const { error } = await _supabase.from('tickets').update({ reminder_requested_at: new Date().toISOString() }).eq('id', ticketId);
    if (error) showNotification('Error', 'Could not set reminder.', 'error');
    else showNotification('Reminder Set', 'The assignee will be reminded.', 'info', false);
}

export async function toggleFollowUp(ticketId, currentState) {
    const { error } = await _supabase.from('tickets').update({ needs_followup: !currentState }).eq('id', ticketId);
    if (error) {
        showNotification('Error', 'Failed to update follow-up status.', 'error');
    } else if (currentState === false) { // Toggled ON
        awardPoints('TICKET_FOLLOWUP_ADDED', { ticketId: ticketId });
        logActivity('FOLLOWUP_ADDED', { ticket_id: ticketId });
    }
}

export async function giveKudos(ticketId, noteIndex, receiverUsername) {
    try {
        const receiverUserId = appState.allUsers.get(receiverUsername);
        if (!receiverUserId) throw new Error("Could not find the user to give kudos to.");

        if (receiverUserId === appState.currentUser.id) {
            showNotification('Info', "You can't give kudos to yourself.", 'info', false);
            return;
        }

        const { error } = await _supabase.from('kudos').insert({
            ticket_id: ticketId,
            note_index: noteIndex,
            giver_user_id: appState.currentUser.id,
            receiver_user_id: receiverUserId
        });

        if (error && error.code !== '23505') throw error;

        awardPoints('KUDOS_RECEIVED', {
            ticketId,
            kudosReceiverId: receiverUserId,
            kudosReceiverUsername: receiverUsername
        });

        logActivity('KUDOS_GIVEN', {
            receiver: receiverUsername,
            ticket_id: ticketId
        });
    } catch (err) {
        if (err.code !== '23505') {
            showNotification('Error', err.message, 'error');
        }
    }
}

export function handleMentionInput(inputElement) {
    const currentText = inputElement.value;
    const mentionQueryIndex = currentText.lastIndexOf('@');

    if (mentionQueryIndex !== -1) {
        const query = currentText.substring(mentionQueryIndex + 1).toLowerCase();
        showMentionDropdown(inputElement, query);
    } else {
        hideMentionDropdowns();
    }
}

export function showMentionDropdown(inputElement, query) {
    const ticketId = inputElement.id.split('-')[2];
    const dropdown = document.getElementById(`mention-dropdown-${ticketId}`);
    if (!dropdown) return;

    const users = Array.from(appState.allUsers.keys()).filter(name => name.toLowerCase().includes(query));

    if (users.length > 0) {
        dropdown.innerHTML = users.map(username =>
            `<div class="mention-item" onmousedown="tickets.selectMention('${inputElement.id}', '${username}')">${username}</div>`
        ).join('');

        dropdown.style.display = 'block';
        dropdown.style.bottom = `${inputElement.offsetHeight + 5}px`;
        dropdown.style.left = `${inputElement.offsetLeft}px`;
        dropdown.style.width = `${inputElement.offsetWidth}px`;
    } else {
        dropdown.style.display = 'none';
    }
}

export function selectMention(inputElementId, username) {
    const inputElement = document.getElementById(inputElementId);
    const currentText = inputElement.value;
    const mentionQueryIndex = currentText.lastIndexOf('@');
    inputElement.value = currentText.substring(0, mentionQueryIndex) + `@${username} `;
    hideMentionDropdowns();
    inputElement.focus();
}

export function hideMentionDropdowns() {
    setTimeout(() => {
        document.querySelectorAll('.mention-dropdown').forEach(d => d.style.display = 'none');
    }, 200);
}

export function checkReminders(currentTicketList) {
    if (!appState.currentUser || !currentTicketList) return;
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];

    currentTicketList.forEach(ticket => {
        if (ticket.assigned_to_name === myName &&
            ticket.assignment_status === 'pending' &&
            ticket.reminder_requested_at &&
            new Date(ticket.reminder_requested_at) <= tenMinutesAgo) {
            showNotification('Reminder!', `Please check ticket: ${ticket.subject}`, 'info', true);
        }
    });
}

export function deleteTicket(ticketId) {
    openConfirmModal('Delete Ticket', 'Are you sure you want to delete this ticket? This will also reverse all points awarded for it.', async () => {
        try {
            const { error: reversalError } = await _supabase.rpc('reverse_points_for_ticket', { ticket_id_param: ticketId });
            if (reversalError) throw reversalError;

            const { error: deleteError } = await _supabase.from('tickets').delete().eq('id', ticketId);
            if (deleteError) throw deleteError;

            logActivity('TICKET_DELETED', { ticket_id: ticketId });
        } catch (error) {
            showNotification('Error Deleting Ticket', error.message, 'error');
        }
    });
}

export async function addAttachment(ticketId, inputElement) {
    const file = inputElement.files[0];
    if (!file) return;

    showLoading();
    try {
        const uploadedFile = await uploadFile(ticketId, file);

        const { data: ticket, error: fetchError } = await _supabase
            .from('tickets')
            .select('attachments')
            .eq('id', ticketId)
            .single();

        if (fetchError) throw fetchError;

        const updatedAttachments = [...(ticket.attachments || []), uploadedFile];

        const { error: updateError } = await _supabase
            .from('tickets')
            .update({
                attachments: updatedAttachments,
                updated_at: new Date().toISOString() // Touch the timestamp to move it to the top
            })
            .eq('id', ticketId);

        if (updateError) throw updateError;

        showNotification('Success', 'File attached successfully.', 'success');
    } catch (error) {
        showNotification('Upload Failed', error.message, 'error');
    } finally {
        hideLoading();
        inputElement.value = '';
    }
}

export async function deleteAttachment(ticketId, filePath) {
    openConfirmModal('Delete Attachment', 'Are you sure you want to permanently delete this file?', async () => {
        try {
            const { error: storageError } = await _supabase.storage
                .from('ticket-attachments')
                .remove([filePath]);

            if (storageError) throw storageError;

            const { data: ticket, error: fetchError } = await _supabase
                .from('tickets')
                .select('attachments')
                .eq('id', ticketId)
                .single();

            if (fetchError) throw fetchError;

            const updatedAttachments = ticket.attachments.filter(att => att.path !== filePath);

            const { error: updateError } = await _supabase
                .from('tickets')
                .update({ attachments: updatedAttachments })
                .eq('id', ticketId);

            if (updateError) throw updateError;

            showNotification('Success', 'Attachment deleted successfully.', 'success');
        } catch (error) {
            showNotification('Error Deleting File', error.message, 'error');
        }
    });
}
