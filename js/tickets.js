// js/tickets.js

import { _supabase } from './config.js';
import { appState, getCachedAttachmentUrl, setCachedAttachmentUrl, invalidateTicketCache } from './state.js';
import { showNotification, openEditModal, openConfirmModal, hideLoading, showLoading, getUserColor, closeEditModal } from './ui.js';
import { awardPoints, logActivity } from './main.js';
import { getUserSettingsByName, getColoredUserName, getUserAvatarByUsername, getBatchUserSettingsByUsername, getColoredUserNameFromCache, getUserAvatarFromCache } from './userSettings.js';
import { compressImage, getCompressionPresets } from './imageCompression.js';

// ========== CONSTANTS ==========
export const PRIORITY_STYLES = { 'Urgent': { bg: 'bg-red-500', text: 'text-white' }, 'High': { bg: 'bg-orange-500', text: 'text-white' }, 'Medium': { bg: 'bg-yellow-500', text: 'text-gray-900' }, 'Low': { bg: 'bg-green-500', text: 'text-white' } };

// Timing constants (in milliseconds)
const PRESENCE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const PRESENCE_HEARTBEAT_INTERVAL_MS = 30000; // 30 seconds
const REMINDER_CHECK_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const QUICK_ACCEPT_THRESHOLD_SEC = 120; // 2 minutes
const SLOW_ACCEPT_THRESHOLD_SEC = 900; // 15 minutes
const TYPING_INDICATOR_TIMEOUT_MS = 3000; // 3 seconds - how long to wait before stopping typing indicator
const TYPING_INDICATOR_POLL_INTERVAL_MS = 2000; // 2 seconds - how often to poll for typing indicators

// Map to store Quill editor instances for each ticket
const quillInstances = new Map();

// Typing indicator state
let typingTimeout = null;
let currentTypingLocation = null;
let typingIndicatorPollInterval = null;

// ========== HELPER FUNCTIONS ==========

/**
 * Get the current user's SYSTEM username (email-based, never changes)
 * This is used for database queries, ticket ownership, stats, etc.
 * DO NOT use this for UI display - use display_name from user_settings instead
 */
function getCurrentUsername() {
    // Always return email-based username for system operations
    // This ensures consistency even if user changes their display name
    return appState.currentUser.email.split('@')[0];
}

/**
 * Initialize a Quill editor instance with mention system
 */
function initializeQuillEditor(elementId, placeholder = 'Add a note...') {
    const element = document.getElementById(elementId);
    if (!element || quillInstances.has(elementId)) return null;

    const quill = new Quill(`#${elementId}`, {
        modules: {
            toolbar: [['bold', 'italic'], [{ 'list': 'ordered' }, { 'list': 'bullet' }], ['code-block']]
        },
        placeholder,
        theme: 'snow'
    });
    quillInstances.set(elementId, quill);

    // Extract ticket ID from element ID (e.g., "note-editor-123" -> 123)
    const ticketIdMatch = elementId.match(/note-editor-(\d+)/);
    if (ticketIdMatch) {
        const ticketId = parseInt(ticketIdMatch[1]);
        initializeMentionSystem(quill, ticketId);
    }

    return quill;
}

/**
 * Generate "Closed by" information HTML
 */
function generateClosedByInfoHTML(ticket) {
    if (!ticket.completed_by_name) return '';

    const label = ticket.status === 'Done' ? 'Closed by:' : 'Last closed by:';

    // Build tooltip with close reason
    let tooltipText = '';
    if (ticket.close_reason) {
        tooltipText = `Reason: ${ticket.close_reason}`;
        if (ticket.close_reason_details) {
            tooltipText += `\n${ticket.close_reason_details}`;
        }
        tooltipText += `\nClosed on: ${new Date(ticket.completed_at).toLocaleString()}`;
    } else {
        tooltipText = `Closed on: ${new Date(ticket.completed_at).toLocaleString()}`;
    }

    return `<p class="status-change-info pl-2 border-l border-gray-600 cursor-help" title="${tooltipText}">${label} ${ticket.completed_by_name}</p>`;
}

/**
 * Check if filename is an image
 */
function isImageFile(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(extension);
}

/**
 * Generate attachments HTML for a ticket
 */
function generateAttachmentsHTML(ticket, attachmentUrlMap) {
    if (!ticket.attachments || ticket.attachments.length === 0) return '';

    const attachmentsItems = ticket.attachments
        .filter(file => file && file.path && file.name)
        .map(file => {
            const signedUrl = attachmentUrlMap.get(file.path);
            if (!signedUrl) return '';

            if (isImageFile(file.name)) {
                return `<div class="relative group">
                    <img src="${signedUrl}" alt="${file.name}" class="attachment-thumbnail" onclick="event.stopPropagation(); ui.openImageViewer('${signedUrl}')">
                    <button onclick="event.stopPropagation(); tickets.deleteAttachment(${ticket.id}, '${file.path}')" class="attachment-delete-btn" title="Delete attachment">&times;</button>
                </div>`;
            } else {
                return `<div class="flex items-center justify-between bg-gray-700/50 p-2 rounded-md w-full">
                    <a href="${signedUrl}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();" class="text-indigo-400 hover:underline text-sm truncate flex-grow">${file.name}</a>
                    <button onclick="event.stopPropagation(); tickets.deleteAttachment(${ticket.id}, '${file.path}')" class="text-gray-400 hover:text-red-400 p-1 flex-shrink-0" title="Delete attachment">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                    </button>
                </div>`;
            }
        })
        .join('');

    if (!attachmentsItems) return '';

    return `<div class="mt-2 pt-2 border-t border-gray-700/50">
        <h4 class="text-xs font-semibold text-gray-400 mb-2">Attachments:</h4>
        <div class="flex flex-wrap gap-2">${attachmentsItems}</div>
    </div>`;
}

/**
 * Get border color class based on ticket ownership
 */
function getBorderColorClass(ticket, isAssignedToMe) {
    if (isAssignedToMe) return 'border-l-4 border-purple-500';
    if (ticket.user_id === appState.currentUser.id) return 'border-l-4 border-indigo-500';
    return 'border-l-4 border-transparent';
}

/**
 * Check if ticket has unread notes
 */
function hasUnreadNotes(ticket, readNotes) {
    const lastNote = ticket.notes && ticket.notes.length > 0 ? ticket.notes[ticket.notes.length - 1] : null;
    if (!lastNote || lastNote.user_id === appState.currentUser.id) return false;

    const lastReadTimestamp = readNotes[ticket.id];
    return !lastReadTimestamp || new Date(lastNote.timestamp) > new Date(lastReadTimestamp);
}

// Helper function to handle file uploads to Supabase Storage
async function uploadFile(ticketId, file) {
    if (!file) return null;

    // ⚡ OPTIMIZATION: Compress images before upload to reduce storage and egress
    let fileToUpload = file;
    const originalSize = (file.size / 1024 / 1024).toFixed(2);

    if (file.type.startsWith('image/')) {
        console.log(`[Upload] Compressing image: ${file.name} (${originalSize} MB)`);

        // Use attachment preset for ticket attachments
        const preset = getCompressionPresets().attachment;
        fileToUpload = await compressImage(file, preset);

        const compressedSize = (fileToUpload.size / 1024 / 1024).toFixed(2);
        const reduction = ((1 - fileToUpload.size / file.size) * 100).toFixed(1);
        console.log(`[Upload] Compressed: ${compressedSize} MB (${reduction}% reduction)`);
    }

    const fileExt = fileToUpload.name.split('.').pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const filePath = `${appState.currentUser.id}/${ticketId}/${fileName}`;

    const { error: uploadError } = await _supabase.storage
        .from('ticket-attachments')
        .upload(filePath, fileToUpload);

    if (uploadError) throw uploadError;

    return {
        name: file.name, // Keep original name for display
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

        const username = getCurrentUsername();
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

        awardPoints('TICKET_OPENED', { ticketId: newTicket.id, priority: priority, subject: newTicket.subject });
        logActivity('TICKET_CREATED', { ticket_id: newTicket.id, subject: newTicket.subject });

        // Check Sniper badge (consecutive ticket creation)
        if (window.badges && window.badges.checkSniperBadge) {
            window.badges.checkSniperBadge(
                appState.currentUser.id,
                username
            );
        }

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

    // ⚡ OPTIMIZATION: Check cache before fetching
    // If we have recent data and it's not a forced new fetch, use cached data
    const now = Date.now();
    const cacheAge = appState.cache.lastTicketsFetch ? now - appState.cache.lastTicketsFetch : Infinity;
    const isLoadMore = !isNew;

    // Check if any filter has changed
    const currentSearchTerm = searchInput.value.trim();
    const currentPeriodFilter = periodSelect.value;
    const currentUserFilter = document.getElementById('filter-user')?.value || '';
    const currentSourceFilter = document.getElementById('filter-source')?.value || '';
    const currentPriorityFilter = document.getElementById('filter-priority')?.value || '';
    const currentTagFilter = document.getElementById('filter-tag')?.value || '';

    const anyFilterChanged =
        appState.cache.lastSearchTerm !== currentSearchTerm ||
        appState.cache.lastPeriodFilter !== currentPeriodFilter ||
        appState.cache.lastView !== appState.currentView ||
        appState.cache.lastUserFilter !== currentUserFilter ||
        appState.cache.lastSourceFilter !== currentSourceFilter ||
        appState.cache.lastPriorityFilter !== currentPriorityFilter ||
        appState.cache.lastTagFilter !== currentTagFilter;

    // Determine which data array to check based on current view
    const isDoneView = appState.currentView === 'done';
    const isFollowUpView = appState.currentView === 'follow-up';
    let relevantDataLength = 0;

    if (isDoneView) {
        relevantDataLength = appState.doneTickets.length;
    } else if (isFollowUpView) {
        relevantDataLength = appState.followUpTickets.length;
    } else {
        relevantDataLength = appState.tickets.length;
    }

    // Use cache only if: fresh data + no filter changes + has data
    if (isNew && cacheAge < appState.cache.TICKETS_CACHE_TTL && relevantDataLength > 0 && !anyFilterChanged) {
        console.log('[Tickets] Using cached data for', appState.currentView, 'view (age:', Math.round(cacheAge / 1000), 'seconds)');
        await renderTickets(true); // Pass true to ensure DOM is cleared
        hideLoading();
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

        // ⚡ OPTIMIZATION: Select only needed columns to reduce egress by ~60%
        // Only fetch essential columns, not entire ticket objects
        const essentialColumns = 'id,subject,status,priority,source,username,assigned_to_name,created_by,created_at,updated_at,needs_followup,tags,notes,related_tickets,is_reopened,reopened_by_name,completed_by_name,completed_at,close_reason,close_reason_details,reminder_requested_at,attachments,handled_by';

        let query;
        if (isFollowUpView) {
            query = _supabase.from('tickets').select(essentialColumns).eq('needs_followup', true);
            query = query.gte('updated_at', startDate.toISOString());
        } else {
            const statusToFetch = isDoneView ? 'Done' : 'In Progress';
            query = _supabase.from('tickets').select(essentialColumns).eq('status', statusToFetch);
            query = query.gte('updated_at', startDate.toISOString());
        }

        // Apply database filters first (except search which includes notes)
        const userFilter = document.getElementById('filter-user').value;
        if (userFilter) query = query.or(`username.eq.${userFilter},assigned_to_name.eq.${userFilter}`);
        const sourceFilter = document.getElementById('filter-source').value;
        if (sourceFilter) query = query.eq('source', sourceFilter);
        const priorityFilter = document.getElementById('filter-priority').value;
        if (priorityFilter) query = query.eq('priority', priorityFilter);
        const tagFilter = document.getElementById('filter-tag').value;
        if (tagFilter) query = query.contains('tags', `["${tagFilter}"]`);

        query = query.order('updated_at', { ascending: false });

        // If there's a search term, we need to fetch more records to filter client-side
        // because we're searching in notes (JSONB) which can't be done server-side easily
        if (searchTerm) {
            // Fetch more records than needed for pagination since we'll filter client-side
            query = query.range(0, (pageToFetch + 3) * appState.TICKETS_PER_PAGE - 1);
        } else {
            query = query.range(pageToFetch * appState.TICKETS_PER_PAGE, (pageToFetch + 1) * appState.TICKETS_PER_PAGE - 1);
        }

        const { data, error } = await query;
        if (error) throw error;

        // Client-side search filter for subject and notes
        let filteredData = data;
        if (searchTerm && data) {
            const searchLower = searchTerm.toLowerCase();

            // Helper function to strip HTML tags from note body
            const stripHtml = (html) => {
                if (!html) return '';
                const tmp = document.createElement('div');
                tmp.innerHTML = html;
                return tmp.textContent || tmp.innerText || '';
            };

            filteredData = data.filter(ticket => {
                // Search in subject
                if (ticket.subject && ticket.subject.toLowerCase().includes(searchLower)) {
                    return true;
                }
                // Search in notes (text field may contain HTML from Quill editor)
                if (ticket.notes && Array.isArray(ticket.notes)) {
                    const foundInNotes = ticket.notes.some((note) => {
                        // Notes use "text" field, not "body"
                        if (!note.text) return false;
                        // Search in both raw HTML and stripped text
                        const textLower = note.text.toLowerCase();
                        const textContent = stripHtml(note.text).toLowerCase();
                        const match = textLower.includes(searchLower) || textContent.includes(searchLower);
                        return match;
                    });
                    if (foundInNotes) return true;
                }
                return false;
            });

            // Apply pagination to filtered results
            const start = pageToFetch * appState.TICKETS_PER_PAGE;
            const end = start + appState.TICKETS_PER_PAGE;
            filteredData = filteredData.slice(start, end);
        }

        // ⚡ OPTIMIZATION: Update cache timestamp and all filter states after successful fetch
        if (isNew) {
            appState.cache.lastTicketsFetch = Date.now();
            appState.cache.lastSearchTerm = currentSearchTerm;
            appState.cache.lastPeriodFilter = currentPeriodFilter;
            appState.cache.lastView = appState.currentView;
            appState.cache.lastUserFilter = currentUserFilter;
            appState.cache.lastSourceFilter = currentSourceFilter;
            appState.cache.lastPriorityFilter = currentPriorityFilter;
            appState.cache.lastTagFilter = currentTagFilter;
        }

        if (isFollowUpView) {
            appState.followUpTickets = filteredData || [];
        } else if (filteredData && filteredData.length > 0) {
            if (isDoneView) {
                if (isNew) {
                    // Deduplicate even on new fetch (in case of rapid filter changes)
                    const uniqueTickets = Array.from(new Map(filteredData.map(t => [t.id, t])).values());
                    appState.doneTickets = uniqueTickets;
                    appState.doneCurrentPage = 0;
                } else {
                    // Deduplicate by ticket ID before appending
                    const existingIds = new Set(appState.doneTickets.map(t => t.id));
                    const newTickets = filteredData.filter(t => !existingIds.has(t.id));
                    appState.doneTickets.push(...newTickets);
                }
                appState.doneCurrentPage++;
                const loadMoreBtn = document.getElementById('load-more-btn-done');
                if (loadMoreBtn) {
                    if (filteredData.length === appState.TICKETS_PER_PAGE) {
                        loadMoreBtn.classList.remove('hidden');
                        loadMoreBtn.style.display = 'inline-block';
                    } else {
                        loadMoreBtn.classList.add('hidden');
                        loadMoreBtn.style.display = 'none';
                    }
                }
            } else {
                if (isNew) {
                    // Deduplicate even on new fetch (in case of rapid filter changes)
                    const uniqueTickets = Array.from(new Map(filteredData.map(t => [t.id, t])).values());
                    appState.tickets = uniqueTickets;
                    appState.currentPage = 0;
                } else {
                    // Deduplicate by ticket ID before appending
                    const existingIds = new Set(appState.tickets.map(t => t.id));
                    const newTickets = filteredData.filter(t => !existingIds.has(t.id));
                    appState.tickets.push(...newTickets);
                }
                appState.currentPage++;
                const loadMoreBtn = document.getElementById('load-more-btn');
                if (loadMoreBtn) {
                    if (filteredData.length === appState.TICKETS_PER_PAGE) {
                        loadMoreBtn.classList.remove('hidden');
                        loadMoreBtn.style.display = 'inline-block';
                    } else {
                        loadMoreBtn.classList.add('hidden');
                        loadMoreBtn.style.display = 'none';
                    }
                }
            }
        } else {
            if (isNew) {
                if (isDoneView) { appState.doneTickets = []; } else { appState.tickets = []; }
            }
            const loadMoreBtnDone = document.getElementById('load-more-btn-done');
            const loadMoreBtn = document.getElementById('load-more-btn');
            if (isDoneView && loadMoreBtnDone) {
                loadMoreBtnDone.classList.add('hidden');
                loadMoreBtnDone.style.display = 'none';
            } else if (loadMoreBtn) {
                loadMoreBtn.classList.add('hidden');
                loadMoreBtn.style.display = 'none';
            }
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

// Add this new function
export function markNotesAsRead(ticketId) {
    const ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets]
        .find(t => t.id === ticketId);
    
    if (!ticket || !ticket.notes || ticket.notes.length === 0) return;

    // Get the timestamp of the latest note
    const latestNote = ticket.notes[ticket.notes.length - 1];
    
    // Update localStorage with the read timestamp
    const readNotes = JSON.parse(localStorage.getItem('readNotes')) || {};
    readNotes[ticketId] = latestNote.timestamp;
    localStorage.setItem('readNotes', JSON.stringify(readNotes));

    // Remove the red dot from UI
    const unreadDot = document.getElementById(`unread-note-dot-${ticketId}`);
    if (unreadDot) {
        unreadDot.classList.add('hidden');
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

        // Mark notes as read when ticket is expanded
        markNotesAsRead(ticketId);

        // Render reactions for all notes when expanding
        const ticketData = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === ticketId);
        if (ticketData && ticketData.notes) {
            ticketData.notes.forEach((note, index) => {
                renderNoteReactions(ticketId, index);
            });
        }

        // Start tracking presence
        if (window.tickets && window.tickets.startTrackingTicket) {
            window.tickets.startTrackingTicket(ticketId);
        }
    } else {
        // Collapsing - clear active ticket
        appState.expandedTicketId = null;
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
    const myName = getCurrentUsername();
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

    // Fetch user settings for custom name colors and avatar
    const creatorSettings = await getUserSettingsByName(ticket.username);
    const creatorColoredName = await getColoredUserName(ticket.username);
    const creatorAvatarHTML = await getUserAvatarByUsername(ticket.username, 'w-10 h-10');
    const assignedColoredName = ticket.assigned_to_name ? await getColoredUserName(ticket.assigned_to_name) : '';

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
    const borderColorClass = getBorderColorClass(ticket, isAssignedToMe);

    // Default to collapsed unless explicitly set to expand
    const isCollapsed = ticket.id !== appState.expandedTicketId;

    const hasUnreadNote = hasUnreadNotes(ticket, readNotes);

    const ticketElement = document.createElement('div');
    ticketElement.id = `ticket-${ticket.id}`;
    ticketElement.dataset.ticketId = ticket.id; // Consistent data attribute
    // Removed dataset.activeTicketId as it was potentially conflicting
    ticketElement.className = `ticket-card glassmorphism rounded-lg p-3 shadow-md flex flex-col gap-2 transition-all hover:bg-gray-700/30 fade-in ${isDone ? 'opacity-60' : ''} ${borderColorClass}`;

    const priority = ticket.priority || 'Medium';
    const priorityStyle = PRIORITY_STYLES[priority];
    const tagsHTML = (ticket.tags || []).map(tag => `<span class="bg-gray-600/50 text-gray-300 text-xs font-semibold px-2 py-0.5 rounded-full border border-gray-500">${tag}</span>`).join('');
    const reopenFlagHTML = ticket.is_reopened ? `<span class="reopen-flag text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30" title="Re-opened by ${ticket.reopened_by_name || 'N/A'}">Re-opened</span>` : '';

    const closedByInfoHTML = generateClosedByInfoHTML(ticket);
    const attachmentsHTML = generateAttachmentsHTML(ticket, attachmentUrlMap);
    
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
            <div class="flex-shrink-0">${creatorAvatarHTML}</div>
            <div class="flex-grow min-w-0">
                <div class="flex justify-between items-center mb-1">
                     <p class="text-xs">
                        <span class="font-bold text-indigo-300">#${ticket.id}</span>
                        <span class="ml-2">${creatorColoredName}</span>
                        <span class="assignment-info">${ticket.assigned_to_name ? `→ ${assignedColoredName}` : ''}</span>
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
            <div class="pt-2 mt-2 border-t border-gray-700/30">${attachmentsHTML}${relationshipsHTML}<div class="max-h-96 overflow-y-auto pr-2 mb-2" style="scrollbar-width: thin;">
    <div class="space-y-2" id="notes-list-${ticket.id}">${notesHTML}</div>
</div><div class="note-container relative"><div id="note-editor-${ticket.id}" class="note-editor"></div><div class="flex justify-end mt-2"><button onclick="event.stopPropagation(); tickets.addNote(${ticket.id})" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors hover-scale">Add Note</button></div></div></div>
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
                <button onclick="event.stopPropagation(); tickets.toggleFollowUp(${ticket.id}, ${ticket.needs_followup})" title="Toggle Follow-up" class="p-1 rounded-full hover:bg-gray-700/50"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${ticket.needs_followup ? 'text-yellow-400 fill-current' : 'text-gray-500'}" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg></button>
<button onclick="event.stopPropagation(); tickets.openRelationshipModal(${ticket.id})" title="Link Related Tickets" class="p-1 rounded-full hover:bg-gray-700/50 text-gray-400 hover:text-indigo-400">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
        <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
    </svg>
</button>               
 <button onclick="event.stopPropagation(); tickets.togglePinTicket(${ticket.id})" title="Pin Ticket" class="p-1 rounded-full hover:bg-gray-700/50 transition-colors" id="pin-btn-${ticket.id}"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${isPinned ? 'text-red-400 fill-current' : 'text-gray-500'}" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5.951-1.429 5.951 1.429a1 1 0 001.169-1.409l-7-14z" /></svg></button>
              ${!isAssignedToMe ? `<button onclick="event.stopPropagation(); tickets.assignToMe(${ticket.id})" class="text-gray-400 hover:text-green-400 p-2 transition-colors hover-scale" title="Assign to Me"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/><path fill-rule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0-5.468 11.37C3.242 11.226 4.805 10 8 10s4.757 1.225 5.468 2.37A7 7 0 0 0 8 1z"/></svg></button>` : ''}
                <button onclick="event.stopPropagation(); ui.openEditModal(${ticket.id})" class="text-gray-400 hover:text-indigo-400 p-2 transition-colors hover-scale" title="Edit Ticket"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/></svg></button>
                ${(ticket.user_id === appState.currentUser.id || appState.currentUserRole === 'admin' || appState.currentUserRole === 'visitor_admin') ? `<button onclick="event.stopPropagation(); tickets.deleteTicket(${ticket.id})" class="text-gray-400 hover:text-red-500 p-2 transition-colors hover-scale" title="Delete Ticket"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>` : ''}
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

    // Initialize reactions for all notes
    (ticket.notes || []).forEach((note, index) => {
        renderNoteReactions(ticket.id, index);
    });

    // Initialize Quill editor for the note input
    initializeQuillEditor(`note-editor-${ticket.id}`, 'Add a note...');
}


// js/tickets.js



// ========== FUNCTION 2: renderTickets ==========
// Modified to fetch linked subjects upfront
export async function renderTickets(isNew = false) {
    let ticketData, ticketList;
    const myName = getCurrentUsername();
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

    // ⚡ OPTIMIZATION: Use cached attachment URLs and only fetch uncached ones
    const allAttachmentPaths = ticketsToRender
        .flatMap(ticket => ticket.attachments || [])
        .filter(file => file && file.path)
        .map(file => file.path);

    // Check cache first
    const uncachedPaths = [];
    allAttachmentPaths.forEach(path => {
        const cachedUrl = getCachedAttachmentUrl(path);
        if (cachedUrl) {
            attachmentUrlMap.set(path, cachedUrl);
        } else {
            uncachedPaths.push(path);
        }
    });

    // Only fetch uncached attachment URLs - reduces egress by ~20%
    if (uncachedPaths.length > 0) {
        const { data, error } = await _supabase.storage.from('ticket-attachments').createSignedUrls(uncachedPaths, 3600);
        if (error) {
            console.error("Error creating signed URLs:", error);
        }
        if (data) {
            data.forEach((urlData, index) => {
                if (urlData.signedUrl) {
                    const path = uncachedPaths[index];
                    attachmentUrlMap.set(path, urlData.signedUrl);
                    // Cache for 1 hour (3600 seconds)
                    setCachedAttachmentUrl(path, urlData.signedUrl, 3600);
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

    // BATCH FETCH USER SETTINGS FOR ALL UNIQUE USERS (PERFORMANCE OPTIMIZATION)
    const allUsernames = new Set();
    ticketsToRender.forEach(ticket => {
        if (ticket.username) allUsernames.add(ticket.username);
        if (ticket.assigned_to_name) allUsernames.add(ticket.assigned_to_name);
    });

    // Fetch all user settings in ONE query
    const userSettingsMap = await getBatchUserSettingsByUsername(Array.from(allUsernames));

    const fragment = document.createDocumentFragment();
    const readNotes = JSON.parse(localStorage.getItem('readNotes')) || {};

    // Use for loop for efficiency
    for (const ticket of ticketsToRender) {
        const isDone = ticket.status === 'Done';
        const isMineCreator = appState.currentUser && ticket.created_by === appState.currentUser.id;
        const isAssignedToMe = appState.currentUser && ticket.assigned_to_name === myName;
        const wasReminded = !!ticket.reminder_requested_at;
        const userColor = getUserColor(ticket.username);

        // Get user settings from cached map (NO database query!)
        const creatorSettings = userSettingsMap.get(ticket.username);
        const creatorColoredName = getColoredUserNameFromCache(ticket.username, creatorSettings);
        const creatorAvatarHTML = getUserAvatarFromCache(ticket.username, creatorSettings, 'w-10 h-10');

        const assignedSettings = ticket.assigned_to_name ? userSettingsMap.get(ticket.assigned_to_name) : null;
        const assignedColoredName = ticket.assigned_to_name ? getColoredUserNameFromCache(ticket.assigned_to_name, assignedSettings) : '';

        const borderColorClass = getBorderColorClass(ticket, isAssignedToMe);

        let isCollapsed = true;
        if (appState.expandedTicketId && ticket.id === appState.expandedTicketId) {
            isCollapsed = false;
        }

        const hasUnreadNote = hasUnreadNotes(ticket, readNotes);

        const ticketElement = document.createElement('div');
        ticketElement.id = `ticket-${ticket.id}`;
        ticketElement.dataset.ticketId = ticket.id;
        ticketElement.className = `ticket-card glassmorphism rounded-lg p-3 shadow-md flex flex-col gap-2 transition-all hover:bg-gray-700/30 fade-in ${isDone ? 'opacity-60' : ''} ${borderColorClass}`;

        const priority = ticket.priority || 'Medium';
        const priorityStyle = PRIORITY_STYLES[priority];
        const tagsHTML = (ticket.tags || []).map(tag => `<span class="bg-gray-600/50 text-gray-300 text-xs font-semibold px-2 py-0.5 rounded-full border border-gray-500">${tag}</span>`).join('');

        const reopenFlagHTML = ticket.is_reopened ? `<span class="reopen-flag text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/30" title="Re-opened by ${ticket.reopened_by_name || 'N/A'}">Re-opened</span>` : '';

        const closedByInfoHTML = generateClosedByInfoHTML(ticket);
        const attachmentsHTML = generateAttachmentsHTML(ticket, attachmentUrlMap);

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
    <div class="flex-shrink-0">${creatorAvatarHTML}</div>
    <div class="flex-grow min-w-0">
        <div class="flex justify-between items-center mb-1">
            <p class="text-xs">
                <span class="font-bold text-indigo-300">#${ticket.id}</span>
                <span class="ml-2">${creatorColoredName}</span>
                <span class="assignment-info">${ticket.assigned_to_name ? `→ ${assignedColoredName}` : ''}</span>
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
    <div class="pt-2 mt-2 border-t border-gray-700/30">${attachmentsHTML}${renderRelationshipsOnTicket(ticket, linkedTicketsDataMap)}<div class="max-h-96 overflow-y-auto pr-2 mb-2" style="scrollbar-width: thin;">
    <div class="space-y-2" id="notes-list-${ticket.id}">${notesHTML}</div>
</div><div class="note-container relative"><div id="note-editor-${ticket.id}" class="note-editor"></div><div class="flex justify-end mt-2"><button onclick="event.stopPropagation(); tickets.addNote(${ticket.id})" class="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold py-2 px-4 rounded-lg transition-colors hover-scale">Add Note</button></div></div></div>
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
        <button onclick="event.stopPropagation(); tickets.toggleFollowUp(${ticket.id}, ${ticket.needs_followup})" title="Toggle Follow-up" class="p-1 rounded-full hover:bg-gray-700/50"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${ticket.needs_followup ? 'text-yellow-400 fill-current' : 'text-gray-500'}" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg></button>
<button onclick="event.stopPropagation(); tickets.openRelationshipModal(${ticket.id})" title="Link Related Tickets" class="p-1 rounded-full hover:bg-gray-700/50 text-gray-400 hover:text-indigo-400">
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
        <path d="M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z"/>
        <path d="M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243L6.586 4.672z"/>
    </svg>
</button>       
 <button onclick="event.stopPropagation(); tickets.togglePinTicket(${ticket.id})" title="Pin Ticket" class="p-1 rounded-full hover:bg-gray-700/50 transition-colors" id="pin-btn-${ticket.id}"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 ${isPinned ? 'text-red-400 fill-current' : 'text-gray-500'}" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5.951-1.429 5.951 1.429a1 1 0 001.169-1.409l-7-14z" /></svg></button>
        ${!isAssignedToMe ? `<button onclick="event.stopPropagation(); tickets.assignToMe(${ticket.id})" class="text-gray-400 hover:text-green-400 p-2 transition-colors hover-scale" title="Assign to Me"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M11 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0z"/><path fill-rule="evenodd" d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8zm8-7a7 7 0 0 0-5.468 11.37C3.242 11.226 4.805 10 8 10s4.757 1.225 5.468 2.37A7 7 0 0 0 8 1z"/></svg></button>` : ''}
        <button onclick="event.stopPropagation(); ui.openEditModal(${ticket.id})" class="text-gray-400 hover:text-indigo-400 p-2 transition-colors hover-scale" title="Edit Ticket"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/><path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/></svg></button>
        ${(ticket.user_id === appState.currentUser.id || appState.currentUserRole === 'admin' || appState.currentUserRole === 'visitor_admin') ? `<button onclick="event.stopPropagation(); tickets.deleteTicket(${ticket.id})" class="text-gray-400 hover:text-red-500 p-2 transition-colors hover-scale" title="Delete Ticket"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/></svg></button>` : ''}
    </div>
</div>`;
        fragment.appendChild(ticketElement);
    }

    ticketList.appendChild(fragment);

    // Initialize reactions for all notes
    ticketsToRender.forEach(ticket => {
        (ticket.notes || []).forEach((note, index) => {
            renderNoteReactions(ticket.id, index);
        });
    });

    // Initialize Quill editors for new tickets
    ticketsToRender.forEach(ticket => {
        initializeQuillEditor(`note-editor-${ticket.id}`, 'Add a note...');
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
            // Render reactions for newly added notes
            for (let i = existingNotesCount; i < newNotes.length; i++) {
                renderNoteReactions(updatedTicket.id, i);
            }
        } else if (newNotes.length < existingNotesCount) {
            notesListElement.innerHTML = newNotes.map((note, index) => createNoteHTML(note, updatedTicket.id, index)).join('');
            // Render reactions for all notes when rebuilding
            newNotes.forEach((note, index) => {
                renderNoteReactions(updatedTicket.id, index);
            });
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
            // Get the colored display name (converts system username to display name with color)
            const assignedColoredName = await getColoredUserName(updatedTicket.assigned_to_name);
            assignmentInfo.innerHTML = `→ ${assignedColoredName}`;
        } else {
            assignmentInfo.innerHTML = '';
        }
    }

    // ✨ NEW: Update assignment acceptance status
    const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
    const isAssignedToMe = updatedTicket.assigned_to_name === myName;
    const actionButtonsContainer = ticketElement.querySelector('.flex.justify-end.items-center.gap-2.flex-wrap');

    if (actionButtonsContainer) {
        // Remove old Accept button or Accepted status if they exist
        const oldAcceptButton = actionButtonsContainer.querySelector('button[onclick*="acceptAssignment"]');
        const oldAcceptedSpan = actionButtonsContainer.querySelector('span.text-green-400');
        if (oldAcceptButton) oldAcceptButton.remove();
        if (oldAcceptedSpan) oldAcceptedSpan.remove();

        // Add the correct button/status based on current state
        const attachmentLabel = actionButtonsContainer.querySelector('label[for^="add-attachment-"]');
        if (isAssignedToMe && updatedTicket.assignment_status === 'pending') {
            const acceptButtonHTML = `<button onclick="event.stopPropagation(); tickets.acceptAssignment(${updatedTicket.id})" class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-xs hover-scale">Accept</button>`;
            if (attachmentLabel) {
                attachmentLabel.insertAdjacentHTML('afterend', acceptButtonHTML);
            }
        } else if (updatedTicket.assignment_status === 'accepted') {
            const acceptedSpanHTML = `<span class="text-green-400 text-xs font-semibold">Accepted</span>`;
            if (attachmentLabel) {
                attachmentLabel.insertAdjacentHTML('afterend', acceptedSpanHTML);
            }
        }
    }

    // Update reminder warning icon
    const subjectLineContainer = ticketElement.querySelector('.leading-snug');
    if (subjectLineContainer) {
        // Remove existing warning icon if present
        const existingWarningIcon = subjectLineContainer.querySelector('svg[title*="reminder"]');
        if (existingWarningIcon) {
            existingWarningIcon.remove();
        }

        // Add warning icon if reminder was requested
        if (updatedTicket.reminder_requested_at) {
            const warningIconHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-yellow-400 ml-2 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" title="A reminder was sent for this ticket"><path fill-rule="evenodd" d="M8.257 3.099c.636-1.1 2.29-1.1 2.926 0l6.847 11.982c.636 1.1-.19 2.419-1.463 2.419H2.873c-1.272 0-2.1-1.319-1.463-2.419L8.257 3.099zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" /></svg>`;
            subjectLineContainer.insertAdjacentHTML('beforeend', warningIconHTML);
        }
    }

    // Update "Remind" button visibility based on reminder_requested_at
    const remindButton = actionButtonsContainer?.querySelector('button[onclick*="requestReminder"]');
    if (remindButton) {
        if (updatedTicket.reminder_requested_at) {
            // Hide remind button if reminder was already sent
            remindButton.remove();
        }
    } else if (!updatedTicket.reminder_requested_at && updatedTicket.assigned_to_name) {
        // Show remind button if no reminder was sent and ticket is assigned
        const myName = appState.currentUser.user_metadata.display_name || appState.currentUser.email.split('@')[0];
        const isMineCreator = appState.currentUser && updatedTicket.created_by === appState.currentUser.id;

        if (isMineCreator && updatedTicket.assignment_status !== 'accepted') {
            const attachmentLabel = actionButtonsContainer?.querySelector('label[for^="add-attachment-"]');
            const remindButtonHTML = `<button onclick="event.stopPropagation(); tickets.requestReminder(${updatedTicket.id})" class="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-1 px-3 rounded-md text-xs hover-scale">Remind</button>`;

            // Insert after Accept/Accepted status
            const acceptButton = actionButtonsContainer?.querySelector('button[onclick*="acceptAssignment"]');
            const acceptedSpan = actionButtonsContainer?.querySelector('span.text-green-400');
            if (acceptButton) {
                acceptButton.insertAdjacentHTML('afterend', remindButtonHTML);
            } else if (acceptedSpan) {
                acceptedSpan.insertAdjacentHTML('afterend', remindButtonHTML);
            } else if (attachmentLabel) {
                attachmentLabel.insertAdjacentHTML('afterend', remindButtonHTML);
            }
        }
    }

    // ✨ NEW: Update attachments section
    await updateAttachmentsInPlace(updatedTicket);

    // Finally, move the updated ticket to the top of the list
    const ticketList = ticketElement.parentElement;
    if (ticketList) {
        ticketList.prepend(ticketElement);
    }
}

// ✨ NEW: Helper function to update attachments in real-time
async function updateAttachmentsInPlace(ticket) {
    const ticketElement = document.getElementById(`ticket-${ticket.id}`);
    if (!ticketElement) return;

    // Find the attachments container (it's in the ticket body, before the notes list)
    const ticketBody = ticketElement.querySelector('.ticket-body');
    if (!ticketBody) return;

    // Get signed URLs for attachments
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

    // Generate new attachments HTML
    const attachmentsHTML = generateAttachmentsHTML(ticket, attachmentUrlMap);

    // Find and update the attachments section
    const borderDiv = ticketBody.querySelector('.border-t.border-gray-700\\/30');
    if (borderDiv) {
        // Find the attachments wrapper (first div after border-div)
        const existingAttachments = borderDiv.querySelector('.flex.flex-wrap.gap-2')?.parentElement;

        if (attachmentsHTML && existingAttachments) {
            // Replace existing attachments
            existingAttachments.outerHTML = attachmentsHTML;
        } else if (attachmentsHTML && !existingAttachments) {
            // Add new attachments section at the beginning
            borderDiv.insertAdjacentHTML('afterbegin', attachmentsHTML);
        } else if (!attachmentsHTML && existingAttachments) {
            // Remove attachments section if no attachments
            existingAttachments.remove();
        }
    }
}

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

    const indentClass = isReply ? 'ml-6 border-l-2 border-indigo-400/30 pl-3' : '';
    
    // Reply badge - more like social media
    const replyBadge = isReply && parentNote
        ? `<div class="text-xs text-gray-400 mb-1 flex items-center gap-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16">
                <path fill-rule="evenodd" d="M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5z"/>
            </svg>
            <span>Replying to <span class="font-semibold text-indigo-300">${parentNote.username}</span></span>
        </div>`
        : '';

    // Kudos logic
    const kudosKey = `${ticketId}-${index}`;
    const kudosCount = kudosCounts.get(kudosKey) || 0;
    const hasGivenKudos = kudosIHaveGiven.has(kudosKey);

    // Format timestamp - show elapsed time only if less than 24 hours
    const timeDisplay = formatNoteTimestamp(note.timestamp);

    return `
    <div class="note-container bg-gray-700/30 p-3 rounded-lg border border-gray-600/50 slide-in ${indentClass}">
        ${replyBadge}
        <div class="flex flex-col gap-2">
            <!-- Header: Username and Time (No Avatar) -->
            <div class="flex items-center gap-2">
                <p class="font-semibold ${ui.getUserColor(note.username).text} text-sm">${note.username}</p>
                <span class="text-xs text-gray-500">•</span>
                <p class="text-xs text-gray-500">${timeDisplay}</p>
            </div>
            
            <!-- Note Content -->
            <div class="ql-snow"><div class="ql-editor note-text-display p-0">${sanitizedText}</div></div>
            
            <!-- Action Buttons (Like Social Media) -->
            <div class="flex items-center gap-4 mt-1 text-xs">
                <!-- Emoji Reactions -->
                <div id="reactions-${ticketId}-${index}" class="flex-shrink-0"></div>
                
                <button 
                    onclick="event.stopPropagation(); tickets.toggleReplyMode(${ticketId}, ${index})" 
                    class="flex items-center gap-1 px-2 py-1 rounded-md text-gray-400 hover:bg-gray-600/50 hover:text-indigo-400 transition-all">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                        <path fill-rule="evenodd" d="M1.5 1.5A.5.5 0 0 0 1 2v4.8a2.5 2.5 0 0 0 2.5 2.5h9.793l-3.347 3.346a.5.5 0 0 0 .708.708l4.2-4.2a.5.5 0 0 0 0-.708l-4-4a.5.5 0 0 0-.708.708L13.293 8.3H3.5A1.5 1.5 0 0 1 2 6.8V2a.5.5 0 0 0-.5-.5z"/>
                    </svg>
                    <span>Reply</span>
                </button>
                
                ${replyCount > 0 ? `
                    <button 
                        onclick="tickets.toggleReplies(${ticketId}, ${index})" 
                        class="flex items-center gap-1 px-2 py-1 rounded-md text-gray-400 hover:bg-gray-600/50 hover:text-indigo-400 transition-all">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5 8a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0zm3 1a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
                        </svg>
                        <span>${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}</span>
                    </button>
                ` : ''}
                
                ${isMyNote ? `
                    <button 
                        onclick="event.stopPropagation(); tickets.deleteNote(${ticketId}, ${index}, '${note.username}', '${note.user_id || ''}')" 
                        class="flex items-center gap-1 px-2 py-1 rounded-md text-gray-400 hover:bg-red-500/20 hover:text-red-400 transition-all ml-auto">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16">
                            <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                            <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                        </svg>
                        <span>Delete</span>
                    </button>
                ` : ''}
            </div>
        </div>
    </div>`;
}

function formatNoteTimestamp(timestamp) {
    const now = new Date();
    const noteTime = new Date(timestamp);
    const diffMs = now - noteTime;
    const diffHours = diffMs / (1000 * 60 * 60);

    // If less than 24 hours, show elapsed time
    if (diffHours < 24) {
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);

        if (diffSecs < 60) return 'just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        return `${Math.floor(diffHours)}h ago`;
    }

    // If 24 hours or more, show full date and time
    const options = {
        month: 'short',
        day: 'numeric',
        year: noteTime.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
        hour: '2-digit',
        minute: '2-digit'
    };

    return noteTime.toLocaleString([], options);
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
        initializeQuillEditor(`reply-editor-${ticketId}-${parentNoteIndex}`, 'Write your reply...');
        // Store with a special key for replies
        const quill = quillInstances.get(`reply-editor-${ticketId}-${parentNoteIndex}`);
        if (quill) {
            quillInstances.set(`reply-${ticketId}-${parentNoteIndex}`, quill);
        }
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
        let mentionAll = false;

        mentionedUsernames.forEach(username => {
            if (username.toLowerCase() === 'all') {
                mentionAll = true;
            } else if (appState.allUsers.has(username)) {
                mentionedUserIds.push(appState.allUsers.get(username));
            }
        });

        // Fetch current notes first
        const { data: currentTicketData, error: fetchError } = await _supabase.from('tickets').select('notes').eq('id', ticketId).single();
        if (fetchError) throw fetchError;

        const newNote = {
            username: getCurrentUsername(),
            user_id: appState.currentUser.id,
            text,
            timestamp: new Date().toISOString(),
            mentioned_user_ids: mentionedUserIds,
            mention_all: mentionAll,
            reply_to_note_index: parentNoteIndex
        };

        // Save the new note
        const { error: updateError } = await _supabase.from('tickets').update({
            notes: [...(currentTicketData.notes || []), newNote],
            updated_at: new Date().toISOString()
        }).eq('id', ticketId);

        if (updateError) throw updateError;

        // Send mention notifications
        if (mentionedUserIds.length > 0 || mentionAll) {
            await sendMentionNotifications(ticketId, mentionedUserIds, quill.getText(), mentionAll);
        }

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

        // Award 3 points for linking tickets
        awardPoints('TICKET_LINKED', { ticketId: currentTicketId, linkedTicketId: relatedTicketId, relationshipType });

        showNotification('Success', 'Tickets linked successfully.', 'success');

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

// NOTE: addRelationship() function was removed as it was never used.
// Its functionality is handled by selectTicketForLink() instead.

export async function removeRelationship(ticketId, relatedTicketId) {
    try {
        const ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets].find(t => t.id === ticketId);
        const relationships = (ticket?.related_tickets || []).filter(r => r.ticket_id !== relatedTicketId);

        const { error } = await _supabase.from('tickets').update({
            related_tickets: relationships
        }).eq('id', ticketId);

        if (error) throw error;

        // Reverse 3 points for unlinking tickets
        awardPoints('TICKET_UNLINKED', { ticketId, unlinkedTicketId: relatedTicketId });

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
            updatePresenceIndicators();
        })
        .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
            updatePresenceIndicators();
        })
        .subscribe(async (status) => {
            // Subscribed
        });

    // Update presence heartbeat every 30 seconds
    if (presenceUpdateInterval) clearInterval(presenceUpdateInterval);
    presenceUpdateInterval = setInterval(updatePresenceHeartbeat, PRESENCE_HEARTBEAT_INTERVAL_MS);
}

export async function startTrackingTicket(ticketId) {
    try {
        const username = getCurrentUsername();

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
            // Presence heartbeat updated
        }
    }
}

export async function displayActiveViewers(ticketId) {
    try {
        // Use a fresher timeout - 2 minutes instead of 5
        const twoMinutesAgo = new Date(Date.now() - PRESENCE_TIMEOUT_MS).toISOString();
        
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

    try {
        // Fetch the latest kudos data
        const { data: kudosData, error } = await _supabase
            .from('kudos')
            .select('*')
            .eq('ticket_id', ticketId)
            .eq('note_index', noteIndex);

        if (error) {
            console.error("Error fetching kudos count", error);
            return;
        }

        const count = kudosData?.length || 0;
        const hasGivenKudos = kudosData?.some(k => k.giver_user_id === appState.currentUser.id) || false;

        // Update the count
        const countSpan = document.getElementById(`kudos-count-${kudosKey}`);
        const textSpan = document.getElementById(`kudos-text-${kudosKey}`);
        const thumbsEmoji = kudosBtn.querySelector('span.text-base');

        if (countSpan) {
            countSpan.textContent = count;
            if (count > 0) {
                countSpan.classList.remove('hidden');
            } else {
                countSpan.classList.add('hidden');
            }
        }

        // Update button state
        if (hasGivenKudos) {
            kudosBtn.classList.add('bg-blue-500/20', 'text-blue-400', 'font-semibold');
            kudosBtn.classList.remove('text-gray-400');
            if (textSpan) textSpan.textContent = 'Liked';
            if (thumbsEmoji) thumbsEmoji.classList.add('scale-110');
            
            // Add animation
            kudosBtn.classList.add('kudos-animation');
            setTimeout(() => kudosBtn.classList.remove('kudos-animation'), 300);
        } else {
            kudosBtn.classList.remove('bg-blue-500/20', 'text-blue-400', 'font-semibold');
            kudosBtn.classList.add('text-gray-400');
            if (textSpan) textSpan.textContent = 'Like';
            if (thumbsEmoji) thumbsEmoji.classList.remove('scale-110');
        }

    } catch (err) {
        console.error("Exception updating kudos count:", err);
    }
}


export async function addNote(ticketId) {
    const quill = quillInstances.get(`note-editor-${ticketId}`);
    if (!quill) {
        console.error('Quill editor not found for ticket:', ticketId);
        return;
    }

    const text = quill.root.innerHTML;

    if (quill.getLength() <= 1) {
        return showNotification('Empty Note', 'Cannot add an empty note.', 'error');
    }

    try {
        const mentionRegex = /@([\w.-]+)/g;
        const mentionedUsernames = [...text.matchAll(mentionRegex)].map(match => match[1]);
        const mentionedUserIds = [];
        let mentionAll = false;

        mentionedUsernames.forEach(username => {
            if (username.toLowerCase() === 'all') {
                mentionAll = true;
            } else if (appState.allUsers.has(username)) {
                mentionedUserIds.push(appState.allUsers.get(username));
            }
        });

        const { data } = await _supabase.from('tickets').select('notes').eq('id', ticketId).single();

        const isFirstNote = !data.notes || data.notes.length === 0;
        const noteTime = new Date().toISOString();

        const newNote = {
            username: getCurrentUsername(),
            user_id: appState.currentUser.id,
            text,
            timestamp: noteTime,
            mentioned_user_ids: mentionedUserIds,
            mention_all: mentionAll
        };

        const { error } = await _supabase.from('tickets').update({
            notes: [...(data.notes || []), newNote],
            updated_at: noteTime // Touch the timestamp to move it to the top
        }).eq('id', ticketId);

        if (error) throw error;

        // Send mention notifications
        if (mentionedUserIds.length > 0 || mentionAll) {
            await sendMentionNotifications(ticketId, mentionedUserIds, quill.getText(), mentionAll);
        }

        // Check badges if this is the first note
        if (isFirstNote && window.badges) {
            // Get ticket data for badge checks (use data from line 2277 to avoid duplicate query)
            const { data: ticketData } = await _supabase
                .from('tickets')
                .select('created_at, assigned_at, assigned_to')
                .eq('id', ticketId)
                .single();

            if (ticketData) {
                // Check Lightning badge (fast response)
                if (window.badges.checkLightningBadge) {
                    window.badges.checkLightningBadge(
                        appState.currentUser.id,
                        getCurrentUsername(),
                        ticketId,
                        noteTime,
                        ticketData // Pass ticket data to avoid duplicate query
                    );
                }

                // Check Turtle badge (slow response)
                const startTime = new Date(ticketData.assigned_at || ticketData.created_at);
                const endTime = new Date(noteTime);
                const diffMinutes = (endTime - startTime) / 60000;

                if (diffMinutes > 15 && window.badges.checkTurtleBadge) {
                    window.badges.checkTurtleBadge(
                        appState.currentUser.id,
                        getCurrentUsername(),
                        'slow_response',
                        diffMinutes
                    );
                }
            }
        }

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
        const myName = getCurrentUsername();
        
        // If closing ticket, show reason modal
        if (currentStatus === 'In Progress') {
            ui.openCloseReasonModal(ticketId);
            return; // Stop here, will continue in confirmCloseTicket()
        }
        
        // If reopening ticket (existing logic, no changes)
        if (currentStatus === 'Done') {
            const newStatus = 'In Progress';
            let ticket = appState.tickets.find(t => t.id === ticketId) || appState.doneTickets.find(t => t.id === ticketId);
            if (!ticket) {
                const { data } = await _supabase.from('tickets').select('*').eq('id', ticketId).single();
                ticket = data;
            }

            if (!ticket) throw new Error("Ticket not found.");

            const updatePayload = {
                status: newStatus,
                is_reopened: true
            };

            const { error } = await _supabase.from('tickets').update(updatePayload).eq('id', ticketId);
            if (error) throw error;

            // Award points for reopening (reverses close points)
            await awardPoints('TICKET_REOPENED', { ticketId: ticketId });

            const ticketElement = document.getElementById(`ticket-${ticketId}`);
            if (ticketElement) {
                ticketElement.remove();
            }

            logActivity('STATUS_CHANGED', { ticket_id: ticketId, status: newStatus });
        }
    } catch (err) {
        showNotification('Error', err.message, 'error');
        if (window.main && typeof window.main.applyFilters === 'function') {
            window.main.applyFilters();
        }
    }
}

export async function confirmCloseTicket() {
    try {
        const modal = document.getElementById('close-reason-modal');
        const ticketId = parseInt(modal.dataset.ticketId);
        const selectedReason = document.querySelector('input[name="close-reason"]:checked')?.value;
        
        if (!selectedReason) {
            showNotification('Error', 'Please select a close reason.', 'error');
            return;
        }
        
        // Map reason values to display text
        let closeReason = '';
        let closeReasonDetails = '';
        
        switch(selectedReason) {
            case 'completely_done':
                closeReason = 'Ticket Completely Done';
                break;
            case 'no_reply_week':
                closeReason = 'No Reply Since a Week';
                break;
            case 'duplicate':
                closeReason = 'Duplicate Ticket';
                break;
            case 'invalid':
                closeReason = 'Invalid/Not Applicable';
                break;
            case 'other':
                const otherText = document.getElementById('other-reason-text')?.value.trim();
                if (!otherText) {
                    showNotification('Missing Reason', 'Please specify a reason for closing this ticket.', 'error');
                    return;
                }
                closeReason = 'Other';
                closeReasonDetails = otherText;
                break;
        }
        
        const myName = getCurrentUsername();
        
        // Get ticket data
        let ticket = appState.tickets.find(t => t.id === ticketId) || 
                     appState.doneTickets.find(t => t.id === ticketId);
        if (!ticket) {
            const { data } = await _supabase.from('tickets').select('*').eq('id', ticketId).single();
            ticket = data;
        }

        if (!ticket) throw new Error("Ticket not found.");

        // Update ticket with close reason (info only)
        const updatePayload = {
            status: 'Done',
            completed_by_name: myName,
            close_reason: closeReason,
            close_reason_details: closeReasonDetails,
            is_reopened: false  // Reset reopen flag when closing
        };

        if (!ticket.completed_at) {
            updatePayload.completed_at = new Date().toISOString();
        }

        const { error } = await _supabase.from('tickets').update(updatePayload).eq('id', ticketId);
        if (error) throw error;

        // Close modal and update UI immediately for better UX
        ui.closeCloseReasonModal();

        // Remove ticket from UI
        const ticketElement = document.getElementById(`ticket-${ticketId}`);
        if (ticketElement) {
            ticketElement.remove();
        }

        showNotification('Ticket Closed', `Reason: ${closeReason}`, 'success');

        // Award points in background (don't await - let it run async)
        awardPoints('TICKET_CLOSED', { ticketId: ticketId, priority: ticket.priority });

        // Check Speed Demon badge (closing ticket fast)
        if (window.badges && window.badges.checkSpeedDemonBadge) {
            window.badges.checkSpeedDemonBadge(
                appState.currentUser.id,
                myName,
                ticketId,
                new Date().toISOString()
            );
        }

        logActivity('STATUS_CHANGED', {
            ticket_id: ticketId,
            status: 'Done',
            close_reason: closeReason
        });

        // Refresh the view in background (don't await)
        if (window.main && typeof window.main.applyFilters === 'function') {
            window.main.applyFilters();
        }
    } catch (err) {
        console.error('Error closing ticket:', err);
        showNotification('Error', err.message, 'error');
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
        const myName = getCurrentUsername();

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

        // If ticket was Done and now reopened by assignment, reverse close points
        if (ticket.status === 'Done') {
            await awardPoints('TICKET_REOPENED', { ticketId: ticketId });
        }

        // Check Sniper badge (consecutive ticket assignments)
        if (window.badges && window.badges.checkSniperBadge) {
            window.badges.checkSniperBadge(
                appState.currentUser.id,
                myName
            );
        }

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

            if (diffSeconds < QUICK_ACCEPT_THRESHOLD_SEC) {
                awardPoints('ACCEPT_ASSIGNMENT_QUICKLY', { ticketId: ticketId, timeToAccept: diffSeconds });
            } else if (diffSeconds > SLOW_ACCEPT_THRESHOLD_SEC) {
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
            showNotification('Info', "You can't like your own note.", 'info', false);
            return;
        }

        // Optimistically update UI immediately
        const kudosKey = `${ticketId}-${noteIndex}`;
        const kudosBtn = document.getElementById(`kudos-btn-${kudosKey}`);
        const thumbsEmoji = kudosBtn?.querySelector('span.text-base');
        
        if (kudosBtn && thumbsEmoji) {
            kudosBtn.classList.add('bg-blue-500/20', 'text-blue-400', 'font-semibold');
            kudosBtn.classList.remove('text-gray-400');
            thumbsEmoji.classList.add('scale-110');
            kudosBtn.classList.add('kudos-animation');
            setTimeout(() => kudosBtn.classList.remove('kudos-animation'), 300);
        }

        const { error } = await _supabase.from('kudos').insert({
            ticket_id: ticketId,
            note_index: noteIndex,
            giver_user_id: appState.currentUser.id,
            receiver_user_id: receiverUserId
        });

        if (error && error.code !== '23505') {
            // Revert optimistic update on error
            if (kudosBtn && thumbsEmoji) {
                kudosBtn.classList.remove('bg-blue-500/20', 'text-blue-400', 'font-semibold');
                kudosBtn.classList.add('text-gray-400');
                thumbsEmoji.classList.remove('scale-110');
            }
            throw error;
        }

        awardPoints('KUDOS_RECEIVED', {
            ticketId,
            kudosReceiverId: receiverUserId,
            kudosReceiverUsername: receiverUsername
        });

        logActivity('KUDOS_GIVEN', {
            receiver: receiverUsername,
            ticket_id: ticketId
        });

        // The real-time subscription will handle the final state update
        
    } catch (err) {
        if (err.code !== '23505') {
            showNotification('Error', err.message, 'error');
        }
    }
}

// ========== MENTION SYSTEM ==========

/**
 * Initialize mention detection for a Quill editor
 */
export function initializeMentionSystem(quill, ticketId) {
    if (!quill) return;

    // Create dropdown if it doesn't exist
    let dropdown = document.getElementById(`mention-dropdown-${ticketId}`);
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = `mention-dropdown-${ticketId}`;
        dropdown.className = 'mention-dropdown';
        dropdown.style.display = 'none';

        // Find the editor container and append dropdown
        const editorContainer = document.getElementById(`note-editor-${ticketId}`);
        if (editorContainer) {
            editorContainer.parentElement.style.position = 'relative';
            editorContainer.parentElement.appendChild(dropdown);
        }
    }

    // Listen for text changes
    quill.on('text-change', function(_, __, source) {
        if (source !== 'user') return;

        const text = quill.getText();
        const cursorPosition = quill.getSelection()?.index || 0;

        // Find @ symbol before cursor
        const textBeforeCursor = text.substring(0, cursorPosition);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');

        if (lastAtIndex !== -1) {
            // Check if there's a space between @ and cursor
            const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
            if (!textAfterAt.includes(' ') && !textAfterAt.includes('\n')) {
                const mentionQuery = textAfterAt.toLowerCase();
                showMentionDropdown(ticketId, mentionQuery, quill);
                return;
            }
        }

        // Hide dropdown if no valid mention
        hideMentionDropdown(ticketId);
    });

    // Handle keyboard navigation in dropdown
    quill.root.addEventListener('keydown', function(e) {
        const dropdown = document.getElementById(`mention-dropdown-${ticketId}`);
        if (!dropdown || dropdown.style.display === 'none') return;

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            navigateMentionDropdown(ticketId, e.key === 'ArrowDown' ? 1 : -1);
        } else if (e.key === 'Enter') {
            const selected = dropdown.querySelector('.mention-item.selected');
            if (selected) {
                e.preventDefault();
                selectMentionFromDropdown(ticketId, selected.dataset.username, quill);
            }
        } else if (e.key === 'Escape') {
            hideMentionDropdown(ticketId);
        }
    });
}

/**
 * Show mention autocomplete dropdown
 */
function showMentionDropdown(ticketId, query) {
    const dropdown = document.getElementById(`mention-dropdown-${ticketId}`);
    if (!dropdown) return;

    // Filter users by query
    const users = Array.from(appState.allUsers.keys())
        .filter(name => name.toLowerCase().includes(query))
        .slice(0, 5); // Limit to 5 results

    // Check if @all matches the query
    const allMatches = 'all'.includes(query.toLowerCase());

    // Add @all option if it matches
    const options = [];
    if (allMatches) {
        options.push({
            username: 'all',
            displayName: 'all',
            avatar: '👥',
            isAll: true
        });
    }

    // Add matching users
    users.forEach(username => {
        options.push({
            username: username,
            displayName: username,
            avatar: username.substring(0, 2).toUpperCase(),
            isAll: false
        });
    });

    if (options.length === 0) {
        dropdown.style.display = 'none';
        return;
    }

    // Build dropdown HTML
    dropdown.innerHTML = options.map((option, index) =>
        `<div class="mention-item ${index === 0 ? 'selected' : ''}"
             data-username="${option.username}"
             onmousedown="event.preventDefault(); tickets.selectMentionFromDropdown(${ticketId}, '${option.username}')">
            <span class="mention-avatar ${option.isAll ? 'text-xl' : ''}">${option.avatar}</span>
            <span class="mention-name">${option.displayName}${option.isAll ? ' (everyone)' : ''}</span>
        </div>`
    ).join('');

    // Position dropdown
    dropdown.style.display = 'block';
    dropdown.style.position = 'absolute';
    dropdown.style.zIndex = '1000';
}

/**
 * Navigate mention dropdown with arrow keys
 */
function navigateMentionDropdown(ticketId, direction) {
    const dropdown = document.getElementById(`mention-dropdown-${ticketId}`);
    if (!dropdown) return;

    const items = dropdown.querySelectorAll('.mention-item');
    let currentIndex = Array.from(items).findIndex(item => item.classList.contains('selected'));

    if (currentIndex !== -1) {
        items[currentIndex].classList.remove('selected');
    }

    currentIndex += direction;
    if (currentIndex < 0) currentIndex = items.length - 1;
    if (currentIndex >= items.length) currentIndex = 0;

    items[currentIndex].classList.add('selected');
    items[currentIndex].scrollIntoView({ block: 'nearest' });
}

/**
 * Select a mention from dropdown
 */
export function selectMentionFromDropdown(ticketId, username, quillInstance = null) {
    const quill = quillInstance || quillInstances.get(`note-editor-${ticketId}`);
    if (!quill) {
        console.error('Quill editor not found for mention in ticket:', ticketId);
        return;
    }

    const text = quill.getText();
    const cursorPosition = quill.getSelection()?.index || 0;

    // Find the @ symbol before cursor
    const textBeforeCursor = text.substring(0, cursorPosition);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
        // Delete from @ to cursor
        quill.deleteText(lastAtIndex, cursorPosition - lastAtIndex);

        // Insert mention with special formatting
        quill.insertText(lastAtIndex, `@${username} `, {
            'color': '#60a5fa',
            'bold': true
        });

        // Set cursor after the mention
        quill.setSelection(lastAtIndex + username.length + 2);
    }

    hideMentionDropdown(ticketId);
}

/**
 * Hide mention dropdown
 */
function hideMentionDropdown(ticketId) {
    const dropdown = document.getElementById(`mention-dropdown-${ticketId}`);
    if (dropdown) {
        dropdown.style.display = 'none';
    }
}

/**
 * Send mention notifications to mentioned users
 */
async function sendMentionNotifications(ticketId, mentionedUserIds, noteText, mentionAll = false) {
    if ((!mentionedUserIds || mentionedUserIds.length === 0) && !mentionAll) return;

    try {
        const ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets]
            .find(t => t.id === ticketId);

        if (!ticket) return;

        const currentUsername = getCurrentUsername();
        let userIdsToNotify = [...mentionedUserIds];

        // If @all was mentioned, add all users except the current user
        if (mentionAll) {
            const allUserIds = Array.from(appState.allUsers.values());
            userIdsToNotify = [...new Set([...userIdsToNotify, ...allUserIds])];
        }

        // Filter out the current user (don't notify yourself)
        userIdsToNotify = userIdsToNotify.filter(userId => userId !== appState.currentUser.id);

        // Create notification for each mentioned user
        for (const userId of userIdsToNotify) {
            const { error } = await _supabase.from('mention_notifications').insert({
                ticket_id: ticketId,
                mentioned_user_id: userId,
                mentioned_by_user_id: appState.currentUser.id,
                mentioned_by_username: currentUsername,
                ticket_subject: ticket.subject,
                note_preview: noteText.substring(0, 100),
                is_read: false,
                created_at: new Date().toISOString()
            });

            if (error) {
                console.error('Error creating mention notification:', error);
            }
        }
    } catch (error) {
        console.error('Error sending mention notifications:', error);
    }
}

/**
 * Fetch and display mention notifications for current user
 */
export async function fetchMentionNotifications() {
    if (!appState.currentUser) return;

    try {
        const { data, error } = await _supabase
            .from('mention_notifications')
            .select('*')
            .eq('mentioned_user_id', appState.currentUser.id)
            .eq('is_read', false)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Display notifications
        if (data && data.length > 0) {
            data.forEach(notification => {
                displayMentionNotification(notification);
            });
        }
    } catch (error) {
        console.error('Error fetching mention notifications:', error);
    }
}

/**
 * Display a persistent mention notification
 */
function displayMentionNotification(notification) {
    const notificationId = `mention-notif-${notification.id}`;

    // Check if notification already displayed
    if (document.getElementById(notificationId)) return;

    const container = document.getElementById('notification-panel');
    if (!container) return;

    const notificationEl = document.createElement('div');
    notificationEl.id = notificationId;
    notificationEl.className = 'mention-notification glassmorphism p-4 rounded-lg shadow-lg border border-blue-500/50 cursor-pointer hover:bg-gray-700/50 transition-all fade-in';
    notificationEl.onclick = () => navigateToMentionedTicket(notification);

    notificationEl.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold">
                ${notification.mentioned_by_username.substring(0, 2).toUpperCase()}
            </div>
            <div class="flex-grow min-w-0">
                <div class="flex items-start justify-between gap-2 mb-1">
                    <p class="font-semibold text-white text-sm">
                        <span class="text-blue-400">@${notification.mentioned_by_username}</span> mentioned you
                    </p>
                    <button onclick="event.stopPropagation(); tickets.dismissMentionNotification(${notification.id})"
                            class="text-gray-400 hover:text-white transition-colors flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
                <p class="text-xs text-gray-400 mb-2">in ticket: <span class="text-indigo-300">#${notification.ticket_id} ${notification.ticket_subject}</span></p>
                <p class="text-xs text-gray-300 line-clamp-2">${notification.note_preview}...</p>
                <p class="text-xs text-gray-500 mt-2">${formatTimeAgo(notification.created_at)}</p>
            </div>
        </div>
    `;

    container.appendChild(notificationEl);
}

/**
 * Navigate to the ticket where user was mentioned
 */
async function navigateToMentionedTicket(notification) {
    try {
        // Mark as read
        await dismissMentionNotification(notification.id);

        // Find the ticket
        let ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets]
            .find(t => t.id === notification.ticket_id);

        // If not in current view, fetch it
        if (!ticket) {
            const { data, error } = await _supabase
                .from('tickets')
                .select('*')
                .eq('id', notification.ticket_id)
                .single();

            if (error) throw error;
            ticket = data;
        }

        // Switch to the correct view
        if (ticket.status === 'Done') {
            if (window.ui && window.ui.switchView) {
                window.ui.switchView('done');
            }
        } else if (ticket.needs_followup) {
            if (window.ui && window.ui.switchView) {
                window.ui.switchView('follow-up');
            }
        } else {
            if (window.ui && window.ui.switchView) {
                window.ui.switchView('tickets');
            }
        }

        // Wait a bit for view to switch
        await new Promise(resolve => setTimeout(resolve, 300));

        // Expand the ticket
        appState.expandedTicketId = notification.ticket_id;
        const ticketElement = document.getElementById(`ticket-${notification.ticket_id}`);

        if (ticketElement) {
            // Scroll to ticket
            ticketElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Expand if collapsed
            const body = ticketElement.querySelector('.ticket-body');
            if (body && body.classList.contains('hidden')) {
                handleTicketToggle(notification.ticket_id);
            }

            // Highlight the ticket briefly
            ticketElement.style.boxShadow = '0 0 20px rgba(59, 130, 246, 0.6)';
            setTimeout(() => {
                ticketElement.style.boxShadow = '';
            }, 2000);
        }
    } catch (error) {
        console.error('Error navigating to mentioned ticket:', error);
        showNotification('Error', 'Could not navigate to ticket', 'error');
    }
}

/**
 * Dismiss a mention notification
 */
export async function dismissMentionNotification(notificationId) {
    try {
        // Mark as read in database
        const { error } = await _supabase
            .from('mention_notifications')
            .update({ is_read: true })
            .eq('id', notificationId);

        if (error) throw error;

        // Remove from UI
        const notificationEl = document.getElementById(`mention-notif-${notificationId}`);
        if (notificationEl) {
            notificationEl.style.opacity = '0';
            notificationEl.style.transform = 'translateX(100%)';
            setTimeout(() => notificationEl.remove(), 300);
        }
    } catch (error) {
        console.error('Error dismissing mention notification:', error);
    }
}

/**
 * Format time ago for notifications
 */
function formatTimeAgo(timestamp) {
    const now = new Date();
    const time = new Date(timestamp);
    const diffMs = now - time;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
}

// ========== MILESTONE NOTIFICATIONS ==========

/**
 * Load existing milestone notifications on page load
 */
export async function loadExistingMilestoneNotifications() {
    if (!appState.currentUser) return;

    try {
        // Fetch recent milestone notifications (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data: notifications, error } = await _supabase
            .from('milestone_notifications')
            .select('*')
            .gte('created_at', sevenDaysAgo.toISOString())
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;

        console.log(`[Milestone Notifications] Loaded ${notifications?.length || 0} recent notifications`);

        // Display each notification that hasn't been dismissed by current user
        if (notifications && notifications.length > 0) {
            for (const notification of notifications) {
                displaySingleMilestoneNotification(notification);
            }
        }
    } catch (error) {
        console.error('Error loading milestone notifications:', error);
    }
}

/**
 * Display a single milestone notification (called from realtime listener or on page load)
 */
export function displaySingleMilestoneNotification(notification) {
    if (!appState.currentUser) return;

    const notificationId = `milestone-notif-${notification.id}`;

    // Check if current user has dismissed this notification (check dismissed_by_users array)
    const dismissedByUsers = notification.dismissed_by_users || [];
    if (dismissedByUsers.includes(appState.currentUser.id)) {
        console.log('[Milestone Notification] Already dismissed by current user');
        return;
    }

    // Check if notification already displayed
    if (document.getElementById(notificationId)) return;

    const container = document.getElementById('notification-panel');
    if (!container) return;

    const notificationEl = document.createElement('div');
    notificationEl.id = notificationId;
    notificationEl.className = 'milestone-notification glassmorphism p-4 rounded-lg shadow-lg border border-yellow-500/50 transition-all fade-in';

    notificationEl.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-r from-yellow-400 to-orange-500 flex items-center justify-center text-white font-bold text-xl">
                🎉
            </div>
            <div class="flex-grow min-w-0">
                <div class="flex items-start justify-between gap-2 mb-1">
                    <p class="font-semibold text-white text-sm">
                        ${notification.message}
                    </p>
                    <button onclick="event.stopPropagation(); tickets.dismissMilestoneNotification(${notification.id})"
                            class="text-gray-400 hover:text-white transition-colors flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
                <p class="text-xs text-gray-500 mt-2">${formatTimeAgo(notification.created_at)}</p>
            </div>
        </div>
    `;

    container.appendChild(notificationEl);
}

/**
 * Dismiss a milestone notification (adds current user to dismissed_by_users array)
 */
export async function dismissMilestoneNotification(notificationId) {
    if (!appState.currentUser) return;

    try {
        // Add current user ID to dismissed_by_users array
        // Using array_append to add user ID if not already present
        const { error } = await _supabase.rpc('dismiss_milestone_notification', {
            notification_id: notificationId,
            user_id: appState.currentUser.id
        });

        if (error) throw error;

        console.log('[Milestone Notification] Dismissed by current user');

        // Remove from UI with animation
        const notificationEl = document.getElementById(`milestone-notif-${notificationId}`);
        if (notificationEl) {
            notificationEl.style.opacity = '0';
            notificationEl.style.transform = 'translateX(100%)';
            setTimeout(() => notificationEl.remove(), 300);
        }
    } catch (error) {
        console.error('Error dismissing milestone notification:', error);
        // If RPC function doesn't exist, fall back to direct update
        try {
            const { data: notification } = await _supabase
                .from('milestone_notifications')
                .select('dismissed_by_users')
                .eq('id', notificationId)
                .single();

            const dismissedByUsers = notification?.dismissed_by_users || [];

            // Add current user if not already in array
            if (!dismissedByUsers.includes(appState.currentUser.id)) {
                dismissedByUsers.push(appState.currentUser.id);

                const { error: updateError } = await _supabase
                    .from('milestone_notifications')
                    .update({ dismissed_by_users: dismissedByUsers })
                    .eq('id', notificationId);

                if (updateError) throw updateError;

                // Remove from UI
                const notificationEl = document.getElementById(`milestone-notif-${notificationId}`);
                if (notificationEl) {
                    notificationEl.style.opacity = '0';
                    notificationEl.style.transform = 'translateX(100%)';
                    setTimeout(() => notificationEl.remove(), 300);
                }
            }
        } catch (fallbackError) {
            console.error('Fallback dismissal also failed:', fallbackError);
            showToast('Failed to dismiss notification', 'error');
        }
    }
}

// ========== TYPING INDICATOR SYSTEM ==========

/**
 * Update typing indicator when user types in ticket subject
 */
export async function updateTypingIndicator(location = 'new_ticket') {
    if (!appState.currentUser) return;

    const username = getCurrentUsername();

    try {
        // Upsert typing indicator
        const { error } = await _supabase
            .from('typing_indicators')
            .upsert({
                user_id: appState.currentUser.id,
                username: username,
                typing_location: location,
                last_typed_at: new Date().toISOString()
            }, {
                onConflict: 'user_id,typing_location'
            });

        if (error) throw error;

        // Clear previous timeout
        if (typingTimeout) {
            clearTimeout(typingTimeout);
        }

        currentTypingLocation = location;

        // Set timeout to remove typing indicator after 3 seconds of inactivity
        typingTimeout = setTimeout(async () => {
            await removeTypingIndicator(location);
        }, TYPING_INDICATOR_TIMEOUT_MS);

    } catch (error) {
        console.error('Error updating typing indicator:', error);
    }
}

/**
 * Remove typing indicator
 */
export async function removeTypingIndicator(location = 'new_ticket') {
    if (!appState.currentUser) return;

    try {
        const { error } = await _supabase
            .from('typing_indicators')
            .delete()
            .eq('user_id', appState.currentUser.id)
            .eq('typing_location', location);

        if (error) throw error;

        if (currentTypingLocation === location) {
            currentTypingLocation = null;
        }

    } catch (error) {
        console.error('Error removing typing indicator:', error);
    }
}

/**
 * Fetch and display who's typing
 */
export async function fetchTypingIndicators(location = 'new_ticket') {
    try {
        const cutoffTime = new Date(Date.now() - 5000).toISOString();

        const { data, error } = await _supabase
            .from('typing_indicators')
            .select('*')
            .eq('typing_location', location)
            .neq('user_id', appState.currentUser.id) // Don't show own typing
            .gte('last_typed_at', cutoffTime); // Only last 5 seconds

        if (error) throw error;

        displayTypingIndicators(data || [], location);

    } catch (error) {
        console.error('Error fetching typing indicators:', error);
    }
}

/**
 * Display typing indicators in UI
 */
function displayTypingIndicators(typingUsers, location = 'new_ticket') {
    const container = document.getElementById('typing-indicator-container');
    if (!container) return;

    if (typingUsers.length === 0) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    const names = typingUsers.map(u => u.username);
    let text = '';

    if (names.length === 1) {
        text = `${names[0]} is typing a new ticket...`;
    } else if (names.length === 2) {
        text = `${names[0]} and ${names[1]} are typing new tickets...`;
    } else {
        text = `${names[0]}, ${names[1]}, and ${names.length - 2} others are typing...`;
    }

    container.innerHTML = `
        <div class="typing-indicator-message fade-in flex items-center gap-2 text-sm text-gray-400 bg-gray-800/50 px-4 py-2 rounded-lg border border-gray-700/50">
            <div class="typing-dots flex gap-1">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </div>
            <span>${text}</span>
        </div>
    `;
}

/**
 * Initialize typing indicator for ticket subject input
 */
export function initializeTypingIndicator() {
    const ticketSubject = document.getElementById('ticket-subject');

    if (!ticketSubject) {
        // Retry after a delay to ensure DOM is ready
        setTimeout(() => {
            initializeTypingIndicator();
        }, 500);
        return;
    }

    // Debounced typing indicator update
    let typingDebounce = null;

    ticketSubject.addEventListener('input', () => {
        // Clear previous debounce
        if (typingDebounce) {
            clearTimeout(typingDebounce);
        }

        // Update immediately (or after short delay)
        typingDebounce = setTimeout(() => {
            if (ticketSubject.value.trim().length > 0) {
                updateTypingIndicator('new_ticket');
            } else {
                removeTypingIndicator('new_ticket');
            }
        }, 300);
    });

    // Remove typing indicator when user leaves the input
    ticketSubject.addEventListener('blur', () => {
        setTimeout(() => {
            removeTypingIndicator('new_ticket');
        }, 500);
    });

    // Remove typing indicator when ticket is created
    const createBtn = document.getElementById('create-ticket-btn');
    if (createBtn) {
        createBtn.addEventListener('click', () => {
            removeTypingIndicator('new_ticket');
        });
    }

    // Start polling for typing indicators every 2 seconds
    if (typingIndicatorPollInterval) {
        clearInterval(typingIndicatorPollInterval);
    }

    typingIndicatorPollInterval = setInterval(() => {
        fetchTypingIndicators('new_ticket');
    }, TYPING_INDICATOR_POLL_INTERVAL_MS);
}

/**
 * Cleanup typing indicators on page unload
 */
export function cleanupTypingIndicators() {
    // Clear polling interval
    if (typingIndicatorPollInterval) {
        clearInterval(typingIndicatorPollInterval);
        typingIndicatorPollInterval = null;
    }

    window.addEventListener('beforeunload', () => {
        if (currentTypingLocation) {
            // Use sendBeacon for reliable cleanup on page unload
            navigator.sendBeacon(
                `${_supabase.supabaseUrl}/rest/v1/typing_indicators?user_id=eq.${appState.currentUser.id}&typing_location=eq.${currentTypingLocation}`,
                JSON.stringify({})
            );
        }
    });
}

export function checkReminders(currentTicketList) {
    if (!appState.currentUser || !currentTicketList) return;
    const tenMinutesAgo = new Date(Date.now() - REMINDER_CHECK_TIMEOUT_MS);
    const myName = getCurrentUsername();

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
            // Award points for ticket deletion (Edge Function handles reversal)
            await awardPoints('TICKET_DELETED', { ticketId });

            const { error: deleteError } = await _supabase.from('tickets').delete().eq('id', ticketId);
            if (deleteError) throw deleteError;

            logActivity('TICKET_DELETED', { ticket_id: ticketId });
            showNotification('Success', 'Ticket deleted and points reversed.', 'success');
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

        // Award 3 points for adding an attachment
        awardPoints('ATTACHMENT_ADDED', { ticketId, fileName: uploadedFile.name });

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

            // Reverse 3 points for deleting an attachment
            const fileName = filePath.split('/').pop();
            awardPoints('ATTACHMENT_DELETED', { ticketId, fileName });

            showNotification('Success', 'Attachment deleted successfully.', 'success');
        } catch (error) {
            showNotification('Error Deleting File', error.message, 'error');
        }
    });
}

// ============================================
// EMOJI REACTIONS SYSTEM
// ============================================

const REACTION_TYPES = {
    like: { emoji: '👍', name: 'Like', color: '#3B82F6' },
    heart: { emoji: '❤️', name: 'Love', color: '#EF4444' },
    laugh: { emoji: '😂', name: 'Haha', color: '#F59E0B' },
    wow: { emoji: '😮', name: 'Wow', color: '#8B5CF6' },
    sad: { emoji: '😢', name: 'Sad', color: '#6B7280' },
    celebrate: { emoji: '🎉', name: 'Celebrate', color: '#10B981' }
};

/**
 * Render reactions for a note
 */
export async function renderNoteReactions(ticketId, noteIndex) {
    const container = document.getElementById(`reactions-${ticketId}-${noteIndex}`);
    if (!container) return;

    try {
        // Fetch reaction counts
        const { data, error } = await _supabase.rpc('get_note_reaction_counts', {
            p_ticket_id: ticketId,
            p_note_index: noteIndex
        });

        if (error) throw error;

        // Create reactions map
        const reactionsMap = {};
        (data || []).forEach(row => {
            reactionsMap[row.reaction_type] = {
                count: parseInt(row.count),
                userReacted: row.user_reacted
            };
        });

        // Render reaction buttons
        let html = '<div class="flex items-center gap-1 flex-wrap">';

        // Add reaction picker button
        html += `
            <div class="relative reaction-picker-wrapper"
                onmouseenter="window.tickets.showReactionPicker(${ticketId}, ${noteIndex})"
                onmouseleave="window.tickets.startHideReactionPicker(${ticketId}, ${noteIndex})">
                <button
                    class="reaction-add-btn p-1 rounded-full hover:bg-gray-700/50 transition-all text-gray-400 hover:text-white text-sm"
                    title="Add reaction">
                    <span class="text-lg">😊</span>
                </button>
                <div id="reaction-picker-${ticketId}-${noteIndex}"
                    class="reaction-picker hidden absolute bottom-full left-0 mb-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-2 flex gap-1 z-50">
                    ${Object.entries(REACTION_TYPES).map(([type, config]) => `
                        <button
                            onclick="event.stopPropagation(); window.tickets.addReaction(${ticketId}, ${noteIndex}, '${type}')"
                            class="reaction-picker-btn p-2 rounded hover:bg-gray-700 transition-all text-2xl hover:scale-125"
                            title="${config.name}">
                            ${config.emoji}
                        </button>
                    `).join('')}
                </div>
            </div>
        `;

        // Render existing reactions
        Object.entries(REACTION_TYPES).forEach(([type, config]) => {
            const reactionData = reactionsMap[type];
            if (reactionData && reactionData.count > 0) {
                const isActive = reactionData.userReacted;
                html += `
                    <button
                        onclick="event.stopPropagation(); window.tickets.toggleReaction(${ticketId}, ${noteIndex}, '${type}')"
                        onmouseenter="window.tickets.showReactionTooltip(${ticketId}, ${noteIndex}, '${type}', this)"
                        onmouseleave="window.tickets.hideReactionTooltip()"
                        class="reaction-btn ${isActive ? 'reaction-active' : ''} flex items-center gap-1 px-2 py-1 rounded-full text-xs transition-all hover:scale-110"
                        style="border: 1px solid ${config.color}40; background: ${isActive ? config.color + '20' : 'transparent'};"
                        data-reaction-type="${type}">
                        <span class="text-base">${config.emoji}</span>
                        <span class="font-semibold" style="color: ${config.color};">${reactionData.count}</span>
                    </button>
                `;
            }
        });

        html += '</div>';
        container.innerHTML = html;

    } catch (error) {
        console.error('[Reactions] Error rendering:', error);
        container.innerHTML = '<span class="text-xs text-red-400">Failed to load reactions</span>';
    }
}

/**
 * Toggle reaction (add if not exists, remove if exists)
 */
export async function toggleReaction(ticketId, noteIndex, reactionType) {
    try {
        const { data, error } = await _supabase.rpc('toggle_note_reaction', {
            p_ticket_id: ticketId,
            p_note_index: noteIndex,
            p_reaction_type: reactionType
        });

        if (error) throw error;

        // Refresh reactions display
        await renderNoteReactions(ticketId, noteIndex);

    } catch (error) {
        console.error('[Reactions] Error toggling:', error);
        showNotification('Error', 'Could not add reaction', 'error');
    }
}

/**
 * Add reaction from picker
 */
export async function addReaction(ticketId, noteIndex, reactionType) {
    // Close picker immediately
    hideReactionPicker(ticketId, noteIndex);

    // Add reaction
    await toggleReaction(ticketId, noteIndex, reactionType);
}

/**
 * Show reaction picker on hover
 */
let hidePickerTimeout = null;

export function showReactionPicker(ticketId, noteIndex) {
    // Clear any pending hide timeout
    if (hidePickerTimeout) {
        clearTimeout(hidePickerTimeout);
        hidePickerTimeout = null;
    }

    const picker = document.getElementById(`reaction-picker-${ticketId}-${noteIndex}`);
    if (!picker) return;

    // Close all other pickers
    document.querySelectorAll('.reaction-picker').forEach(p => {
        if (p.id !== `reaction-picker-${ticketId}-${noteIndex}`) {
            p.classList.add('hidden');
        }
    });

    picker.classList.remove('hidden');
}

/**
 * Start timer to hide reaction picker
 */
export function startHideReactionPicker(ticketId, noteIndex) {
    // Clear any existing timeout
    if (hidePickerTimeout) {
        clearTimeout(hidePickerTimeout);
    }

    // Hide after 300ms delay (allows user to move mouse to picker)
    hidePickerTimeout = setTimeout(() => {
        hideReactionPicker(ticketId, noteIndex);
    }, 300);
}

/**
 * Hide reaction picker
 */
export function hideReactionPicker(ticketId, noteIndex) {
    const picker = document.getElementById(`reaction-picker-${ticketId}-${noteIndex}`);
    if (picker) {
        picker.classList.add('hidden');
    }
    hidePickerTimeout = null;
}

/**
 * Show tooltip with users who reacted
 */
let reactionTooltip = null;
let reactionTooltipTimeout = null;

export async function showReactionTooltip(ticketId, noteIndex, reactionType, buttonElement) {
    // Clear any existing timeout
    clearTimeout(reactionTooltipTimeout);

    try {
        // Fetch users who reacted
        const { data, error } = await _supabase.rpc('get_reaction_users', {
            p_ticket_id: ticketId,
            p_note_index: noteIndex,
            p_reaction_type: reactionType
        });

        if (error) throw error;

        if (!data || data.length === 0) return;

        // Create tooltip
        if (!reactionTooltip) {
            reactionTooltip = document.createElement('div');
            reactionTooltip.className = 'reaction-tooltip';
            document.body.appendChild(reactionTooltip);
        }

        const usernames = data.map(u => u.username).join(', ');
        const reactionConfig = REACTION_TYPES[reactionType];
        reactionTooltip.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="text-lg">${reactionConfig.emoji}</span>
                <span class="text-sm">${usernames}</span>
            </div>
        `;

        // Position tooltip
        const rect = buttonElement.getBoundingClientRect();
        reactionTooltip.style.left = `${rect.left + rect.width / 2}px`;
        reactionTooltip.style.top = `${rect.top - 10}px`;
        reactionTooltip.classList.add('show');

    } catch (error) {
        console.error('[Reactions] Error showing tooltip:', error);
    }
}

/**
 * Hide reaction tooltip
 */
export function hideReactionTooltip() {
    reactionTooltipTimeout = setTimeout(() => {
        if (reactionTooltip) {
            reactionTooltip.classList.remove('show');
        }
    }, 200);
}

/**
 * Close all reaction pickers when clicking outside
 */
document.addEventListener('click', (e) => {
    if (!e.target.closest('.reaction-picker-wrapper')) {
        document.querySelectorAll('.reaction-picker').forEach(picker => {
            picker.classList.add('hidden');
        });
    }
});

// ============================================
// REACTION NOTIFICATIONS
// ============================================

/**
 * Fetch and display unread reaction notifications
 */
export async function fetchReactionNotifications() {
    if (!appState.currentUser) return;

    try {
        const { data, error } = await _supabase
            .from('reaction_notifications')
            .select('*')
            .eq('note_author_id', appState.currentUser.id)
            .eq('is_read', false)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Display notifications
        if (data && data.length > 0) {
            data.forEach(notification => {
                displayReactionNotification(notification);
            });
        }
    } catch (error) {
        console.error('[Reactions] Error fetching notifications:', error);
    }
}

/**
 * Display a reaction notification
 */
function displayReactionNotification(notification) {
    const notificationId = `reaction-notif-${notification.id}`;

    // Check if notification already displayed
    if (document.getElementById(notificationId)) return;

    const container = document.getElementById('notification-panel');
    if (!container) return;

    const reactionConfig = REACTION_TYPES[notification.reaction_type] || REACTION_TYPES.like;

    const notificationEl = document.createElement('div');
    notificationEl.id = notificationId;
    notificationEl.className = 'reaction-notification glassmorphism p-4 rounded-lg shadow-lg border cursor-pointer hover:bg-gray-700/50 transition-all fade-in';
    notificationEl.style.borderColor = reactionConfig.color + '80';
    notificationEl.onclick = () => navigateToReactedNote(notification);

    notificationEl.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-2xl"
                 style="background: ${reactionConfig.color}30;">
                ${reactionConfig.emoji}
            </div>
            <div class="flex-grow min-w-0">
                <div class="flex items-start justify-between gap-2 mb-1">
                    <p class="font-semibold text-white text-sm">
                        <span style="color: ${reactionConfig.color};">${notification.reactor_username}</span> reacted with ${reactionConfig.emoji}
                    </p>
                    <button onclick="event.stopPropagation(); tickets.dismissReactionNotification(${notification.id})"
                            class="text-gray-400 hover:text-white transition-colors flex-shrink-0">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                        </svg>
                    </button>
                </div>
                <p class="text-xs text-gray-400 mb-1">to your note in ticket #${notification.ticket_id}</p>
                <p class="text-xs text-gray-500 mt-2">${formatTimeAgo(notification.created_at)}</p>
            </div>
        </div>
    `;

    container.appendChild(notificationEl);

    // Notification stays until user manually closes it (no auto-dismiss)
}

/**
 * Navigate to the ticket and scroll to the reacted note
 */
async function navigateToReactedNote(notification) {
    try {
        // Mark as read
        await dismissReactionNotification(notification.id);

        // Find the ticket
        let ticket = [...appState.tickets, ...appState.doneTickets, ...appState.followUpTickets]
            .find(t => t.id === notification.ticket_id);

        if (!ticket) {
            showNotification('Ticket Not Found', 'Could not find the ticket', 'error');
            return;
        }

        // Expand ticket if collapsed
        const ticketElement = document.getElementById(`ticket-${notification.ticket_id}`);
        if (ticketElement) {
            const ticketBody = ticketElement.querySelector('.ticket-body');
            if (ticketBody && ticketBody.classList.contains('hidden')) {
                ticketBody.classList.remove('hidden');
            }

            // Scroll to ticket
            ticketElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Highlight the note briefly
            setTimeout(() => {
                const noteContainer = ticketElement.querySelector(`#reactions-${notification.ticket_id}-${notification.note_index}`)?.closest('.note-container');
                if (noteContainer) {
                    noteContainer.style.backgroundColor = reactionConfig.color + '20';
                    setTimeout(() => {
                        noteContainer.style.backgroundColor = '';
                    }, 2000);
                }
            }, 500);
        }
    } catch (error) {
        console.error('[Reactions] Error navigating to note:', error);
    }
}

/**
 * Dismiss a reaction notification
 */
export async function dismissReactionNotification(notificationId) {
    try {
        // Remove from DOM
        const notificationEl = document.getElementById(`reaction-notif-${notificationId}`);
        if (notificationEl) {
            notificationEl.style.opacity = '0';
            setTimeout(() => notificationEl.remove(), 300);
        }

        // Mark as read in database
        const { error } = await _supabase
            .from('reaction_notifications')
            .update({ is_read: true })
            .eq('id', notificationId);

        if (error) throw error;
    } catch (error) {
        console.error('[Reactions] Error dismissing notification:', error);
    }
}

// Export for window.tickets
window.tickets = window.tickets || {};
window.tickets.toggleReaction = toggleReaction;
window.tickets.addReaction = addReaction;
window.tickets.showReactionPicker = showReactionPicker;
window.tickets.startHideReactionPicker = startHideReactionPicker;
window.tickets.hideReactionPicker = hideReactionPicker;
window.tickets.showReactionTooltip = showReactionTooltip;
window.tickets.hideReactionTooltip = hideReactionTooltip;
window.tickets.renderNoteReactions = renderNoteReactions;
window.tickets.fetchReactionNotifications = fetchReactionNotifications;
window.tickets.dismissReactionNotification = dismissReactionNotification;
window.tickets.deleteTicket = deleteTicket;
window.tickets.REACTION_TYPES = REACTION_TYPES;
