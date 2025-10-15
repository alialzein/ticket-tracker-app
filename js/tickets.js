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
    ui.toggleTicketCollapse(ticketId);
    const unreadDot = document.getElementById(`unread-note-dot-${ticketId}`);
    if (unreadDot && !unreadDot.classList.contains('hidden')) {
        unreadDot.classList.add('hidden');
        const readNotes = JSON.parse(localStorage.getItem('readNotes')) || {};
        readNotes[ticketId] = new Date().toISOString(); // Mark as read now
        localStorage.setItem('readNotes', JSON.stringify(readNotes));
    }
}

// js/tickets.js

export async function prependTicketToView(ticket) {
    let ticketList;
    if (appState.currentView === 'tickets') ticketList = document.getElementById('ticket-list');
    else if (appState.currentView === 'done') ticketList = document.getElementById('done-ticket-list');
    else if (appState.currentView === 'follow-up') ticketList = document.getElementById('follow-up-ticket-list');
    
    if (!ticketList) return;

    // This is a simplified, targeted version of renderTickets for a single element
    const tempContainer = document.createElement('div');
    // We re-use renderTickets by temporarily replacing the main list with a hidden one
    // and telling it to render only our single new ticket.
    const originalContent = ticketList.innerHTML;
    ticketList.innerHTML = '';
    appState.tickets = [ticket]; // Temporarily set the state
    await renderTickets(true);
    const newTicketHTML = ticketList.innerHTML;
    ticketList.innerHTML = originalContent; // Restore the original content

    // Prepend the newly rendered ticket
    ticketList.insertAdjacentHTML('afterbegin', newTicketHTML);

    // Re-initialize the Quill editor for the newly added ticket
    if (document.getElementById(`note-editor-${ticket.id}`) && !quillInstances.has(ticket.id)) {
        const quill = new Quill(`#note-editor-${ticket.id}`, {
            modules: { toolbar: [['bold', 'italic'], [{ 'list': 'ordered' }, { 'list': 'bullet' }], ['code-block']] },
            placeholder: 'Add a note...',
            theme: 'snow'
        });
        quillInstances.set(ticket.id, quill);
    }
}


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

    const fragment = document.createDocumentFragment();
    const readNotes = JSON.parse(localStorage.getItem('readNotes')) || {};

    ticketsToRender.forEach((ticket) => {
        const isDone = ticket.status === 'Done';
        const isMineCreator = appState.currentUser && ticket.created_by === appState.currentUser.id;
        const isAssignedToMe = appState.currentUser && ticket.assigned_to_name === myName;
        const wasReminded = !!ticket.reminder_requested_at;
        const userColor = getUserColor(ticket.username);
        let borderColorClass = 'border-l-4 border-transparent';
        if (ticket.user_id === appState.currentUser.id && !isAssignedToMe) borderColorClass = 'border-l-4 border-indigo-500';
        if (isAssignedToMe) borderColorClass = 'border-l-4 border-purple-500';

        let isCollapsed;
        if (appState.expandedTicketId) {
            isCollapsed = ticket.id !== appState.expandedTicketId;
        } else {
            isCollapsed = true;
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

        const attachmentsHTML = (ticket.attachments && ticket.attachments.length > 0) ? `
            <div class="mt-2 pt-2 border-t border-gray-700/50">
                <h4 class="text-xs font-semibold text-gray-400 mb-2">Attachments:</h4>
                <div class="flex flex-wrap gap-2">
                    ${ticket.attachments.filter(file => file && file.path && file.name).map(file => {
                        const signedUrl = attachmentUrlMap.get(file.path);
                        if (!signedUrl) return '';
                        if (isImage(file.name)) {
                            return `<div class="relative group"><img src="${signedUrl}" alt="${file.name}" class="attachment-thumbnail" onclick="event.stopPropagation(); ui.openImageViewer('${signedUrl}')"><button onclick="event.stopPropagation(); tickets.deleteAttachment(${ticket.id}, '${file.path}')" class="attachment-delete-btn" title="Delete attachment">&times;</button></div>`;
                        } else {
                            return `<div class="flex items-center justify-between bg-gray-700/50 p-2 rounded-md w-full"><a href="${signedUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" class="text-indigo-400 hover:underline text-sm truncate flex-grow">${file.name}</a><button onclick="event.stopPropagation(); tickets.deleteAttachment(${ticket.id}, '${file.path}')" class="text-gray-400 hover:text-red-400 p-1 flex-shrink-0" title="Delete attachment"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button></div>`;
                        }
                    }).join('')}
                </div>
            </div>
        ` : '';

        const notesHTML = (ticket.notes || []).map((note, index) => {
            const sanitizedText = DOMPurify.sanitize(note.text || '');
            const isMyNote = note.user_id === appState.currentUser.id;
            const kudosKey = `${ticket.id}-${index}`;
            const kudosCount = kudosCounts.get(kudosKey) || 0;
            const haveIGivenKudos = kudosIHaveGiven.has(kudosKey);
            let noteContentHtml = `<div class="ql-snow"><div class="ql-editor note-text-display">${sanitizedText}</div></div>`;
            let kudosButtonHtml = '';
            let kudosDisplayHtml = '';
            if (isMyNote) {
                if (kudosCount > 0) {
                    kudosDisplayHtml = `<div class="flex items-center gap-1 text-green-400"><span>👍</span><span class="text-xs font-bold">${kudosCount}</span></div>`;
                }
            } else {
                kudosButtonHtml = `<button id="kudos-btn-${kudosKey}" ${haveIGivenKudos ? '' : `onclick="event.stopPropagation(); tickets.giveKudos(${ticket.id}, ${index}, '${note.username}')"`} class="kudos-btn flex items-center gap-1 text-gray-500 hover:text-green-400 transition-all ${haveIGivenKudos ? 'kudos-given disabled' : ''}" title="${haveIGivenKudos ? 'You gave kudos' : 'Give Kudos'}"><span>👍</span>${kudosCount > 0 ? `<span class="text-xs font-bold">${kudosCount}</span>` : ''}</button>`;
            }
            return `<div class="note-container bg-gray-700/30 p-2 rounded-md border border-gray-600/50 slide-in flex justify-between items-start gap-2"><div class="flex-grow min-w-0"><div class="flex items-center gap-2"><p class="font-semibold text-gray-400 text-xs">${note.username}</p>${kudosButtonHtml} ${kudosDisplayHtml}</div>${noteContentHtml}<p class="text-xs text-gray-500 mt-2">${new Date(note.timestamp).toLocaleString()}</p></div><button onclick="event.stopPropagation(); tickets.deleteNote(${ticket.id}, ${index}, '${note.username}', '${note.user_id || ''}')" class="text-gray-400 hover:text-red-400 transition-colors p-1 opacity-75 hover:opacity-100 flex-shrink-0" title="Delete note"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button></div>`;
        }).join('');

        const warningIconHTML = wasReminded ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-yellow-400 ml-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" title="A reminder was sent for this ticket"><path fill-rule="evenodd" d="M8.257 3.099c.636-1.1 2.29-1.1 2.926 0l6.847 11.982c.636 1.1-.19 2.419-1.463 2.419H2.873c-1.272 0-2.1-1.319-1.463-2.419L8.257 3.099zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>` : '';
        
        ticketElement.innerHTML = `
            <div class="ticket-header flex items-start gap-3 cursor-pointer" onclick="tickets.handleTicketToggle(${ticket.id})">
                <div class="flex-shrink-0 w-10 h-10 rounded-full ${userColor.bg} flex items-center justify-center font-bold text-sm border-2 border-gray-600/50 shadow-md">${ticket.username.substring(0, 2).toUpperCase()}</div>
                <div class="flex-grow min-w-0">
                    <div class="flex justify-between items-center mb-1">
                        <p class="text-xs"><span class="font-bold ${userColor.text}">${ticket.username}</span> ${ticket.assigned_to_name ? `→ <span class="font-bold text-purple-400">${ticket.assigned_to_name}</span>` : ''}</p>
                        <div class="flex items-center gap-2 flex-shrink-0">
                            <span id="unread-note-dot-${ticket.id}" class="h-3 w-3 bg-red-500 rounded-full ${hasUnreadNote ? '' : 'hidden'}"></span>
                            ${reopenFlagHTML}
                            <span class="text-xs font-semibold px-2 py-0.5 rounded-full border ${ticket.source === 'Outlook' ? 'bg-blue-500/20 text-blue-300 border-blue-400/30' : 'bg-purple-500/20 text-purple-300 border-purple-400/30'}">${ticket.source}</span>
                            <span class="priority-badge text-xs font-semibold px-2 py-0.5 rounded-full ${priorityStyle.bg} ${priorityStyle.text}">${priority}</span>
                        </div>
                    </div>
                    <div class="text-white text-sm font-normal mb-2 leading-snug flex items-center">
                        <div class="flex flex-wrap gap-1 mr-2">${tagsHTML}</div>
                        <span>${ticket.subject}</span> 
                        ${warningIconHTML}
                    </div>
                </div>
                 <div class="flex items-center gap-2">
                    <div onclick="event.stopPropagation(); tickets.toggleTicketStatus(${ticket.id}, '${ticket.status}')" class="cursor-pointer text-xs font-semibold py-1 px-3 rounded-full h-fit transition-colors border ${isDone ? 'bg-green-500/20 text-green-300 border-green-400/30 hover:bg-green-500/30' : 'bg-yellow-500/20 text-yellow-300 border-yellow-400/30 hover:bg-yellow-500/30'}">${ticket.status}</div>
                    <button class="ticket-collapse-btn p-1 rounded-full hover:bg-gray-700/50"><svg class="w-4 h-4 transition-transform ${isCollapsed ? '' : 'rotate-180'}" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg></button>
                </div>
            </div>
            <div class="ticket-body ${isCollapsed ? 'hidden' : ''}" onclick="event.stopPropagation()">
                <div class="pt-2 mt-2 border-t border-gray-700/30">
                    ${attachmentsHTML}
                    <div class="space-y-2 mb-2" id="notes-list-${ticket.id}">${notesHTML}</div>
                    <div class="note-container relative">
                        <div id="note-editor-${ticket.id}" class="note-editor"></div>
                         <div class="flex justify-end mt-2"><button onclick="event.stopPropagation(); tickets.addNote(${ticket.id})" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors hover-scale">Add Note</button></div>
                    </div>
                </div>
            </div>
            <div class="mt-2 pt-3 border-t border-gray-700/50 flex justify-between items-center" onclick="event.stopPropagation()">
                 <div class="flex items-center gap-2 text-gray-400 text-xs">
                     <p>Created: ${new Date(ticket.created_at).toLocaleString()}</p>
                     <p class="pl-2 border-l border-gray-600">Updated: ${new Date(ticket.updated_at).toLocaleString()}</p>
                     ${closedByInfoHTML}
                 </div>
                <div class="flex justify-end items-center gap-2">
                    <label for="add-attachment-${ticket.id}" class="cursor-pointer text-gray-400 hover:text-indigo-400 p-2 transition-colors hover-scale" title="Add Attachment" onclick="event.stopPropagation();"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M4.5 3a2.5 2.5 0 0 1 5 0v9a1.5 1.5 0 0 1-3 0V5a.5.5 0 0 1 1 0v7a.5.5 0 0 0 1 0V3a1.5 1.5 0 1 0-3 0v9a2.5 2.5 0 0 0 5 0V5a.5.5 0 0 1 1 0v7a3.5 3.5 0 1 1-7 0V3z"/></svg></label>
                    <input type="file" id="add-attachment-${ticket.id}" class="hidden" onchange="tickets.addAttachment(${ticket.id}, this)">
                    ${isAssignedToMe && ticket.assignment_status === 'pending' ? `<button onclick="event.stopPropagation(); tickets.acceptAssignment(${ticket.id})" class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-xs hover-scale">Accept</button>` : ''}
                    ${ticket.assignment_status === 'accepted' ? `<span class="text-green-400 text-xs font-semibold">Accepted</span>` : ''}
                    ${ticket.assigned_to_name && isMineCreator && ticket.assignment_status !== 'accepted' && !ticket.reminder_requested_at ? `<button onclick="event.stopPropagation(); tickets.requestReminder(${ticket.id})" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded-md text-xs hover-scale">Remind</button>` : ''}
                    <button onclick="event.stopPropagation(); tickets.toggleFollowUp(${ticket.id}, ${ticket.needs_followup})" title="Toggle Follow-up" class="p-1 rounded-full hover:bg-gray-700/50"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${ticket.needs_followup ? 'text-yellow-400 fill-current' : 'text-gray-500'}" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg></button>
                    ${!isAssignedToMe ? `<button onclick="event.stopPropagation(); tickets.assignToMe(${ticket.id})" class="text-gray-400 hover:text-green-400 p-2 transition-colors hover-scale" title="Assign to Me"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/><path fill-rule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0-5.468 11.37C3.242 11.226 4.805 10 8 10s4.757 1.225 5.468 2.37A7 7 0 0 0 8 1z"/></svg></button>` : ''}
                    <button onclick="event.stopPropagation(); ui.openEditModal(${ticket.id})" class="text-gray-400 hover:text-indigo-400 p-2 transition-colors hover-scale" title="Edit Ticket"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/></svg></button>
                    ${ticket.user_id === appState.currentUser.id ? `<button onclick="event.stopPropagation(); tickets.deleteTicket(${ticket.id})" class="text-gray-400 hover:text-red-500 p-2 transition-colors hover-scale" title="Delete Ticket"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>` : ''}
                </div>
            </div>`;
        fragment.appendChild(ticketElement);
    });
    ticketList.appendChild(fragment);

    ticketsToRender.forEach(ticket => {
        if (document.getElementById(`note-editor-${ticket.id}`) && !quillInstances.has(ticket.id)) {
            const quill = new Quill(`#note-editor-${ticket.id}`, {
                modules: { toolbar: [['bold', 'italic'], [{ 'list': 'ordered' }, { 'list': 'bullet' }], ['code-block']] },
                placeholder: 'Add a note...',
                theme: 'snow'
            });
            quillInstances.set(ticket.id, quill);
        }
    });

    if (appState.expandedTicketId) {
        appState.expandedTicketId = null;
    }
}
// js/tickets.js

export async function updateTicketInPlace(updatedTicket) {
    const ticketLists = [appState.tickets, appState.doneTickets, appState.followUpTickets];
    for (const list of ticketLists) {
        const index = list.findIndex(t => t.id === updatedTicket.id);
        if (index !== -1) {
            list[index] = updatedTicket;
            break;
        }
    }

    const ticketElement = document.getElementById(`ticket-${updatedTicket.id}`);
    if (!ticketElement) return;

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

    const subjectSpan = ticketElement.querySelector('.leading-snug > span');
    if (subjectSpan && subjectSpan.textContent !== updatedTicket.subject) {
        subjectSpan.textContent = updatedTicket.subject;
    }

    const statusDiv = ticketElement.querySelector('.cursor-pointer.text-xs.font-semibold');
    if (statusDiv && statusDiv.textContent.trim() !== updatedTicket.status) {
        statusDiv.textContent = updatedTicket.status;
    }
    
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

    const reopenFlag = ticketElement.querySelector('.reopen-flag');
    if (updatedTicket.is_reopened && !reopenFlag) {
        const unreadDot = ticketElement.querySelector(`#unread-note-dot-${updatedTicket.id}`);
        if(unreadDot) {
            const flagHTML = `<span class="reopen-flag text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30" title="Re-opened by ${updatedTicket.reopened_by_name || 'N/A'}">Re-opened</span>`;
            unreadDot.insertAdjacentHTML('afterend', flagHTML);
        }
    } else if (reopenFlag && updatedTicket.reopened_by_name) {
        reopenFlag.title = `Re-opened by ${updatedTicket.reopened_by_name}`;
    } else if (!updatedTicket.is_reopened && reopenFlag) {
        reopenFlag.remove();
    }

    const tagsContainer = ticketElement.querySelector('.leading-snug .flex-wrap');
    if (tagsContainer) {
        const newTagsHTML = (updatedTicket.tags || []).map(tag => `<span class="bg-gray-600/50 text-gray-300 text-xs font-semibold px-2 py-0.5 rounded-full border border-gray-500">${tag}</span>`).join('');
        tagsContainer.innerHTML = newTagsHTML;
    }

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

    const ticketList = ticketElement.parentElement;
    if (ticketList) {
        ticketList.prepend(ticketElement);
    }
}
// Helper function to generate HTML for a single note
function createNoteHTML(note, ticketId, index) {
    const sanitizedText = DOMPurify.sanitize(note.text || '');
    const isMyNote = note.user_id === appState.currentUser.id;
    // Note: Kudos data isn't easily available here without another DB call.
    // For a non-refreshing UI, kudos would need its own dedicated real-time update.
    return `
    <div class="note-container bg-gray-700/30 p-2 rounded-md border border-gray-600/50 slide-in flex justify-between items-start gap-2">
        <div class="flex-grow min-w-0"> 
            <div class="flex items-center gap-2">
                <p class="font-semibold text-gray-400 text-xs">${note.username}</p>
            </div>
            <div class="ql-snow"><div class="ql-editor note-text-display">${sanitizedText}</div></div>
            <p class="text-xs text-gray-500 mt-2">${new Date(note.timestamp).toLocaleString()}</p>
        </div>
        ${isMyNote ? `<button onclick="event.stopPropagation(); tickets.deleteNote(${ticketId}, ${index}, '${note.username}', '${note.user_id || ''}')" class="text-gray-400 hover:text-red-400 transition-colors p-1 opacity-75 hover:opacity-100 flex-shrink-0" title="Delete note">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg>
        </button>` : ''}
    </div>`;
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
        if(countSpan) countSpan.remove();
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
    if(!dropdown) return;

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
