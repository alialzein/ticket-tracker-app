// js/knowledge-base.js
import { _supabase } from './config.js';
import { appState } from './state.js';
import { awardPoints } from './main.js';

// Constants for client types and issue types
export const CLIENT_TYPES = ['MM', 'SAAS', 'Prem', 'Any'];
export const ISSUE_TYPES = [
    'General issue',
    'HTTP connection',
    'MNP/HLR',
    'DB Issue',
    'GW Issue',
    'APP server issue',
    'Queries'
];

// Current state
let currentClientType = 'Any';
let currentSearchQuery = '';
let allKBEntries = [];
let selectedClientTypes = ['Any']; // Track multiple selected client types

/**
 * Initialize and render the Knowledge Base main view
 */
export async function renderKnowledgeBaseView() {
    // Remove glow effect when user opens KB tab
    removeKBTabGlow();

    const container = document.getElementById('knowledge-base-content');
    if (!container) return;

    container.innerHTML = `
        <div class="space-y-4">
            <!-- Client Type Filter (Multiple Selection) -->
            <div class="bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
                <h3 class="text-sm font-bold text-white mb-3 flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"/>
                    </svg>
                    Filter by Client Type
                </h3>
                <div class="flex flex-wrap gap-3">
                    ${CLIENT_TYPES.map(type => `
                        <label class="flex items-center gap-2 cursor-pointer group">
                            <input
                                type="checkbox"
                                id="kb-filter-${type}"
                                value="${type}"
                                ${selectedClientTypes.includes(type) ? 'checked' : ''}
                                onchange="knowledgeBase.toggleClientType('${type}')"
                                class="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500 focus:ring-2"
                            />
                            <span class="text-sm font-medium text-gray-300 group-hover:text-white transition-colors">${type}</span>
                        </label>
                    `).join('')}
                </div>
            </div>

            <!-- Search Bar -->
            <div class="flex gap-2">
                <input
                    type="text"
                    id="kb-search-input"
                    placeholder="Search knowledge base..."
                    class="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-blue-500"
                    oninput="knowledgeBase.handleSearch(this.value)"
                />
            </div>

            <!-- Knowledge Base Content -->
            <div id="kb-entries-container" class="space-y-4">
                <div class="text-center text-gray-400 py-8">Loading...</div>
            </div>
        </div>
    `;

    // Load KB entries
    await loadKBEntries();
    renderKBEntries();
}

/**
 * Load all knowledge base entries from database
 */
async function loadKBEntries() {
    try {
        const { data, error } = await _supabase
            .from('knowledge_base')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Supabase error loading KB entries:', error);
            throw error;
        }
        allKBEntries = data || [];
        console.log('Loaded KB entries:', allKBEntries.length);
    } catch (error) {
        console.error('Error loading KB entries:', error);
        allKBEntries = [];
    }
}

/**
 * Toggle client type selection (multiple selection)
 */
export function toggleClientType(clientType) {
    const index = selectedClientTypes.indexOf(clientType);

    if (index === -1) {
        // Add to selection
        selectedClientTypes.push(clientType);
    } else {
        // Remove from selection (but keep at least one selected)
        if (selectedClientTypes.length > 1) {
            selectedClientTypes.splice(index, 1);
        } else {
            // Don't allow unchecking if it's the last one - re-check it
            const checkbox = document.getElementById(`kb-filter-${clientType}`);
            if (checkbox) checkbox.checked = true;
            return;
        }
    }

    console.log('Selected client types:', selectedClientTypes);

    // Re-render entries with new filter
    renderKBEntries();
}

/**
 * Switch to a different client type tab (legacy - kept for compatibility)
 */
export function switchClientType(clientType) {
    currentClientType = clientType;

    // Update tab styling
    CLIENT_TYPES.forEach(type => {
        const tab = document.getElementById(`kb-tab-${type}`);
        if (tab) {
            if (type === clientType) {
                tab.className = 'kb-tab px-4 py-2 rounded-t-lg font-semibold transition-all bg-blue-600 text-white';
            } else {
                tab.className = 'kb-tab px-4 py-2 rounded-t-lg font-semibold transition-all bg-gray-700 text-gray-300 hover:bg-gray-600';
            }
        }
    });

    renderKBEntries();
}

/**
 * Handle search input
 */
export function handleSearch(query) {
    currentSearchQuery = query.toLowerCase();
    renderKBEntries();
}

/**
 * Render KB entries based on current filters
 */
export function renderKBEntries() {
    const container = document.getElementById('kb-entries-container');
    if (!container) return;

    // If there's a search query, search across ALL categories
    // Otherwise, filter by selected client types only
    let filteredEntries;

    if (currentSearchQuery) {
        // Search mode: search across all client types
        filteredEntries = allKBEntries.filter(entry => {
            const matchesSearch = entry.title.toLowerCase().includes(currentSearchQuery) ||
                entry.steps.toLowerCase().includes(currentSearchQuery) ||
                entry.issue_type.toLowerCase().includes(currentSearchQuery) ||
                entry.client_type.toLowerCase().includes(currentSearchQuery);
            return matchesSearch;
        });

        // Sort results: prioritize selected client types first
        filteredEntries.sort((a, b) => {
            const aIsSelected = selectedClientTypes.includes(a.client_type) || a.client_type === 'Any';
            const bIsSelected = selectedClientTypes.includes(b.client_type) || b.client_type === 'Any';

            if (aIsSelected && !bIsSelected) return -1;
            if (!aIsSelected && bIsSelected) return 1;
            return 0;
        });
    } else {
        // Normal mode: filter by selected client types only
        console.log('Filtering with selected types:', selectedClientTypes);
        console.log('Total KB entries:', allKBEntries.length);

        filteredEntries = allKBEntries.filter(entry => {
            const matchesClientType = selectedClientTypes.includes(entry.client_type) ||
                                       entry.client_type === 'Any' ||
                                       selectedClientTypes.includes('Any');

            console.log(`Entry: ${entry.title}, Type: ${entry.client_type}, Matches: ${matchesClientType}`);
            return matchesClientType;
        });

        console.log('Filtered entries count:', filteredEntries.length);
    }

    if (filteredEntries.length === 0) {
        container.innerHTML = `
            <div class="text-center text-gray-400 py-8">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p>No knowledge base entries found</p>
                <p class="text-sm mt-2">Create one from any ticket</p>
            </div>
        `;
        return;
    }

    // Group entries by issue type
    const groupedEntries = {};
    ISSUE_TYPES.forEach(issueType => {
        groupedEntries[issueType] = filteredEntries.filter(entry => entry.issue_type === issueType);
    });

    // Render grouped entries with collapse/expand functionality
    let html = '';
    ISSUE_TYPES.forEach((issueType, index) => {
        const entries = groupedEntries[issueType];
        if (entries.length > 0) {
            const sectionId = `kb-section-${index}`;
            html += `
                <div class="space-y-2">
                    <h3
                        class="text-lg font-semibold text-blue-400 border-b border-gray-700 pb-2 cursor-pointer flex items-center justify-between hover:text-blue-300 transition-colors"
                        onclick="knowledgeBase.toggleSection('${sectionId}')"
                    >
                        <span>${issueType} (${entries.length})</span>
                        <svg id="${sectionId}-icon" class="w-5 h-5 transform transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </h3>
                    <div id="${sectionId}" class="space-y-2">
                        ${entries.map(entry => renderKBCard(entry)).join('')}
                    </div>
                </div>
            `;
        }
    });

    container.innerHTML = html;
}

/**
 * Render a single KB entry card
 */
function renderKBCard(entry, showClientTypeBadge = true) {
    const createdDate = new Date(entry.created_at).toLocaleDateString();
    const isSelectedType = selectedClientTypes.includes(entry.client_type) || entry.client_type === 'Any';

    // Highlight entries from selected client types when searching
    const highlightClass = currentSearchQuery && isSelectedType ? 'ring-2 ring-blue-500/50' : '';

    // Extract username from email or use display name
    // If created_by_name contains '@', extract the username part before @
    let username = entry.created_by_name || 'Unknown';
    if (username.includes('@')) {
        username = username.split('@')[0];
    }

    return `
        <div
            onclick="knowledgeBase.openKBDetail(${entry.id})"
            class="p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-blue-500 cursor-pointer transition-all hover:shadow-lg hover:shadow-blue-500/20 ${highlightClass}"
        >
            <div class="flex justify-between items-center gap-4">
                <!-- Left: Subject and Ticket Link -->
                <div class="flex items-center gap-3 flex-1">
                    <h4 class="text-white font-semibold">${entry.title}</h4>
                    ${entry.ticket_id ? `<a href="#" onclick="event.stopPropagation(); window.ticketManager.openTicketModal(${entry.ticket_id})" class="text-blue-400 hover:text-blue-300 text-sm flex items-center gap-1 transition-colors"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z"></path></svg>Ticket #${entry.ticket_id}</a>` : ''}
                </div>

                <!-- Right: Username, Created Date, and Badge -->
                <div class="flex items-center gap-3 text-sm">
                    <span class="text-gray-400">👤 ${username}</span>
                    <span class="text-gray-400">📅 ${createdDate}</span>
                    ${showClientTypeBadge ? `<span class="px-2 py-1 ${isSelectedType ? 'bg-blue-600' : 'bg-gray-600'} text-white text-xs rounded font-semibold">${entry.client_type}</span>` : ''}
                </div>
            </div>
        </div>
    `;
}

/**
 * Open KB creation modal from a ticket
 */
export async function openKBCreationModal(ticketId) {
    // Check if KB already exists for this ticket
    const existingKB = await getKBByTicketId(ticketId);
    if (existingKB) {
        // Navigate to existing KB
        openKBDetail(existingKB.id);
        return;
    }

    // Get ticket details
    const { data: ticketData, error } = await _supabase
        .from('tickets')
        .select('*')
        .eq('id', ticketId);

    if (error) {
        console.error('Error fetching ticket:', error);
        return;
    }

    const ticket = ticketData && ticketData.length > 0 ? ticketData[0] : null;
    if (!ticket) {
        console.error('Ticket not found');
        return;
    }

    // Create modal HTML
    const modalHTML = `
        <div id="kb-creation-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div class="bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                <div class="p-6 border-b border-gray-700 flex justify-between items-center sticky top-0 bg-gray-800 z-10">
                    <h2 class="text-xl font-bold text-white">Add to Knowledge Base</h2>
                    <button onclick="knowledgeBase.closeKBCreationModal()" class="text-gray-400 hover:text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
                <div class="p-6 space-y-4">
                    <!-- Title Input -->
                    <div>
                        <label class="block text-sm font-semibold text-gray-300 mb-2">Knowledge Base Title *</label>
                        <input
                            type="text"
                            id="kb-title-input"
                            class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                            placeholder="Enter a descriptive title..."
                            onblur="knowledgeBase.checkSimilarKB()"
                        />
                        <div id="kb-similarity-warning" class="hidden mt-2 p-3 bg-yellow-900/30 border border-yellow-600 rounded-lg">
                            <p class="text-yellow-400 text-sm font-semibold mb-2">Similar knowledge base entries found (click to view):</p>
                            <div id="kb-similar-entries" class="space-y-1"></div>
                        </div>
                    </div>

                    <!-- Client Type Dropdown -->
                    <div>
                        <label class="block text-sm font-semibold text-gray-300 mb-2">Client Type *</label>
                        <select
                            id="kb-client-type-select"
                            class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                        >
                            ${CLIENT_TYPES.map(type => `<option value="${type}">${type}</option>`).join('')}
                        </select>
                    </div>

                    <!-- Issue Type Dropdown -->
                    <div>
                        <label class="block text-sm font-semibold text-gray-300 mb-2">Issue Type *</label>
                        <select
                            id="kb-issue-type-select"
                            class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                        >
                            ${ISSUE_TYPES.map(type => `<option value="${type}">${type}</option>`).join('')}
                        </select>
                    </div>

                    <!-- Resolution Steps -->
                    <div>
                        <label class="block text-sm font-semibold text-gray-300 mb-2">Resolution Steps *</label>
                        <div class="text-xs text-gray-400 mb-2">You can paste images directly into the editor (Ctrl+V)</div>
                        <div
                            id="kb-steps-editor"
                            class="min-h-[300px] px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500 overflow-y-auto"
                            contenteditable="true"
                            placeholder="Describe the steps to resolve this issue..."
                        ></div>
                    </div>

                    <!-- Linked Ticket Info -->
                    <div class="p-4 bg-gray-700 rounded-lg border border-gray-600">
                        <p class="text-sm text-gray-300">
                            <span class="font-semibold">Linked Ticket:</span>
                            <span class="text-blue-400">#${ticket.ticket_id} - ${ticket.subject}</span>
                        </p>
                    </div>
                </div>
                <div class="p-6 border-t border-gray-700 flex justify-end gap-3 sticky bottom-0 bg-gray-800">
                    <button
                        onclick="knowledgeBase.closeKBCreationModal()"
                        class="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onclick="knowledgeBase.saveKBEntry(${ticketId})"
                        class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Save to Knowledge Base
                    </button>
                </div>
            </div>
        </div>
    `;

    // Add modal to DOM
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Setup paste handler for images
    setupImagePasteHandler();
}

/**
 * Setup image paste handler for the editor
 */
function setupImagePasteHandler() {
    const editor = document.getElementById('kb-steps-editor');
    if (!editor) return;

    editor.addEventListener('paste', async (e) => {
        const items = e.clipboardData.items;

        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const blob = items[i].getAsFile();
                const reader = new FileReader();

                reader.onload = (event) => {
                    const img = document.createElement('img');
                    img.src = event.target.result;
                    img.style.maxWidth = '100%';
                    img.style.borderRadius = '8px';
                    img.style.marginTop = '8px';
                    img.style.marginBottom = '8px';

                    // Insert at cursor position
                    const selection = window.getSelection();
                    if (selection.rangeCount > 0) {
                        const range = selection.getRangeAt(0);
                        range.deleteContents();
                        range.insertNode(img);

                        // Move cursor after image
                        range.setStartAfter(img);
                        range.collapse(true);
                        selection.removeAllRanges();
                        selection.addRange(range);
                    } else {
                        editor.appendChild(img);
                    }
                };

                reader.readAsDataURL(blob);
            }
        }
    });
}

/**
 * Check for similar KB entries when title is entered
 */
export async function checkSimilarKB() {
    // Try both input IDs (create modal uses kb-title-input, edit modal uses kb-title)
    const titleInput = document.getElementById('kb-title-input') || document.getElementById('kb-title');
    const warningDiv = document.getElementById('kb-similarity-warning');
    const similarEntriesDiv = document.getElementById('kb-similar-entries');

    if (!titleInput || !warningDiv || !similarEntriesDiv) return;

    const title = titleInput.value.trim().toLowerCase();

    if (title.length < 3) {
        warningDiv.classList.add('hidden');
        return;
    }

    // Get the current KB ID if we're editing (to exclude it from similar results)
    const currentKbId = document.getElementById('kb-edit-id')?.value;

    // Find similar entries using simple string matching (40% similarity threshold)
    const similarEntries = allKBEntries.filter(entry => {
        // Skip the current entry if editing
        if (currentKbId && entry.id.toString() === currentKbId) {
            return false;
        }

        const entryTitle = entry.title.toLowerCase();
        const similarity = calculateSimilarity(title, entryTitle);

        // 40% similarity or contains check
        return similarity >= 0.4 || entryTitle.includes(title) || title.includes(entryTitle);
    });

    if (similarEntries.length > 0) {
        similarEntriesDiv.innerHTML = similarEntries.slice(0, 5).map(entry => {
            const similarity = calculateSimilarity(title, entry.title.toLowerCase());
            const percentage = Math.round(similarity * 100);
            return `
                <div class="text-sm text-yellow-300 cursor-pointer hover:text-yellow-200" onclick="knowledgeBase.openKBDetail(${entry.id})">
                    • ${entry.title} (${entry.client_type} - ${entry.issue_type}) - ${percentage}% match
                </div>
            `;
        }).join('');
        warningDiv.classList.remove('hidden');
    } else {
        warningDiv.classList.add('hidden');
    }
}

/**
 * Calculate similarity between two strings (simple implementation)
 */
function calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
        for (let j = 1; j <= str1.length; j++) {
            if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[str2.length][str1.length];
}

/**
 * Send browser notification to all users about new KB entry via realtime channel
 */
async function sendKBNotificationToAllUsers(kbEntry, title, clientType, issueType) {
    try {
        const creatorName = appState.currentUser.full_name || appState.currentUser.email.split('@')[0];

        // Broadcast the KB creation event to all users via Supabase realtime
        const channel = _supabase.channel('kb-notifications');

        await channel.send({
            type: 'broadcast',
            event: 'kb_created',
            payload: {
                kb_id: kbEntry.id,
                title: title,
                client_type: clientType,
                issue_type: issueType,
                creator: creatorName,
                creator_id: appState.currentUser.id,
                created_at: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Error broadcasting KB notification:', error);
        throw error;
    }
}

/**
 * Save KB entry to database
 */
export async function saveKBEntry(ticketId) {
    const title = document.getElementById('kb-title-input')?.value.trim();
    const clientType = document.getElementById('kb-client-type-select')?.value;
    const issueType = document.getElementById('kb-issue-type-select')?.value;
    const editor = document.getElementById('kb-steps-editor');

    if (!title || !clientType || !issueType || !editor) {
        alert('Please fill in all required fields');
        return;
    }

    const stepsHTML = editor.innerHTML.trim();
    if (!stepsHTML || stepsHTML === '<br>') {
        alert('Please enter resolution steps');
        return;
    }

    // Extract plain text for searching
    const stepsText = editor.innerText;

    // Prepare content as JSONB (store HTML content with images)
    const content = {
        html: stepsHTML,
        text: stepsText
    };

    try {
        const { data, error } = await _supabase
            .from('knowledge_base')
            .insert({
                title,
                client_type: clientType,
                issue_type: issueType,
                content,
                steps: stepsText,
                ticket_id: ticketId,
                created_by: appState.currentUser.id,
                created_by_name: appState.currentUser.user_metadata?.['display name'] || appState.currentUser.email?.split('@')[0] || 'Unknown'
            })
            .select();

        if (error) throw error;

        const newKB = data && data.length > 0 ? data[0] : null;
        if (!newKB) throw new Error('Failed to create knowledge base entry');

        // Award 5 points for creating a knowledge base entry
        try {
            await awardPoints('KB_CREATED', {
                kbId: newKB.id,
                ticketId: ticketId,
                title: title
            });
        } catch (pointsError) {
            console.error('Error awarding points:', pointsError);
            // Don't fail the KB creation if points fail
        }

        // Send notification to all users about new KB entry
        try {
            await sendKBNotificationToAllUsers(newKB, title, clientType, issueType);
        } catch (notifError) {
            console.error('Error sending KB notifications:', notifError);
            // Don't fail the KB creation if notification fails
        }

        // Close modal
        closeKBCreationModal();

        // Reload KB entries
        await loadKBEntries();

        // Update the ticket button to "Go to Knowledge Base"
        if (window.tickets && window.tickets.updateTicketKBButton) {
            await window.tickets.updateTicketKBButton(ticketId);
        }

        alert('Knowledge base entry created successfully! You earned 5 points!');
    } catch (error) {
        console.error('Error saving KB entry:', error);
        alert('Error saving knowledge base entry. Please try again.');
    }
}

/**
 * Close KB creation modal
 */
export function closeKBCreationModal() {
    const modal = document.getElementById('kb-creation-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * Get KB entry by ticket ID
 */
async function getKBByTicketId(ticketId) {
    try {
        const { data, error } = await _supabase
            .from('knowledge_base')
            .select('*')
            .eq('ticket_id', ticketId);

        if (error) return null;
        return data && data.length > 0 ? data[0] : null;
    } catch (error) {
        return null;
    }
}

/**
 * Open KB detail view
 */
export async function openKBDetail(kbId) {
    try {
        const { data: kbData, error } = await _supabase
            .from('knowledge_base')
            .select('*')
            .eq('id', kbId);

        if (error) throw error;

        const kb = kbData && kbData.length > 0 ? kbData[0] : null;
        if (!kb) throw new Error('Knowledge base entry not found');

        // Extract username from email if needed
        if (kb.created_by_name && kb.created_by_name.includes('@')) {
            kb.created_by_name = kb.created_by_name.split('@')[0];
        }

        // Get ticket details if linked
        let ticketInfo = '';
        if (kb.ticket_id) {
            const { data: ticketData, error: ticketError } = await _supabase
                .from('tickets')
                .select('*')
                .eq('id', kb.ticket_id);

            if (ticketError) {
                console.error('Error fetching ticket:', ticketError);
            }

            const ticket = ticketData && ticketData.length > 0 ? ticketData[0] : null;

            if (ticket) {
                ticketInfo = `
                    <div class="px-3 py-2 bg-gray-700/50 rounded border border-gray-600/50">
                        <p class="text-xs text-gray-400 mb-1">Linked Ticket</p>
                        <div
                            onclick="knowledgeBase.navigateToTicket(${kb.ticket_id})"
                            class="cursor-pointer hover:text-blue-300 transition-colors"
                        >
                            <p class="text-blue-400 font-semibold text-sm">#${ticket.id} - ${ticket.subject}</p>
                        </div>
                    </div>
                `;
            }
        }

        const modalHTML = `
            <div id="kb-detail-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div class="bg-gray-800 rounded-lg shadow-xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
                    <div class="p-6 border-b border-gray-700 flex justify-between items-center sticky top-0 bg-gray-800 z-10">
                        <div class="flex-1">
                            <h2 class="text-2xl font-bold text-white mb-2">${kb.title}</h2>
                            <div class="flex items-center gap-3 text-sm text-gray-400">
                                <span class="px-2 py-1 bg-blue-600 text-white text-xs rounded">${kb.client_type}</span>
                                <span class="px-2 py-1 bg-purple-600 text-white text-xs rounded">${kb.issue_type}</span>
                                <span>📝 ${kb.created_by_name}</span>
                                <span>📅 ${new Date(kb.created_at).toLocaleDateString()}</span>
                            </div>
                        </div>
                        <button onclick="knowledgeBase.closeKBDetail()" class="text-gray-400 hover:text-white">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div class="p-6 space-y-6">
                        <div>
                            <div class="flex items-center justify-between mb-3">
                                <h3 class="text-lg font-semibold text-blue-400">Resolution Steps</h3>
                                <button
                                    onclick="knowledgeBase.copyResolutionSteps(${kb.id})"
                                    class="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded-lg transition-all hover-scale"
                                    title="Copy resolution steps to clipboard"
                                >
                                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                                    </svg>
                                    Copy
                                </button>
                            </div>
                            <div id="kb-resolution-content-${kb.id}" class="prose prose-invert max-w-none p-4 bg-gray-700 rounded-lg">
                                ${kb.content.html || kb.steps}
                            </div>
                        </div>
                        ${ticketInfo}
                    </div>
                    <div class="p-6 border-t border-gray-700 flex justify-between sticky bottom-0 bg-gray-800">
                        <div class="flex gap-3">
                            ${(kb.created_by === appState.currentUser.id || appState.currentUserRole === 'admin' || appState.currentUserRole === 'visitor_admin') ? `
                                <button
                                    onclick="knowledgeBase.editKBEntry(${kb.id})"
                                    class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                                >
                                    Edit
                                </button>
                                <button
                                    onclick="knowledgeBase.deleteKBEntry(${kb.id})"
                                    class="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                                >
                                    Delete
                                </button>
                            ` : ''}
                        </div>
                        <button
                            onclick="knowledgeBase.closeKBDetail()"
                            class="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
    } catch (error) {
        console.error('Error loading KB detail:', error);
        alert('Error loading knowledge base entry');
    }
}

/**
 * Copy resolution steps to clipboard
 */
export async function copyResolutionSteps(kbId) {
    const contentElement = document.getElementById(`kb-resolution-content-${kbId}`);
    if (!contentElement) return;

    try {
        // Get the text content (strips HTML formatting)
        const textContent = contentElement.innerText;

        // Copy to clipboard
        await navigator.clipboard.writeText(textContent);

        // Show success feedback - temporarily change button text
        const button = event.target.closest('button');
        const originalHTML = button.innerHTML;

        button.innerHTML = `
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
            </svg>
            Copied!
        `;
        button.classList.add('bg-green-600', 'hover:bg-green-700');
        button.classList.remove('bg-indigo-600', 'hover:bg-indigo-700');

        // Reset after 2 seconds
        setTimeout(() => {
            button.innerHTML = originalHTML;
            button.classList.remove('bg-green-600', 'hover:bg-green-700');
            button.classList.add('bg-indigo-600', 'hover:bg-indigo-700');
        }, 2000);

    } catch (error) {
        console.error('Error copying to clipboard:', error);
        alert('Failed to copy to clipboard');
    }
}

/**
 * Close KB detail modal
 */
export function closeKBDetail() {
    const modal = document.getElementById('kb-detail-modal');
    if (modal) {
        modal.remove();
    }
}

/**
 * Navigate to ticket from KB detail
 */
export async function navigateToTicket(ticketId) {
    closeKBDetail();

    // First, check if ticket exists in state and determine which view it belongs to
    let targetView = 'tickets';
    let ticketInState = null;

    if (window.appState) {
        // Check in all ticket arrays
        const allTickets = [
            ...(window.appState.tickets || []),
            ...(window.appState.doneTickets || []),
            ...(window.appState.followUpTickets || [])
        ];
        ticketInState = allTickets.find(t => t.id === ticketId);

        if (ticketInState) {
            // Determine the correct view based on ticket status
            if (ticketInState.status === 'Done') {
                targetView = 'done';
            } else if (ticketInState.needs_followup) {
                targetView = 'followUp';
            } else {
                targetView = 'tickets';
            }
        } else {
            // Fetch the ticket to determine its status
            try {
                const { data, error } = await _supabase
                    .from('tickets')
                    .select('status, needs_followup')
                    .eq('id', ticketId);

                if (!error && data && data.length > 0) {
                    const ticket = data[0];
                    if (ticket.status === 'Done') {
                        targetView = 'done';
                    } else if (ticket.needs_followup) {
                        targetView = 'followUp';
                    }
                }
            } catch (err) {
                console.error('Error fetching ticket status:', err);
            }
        }
    }

    // Switch to the appropriate view
    if (window.ui && window.ui.switchView) {
        await window.ui.switchView(targetView);
    }

    // Wait for view to switch and tickets to render
    setTimeout(() => {
        const ticketElement = document.getElementById(`ticket-${ticketId}`);

        if (ticketElement) {
            ticketElement.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Wait for scroll, then expand the ticket
            setTimeout(() => {
                if (window.tickets && window.tickets.handleTicketToggle) {
                    window.tickets.handleTicketToggle(ticketId);
                }
            }, 500);
        } else {
            // Force fetch tickets for the current view
            if (window.tickets && window.tickets.fetchTickets) {
                window.tickets.fetchTickets(true).then(() => {
                    setTimeout(() => {
                        const retryElement = document.getElementById(`ticket-${ticketId}`);
                        if (retryElement) {
                            retryElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            setTimeout(() => {
                                if (window.tickets && window.tickets.handleTicketToggle) {
                                    window.tickets.handleTicketToggle(ticketId);
                                }
                            }, 500);
                        } else {
                            alert(`Could not find ticket #${ticketId}. It may have been deleted.`);
                        }
                    }, 800);
                });
            }
        }
    }, 600);
}

/**
 * Delete KB entry
 */
export async function deleteKBEntry(kbId) {
    if (!confirm('Are you sure you want to delete this knowledge base entry? This action cannot be undone.')) {
        return;
    }

    try {
        const { error } = await _supabase
            .from('knowledge_base')
            .delete()
            .eq('id', kbId);

        if (error) throw error;

        closeKBDetail();

        // Reload KB entries and re-render the view
        await loadKBEntries();
        renderKBEntries();

        alert('Knowledge base entry deleted successfully!');
    } catch (error) {
        console.error('Error deleting KB entry:', error);
        alert('Error deleting knowledge base entry. Please try again.');
    }
}

/**
 * Edit KB entry - opens edit modal with existing data
 */
export async function editKBEntry(kbId) {
    try {
        // Fetch the KB entry
        const { data: kbData, error } = await _supabase
            .from('knowledge_base')
            .select('*')
            .eq('id', kbId);

        if (error) throw error;

        const kb = kbData && kbData.length > 0 ? kbData[0] : null;
        if (!kb) {
            alert('Knowledge base entry not found');
            return;
        }

        // Close detail modal
        closeKBDetail();

        // Get ticket details if linked
        let ticketInfo = '';
        if (kb.ticket_id) {
            const { data: ticketData, error: ticketError } = await _supabase
                .from('tickets')
                .select('*')
                .eq('id', kb.ticket_id);

            if (ticketError) {
                console.error('Error fetching ticket:', ticketError);
            }

            const ticket = ticketData && ticketData.length > 0 ? ticketData[0] : null;
            if (ticket) {
                ticketInfo = `
                    <div class="mb-4 px-3 py-2 bg-gray-700/50 rounded border border-gray-600/50">
                        <p class="text-xs text-gray-400">Linked: <span class="text-blue-400 font-semibold">#${ticket.id}</span></p>
                    </div>
                `;
            }
        }

        // Create edit modal HTML with existing data
        const modalHTML = `
            <div id="kb-creation-modal" class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                <div class="bg-gray-800 rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                    <div class="p-6 border-b border-gray-700 flex justify-between items-center sticky top-0 bg-gray-800 z-10">
                        <h2 class="text-xl font-bold text-white">Edit Knowledge Base Entry</h2>
                        <button onclick="knowledgeBase.closeKBCreationModal()" class="text-gray-400 hover:text-white">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div class="p-6 space-y-4">
                        ${ticketInfo}

                        <input type="hidden" id="kb-edit-id" value="${kb.id}">

                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Title</label>
                            <input
                                type="text"
                                id="kb-title"
                                value="${kb.title.replace(/"/g, '&quot;')}"
                                class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                                placeholder="Enter a descriptive title"
                            >
                            <div id="kb-similarity-warning" class="hidden mt-2 p-3 bg-yellow-900/30 border border-yellow-600 rounded-lg">
                                <p class="text-yellow-400 text-sm font-semibold mb-2">Similar knowledge base entries found (click to view):</p>
                                <div id="kb-similar-entries" class="space-y-1"></div>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-medium text-gray-300 mb-2">Client Type</label>
                                <select
                                    id="kb-client-type"
                                    class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                                >
                                    ${CLIENT_TYPES.map(type => `<option value="${type}" ${type === kb.client_type ? 'selected' : ''}>${type}</option>`).join('')}
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-medium text-gray-300 mb-2">Issue Type</label>
                                <select
                                    id="kb-issue-type"
                                    class="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
                                >
                                    ${ISSUE_TYPES.map(type => `<option value="${type}" ${type === kb.issue_type ? 'selected' : ''}>${type}</option>`).join('')}
                                </select>
                            </div>
                        </div>

                        <div>
                            <label class="block text-sm font-medium text-gray-300 mb-2">Resolution Steps</label>
                            <div id="kb-editor" class="bg-white text-gray-900 rounded-lg" style="min-height: 300px;"></div>
                        </div>

                        <div id="kb-similar-entries"></div>
                    </div>
                    <div class="p-6 border-t border-gray-700 flex justify-end gap-3 sticky bottom-0 bg-gray-800">
                        <button
                            onclick="knowledgeBase.closeKBCreationModal()"
                            class="px-6 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onclick="knowledgeBase.updateKBEntry()"
                            class="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            Update Entry
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);

        // Initialize Quill editor with existing content
        const quill = new Quill('#kb-editor', {
            theme: 'snow',
            modules: {
                toolbar: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    [{ 'color': [] }, { 'background': [] }],
                    ['link', 'image'],
                    ['clean']
                ]
            }
        });

        // Set existing content
        if (kb.content && kb.content.ops) {
            quill.setContents(kb.content.ops);
        } else if (kb.steps) {
            quill.setText(kb.steps);
        }

        // Add input listeners for similarity check
        document.getElementById('kb-title').addEventListener('input', checkSimilarKB);
        quill.on('text-change', checkSimilarKB);

    } catch (error) {
        console.error('Error loading KB entry for edit:', error);
        alert('Error loading knowledge base entry. Please try again.');
    }
}

/**
 * Update existing KB entry
 */
export async function updateKBEntry() {
    const kbId = document.getElementById('kb-edit-id').value;
    const title = document.getElementById('kb-title').value.trim();
    const clientType = document.getElementById('kb-client-type').value;
    const issueType = document.getElementById('kb-issue-type').value;

    if (!title) {
        alert('Please enter a title');
        return;
    }

    const editor = document.querySelector('#kb-editor .ql-editor');
    if (!editor || !editor.innerText.trim()) {
        alert('Please enter resolution steps');
        return;
    }

    try {
        const quill = Quill.find(document.getElementById('kb-editor'));
        const content = {
            ops: quill.getContents().ops,
            html: editor.innerHTML
        };
        const stepsText = editor.innerText;

        const { error } = await _supabase
            .from('knowledge_base')
            .update({
                title,
                client_type: clientType,
                issue_type: issueType,
                content,
                steps: stepsText,
                updated_at: new Date().toISOString()
            })
            .eq('id', kbId);

        if (error) throw error;

        // Close modal
        closeKBCreationModal();

        // Reload KB entries and re-render the view
        await loadKBEntries();
        renderKBEntries();

        alert('Knowledge base entry updated successfully!');
    } catch (error) {
        console.error('Error updating KB entry:', error);
        alert('Error updating knowledge base entry. Please try again.');
    }
}

// Export functions to window for onclick handlers
/**
 * Toggle collapse/expand of KB section
 */
export function toggleSection(sectionId) {
    const section = document.getElementById(sectionId);
    const icon = document.getElementById(`${sectionId}-icon`);

    if (!section || !icon) return;

    if (section.style.display === 'none') {
        // Expand
        section.style.display = '';
        icon.style.transform = 'rotate(0deg)';
    } else {
        // Collapse
        section.style.display = 'none';
        icon.style.transform = 'rotate(-90deg)';
    }
}

window.knowledgeBase = {
    renderKnowledgeBaseView,
    switchClientType,
    toggleClientType,
    handleSearch,
    renderKBEntries,
    openKBCreationModal,
    closeKBCreationModal,
    checkSimilarKB,
    saveKBEntry,
    openKBDetail,
    closeKBDetail,
    copyResolutionSteps,
    navigateToTicket,
    deleteKBEntry,
    editKBEntry,
    updateKBEntry,
    removeKBTabGlow,
    toggleSection
};

/**
 * Subscribe to KB notifications broadcast
 */
export function subscribeToKBNotifications() {
    const channel = _supabase.channel('kb-notifications');

    channel
        .on('broadcast', { event: 'kb_created' }, (payload) => {
            // Don't show notification to the creator
            if (payload.payload.creator_id === appState.currentUser?.id) {
                return;
            }

            // Show browser notification with special style
            showKBBrowserNotification(payload.payload);
        })
        .subscribe();

    return channel;
}

/**
 * Show browser notification for new KB entry with special styling
 */
function showKBBrowserNotification(data) {
    const { title, creator, client_type, issue_type } = data;

    // Use the UI notification system
    if (window.ui && window.ui.showNotification) {
        window.ui.showNotification(
            '📚 New Knowledge Base Entry',
            `${creator} added "${title}" (${client_type} - ${issue_type})`,
            'info',
            true,
            false  // Don't auto-dismiss
        );
    }

    // Add glow effect to Knowledge Base tab
    addKBTabGlow();

    // Also try browser native notification if permission granted
    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('📚 New Knowledge Base Entry', {
            body: `${creator} added "${title}"\n${client_type} - ${issue_type}`,
            icon: '/favicon.ico',
            tag: 'kb-notification',
            requireInteraction: false
        });
    }
}

/**
 * Add glow effect to KB tab
 */
function addKBTabGlow() {
    const kbTab = document.getElementById('tab-knowledge-base');
    if (kbTab && !kbTab.classList.contains('kb-new-entry-glow')) {
        kbTab.classList.add('kb-new-entry-glow');
    }
}

/**
 * Remove glow effect from KB tab when user views it
 */
export function removeKBTabGlow() {
    const kbTab = document.getElementById('tab-knowledge-base');
    if (kbTab) {
        kbTab.classList.remove('kb-new-entry-glow');
    }
}

// Initialize KB notifications subscription when module loads
if (typeof window !== 'undefined') {
    // Wait for app to be initialized
    setTimeout(() => {
        if (appState.currentUser) {
            subscribeToKBNotifications();
        }
    }, 1000);
}
