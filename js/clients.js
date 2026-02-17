import { log, logError, logWarn } from './logger.js';
// Clients Management Module
import { _supabase } from './config.js';
import { appState } from './state.js';

// State
let allClients = [];
let filteredClients = [];
let currentFilter = 'all';
let currentSearch = '';
let currentClientType = 'saas'; // 'saas' | 'prem'
let currentClientId = null;
let currentEmails = [];
let announcementBodyEditor = null;
let templateBodyEditor = null;
let quillSanitizerDisabled = false; // Track if we've disabled the sanitizer

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await initClients();
    await checkAdminAccess();
    // Don't initialize Quill editors on page load - initialize them lazily when modals open
    setupEventListeners();
    setupRealtimeSubscription();
});

async function initClients() {
    try {
        await loadClients();
        renderClients();
    } catch (error) {
        logError('Error initializing clients:', error);
        showToast('Failed to load clients', 'error');
    }
}

async function checkAdminAccess() {
    try {
        const { data: { user } } = await _supabase.auth.getUser();
        if (!user) return;

        // Get user's role from user_roles table (same as main app)
        const { data: roleData, error: roleError } = await _supabase
            .from('user_roles')
            .select('role')
            .eq('user_id', user.id)
            .single();

        if (!roleError && roleData && (roleData.role === 'admin' || roleData.role === 'visitor_admin')) {
            const smtpBtn = document.getElementById('smtp-settings-btn');
            if (smtpBtn) {
                smtpBtn.style.display = 'block';
            }
        }
    } catch (error) {
        logError('Error checking admin access:', error);
    }
}

// Helper function to process table HTML and preserve styles
function processTableHTML(htmlData) {
    if (!htmlData) {
        log('[processTableHTML] No HTML data provided');
        return null;
    }

    log('[processTableHTML] Processing table HTML...');

    // Create a temporary div and append to document to get computed styles
    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'absolute';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '-9999px';
    tempDiv.innerHTML = htmlData;
    document.body.appendChild(tempDiv);

    try {
        // Find the table
        const table = tempDiv.querySelector('table');
        if (!table) {
            log('[processTableHTML] No table found in HTML');
            document.body.removeChild(tempDiv);
            return null;
        }

        log('[processTableHTML] Table found, processing cells...');

        // Apply email-safe styling to the table
        table.setAttribute('border', '1');
        table.setAttribute('cellpadding', '8');
        table.setAttribute('cellspacing', '0');
        table.style.cssText = 'border-collapse: collapse; width: 100%; border: 1px solid #000000; margin: 10px 0; font-family: Arial, sans-serif;';

        // Process all cells (td and th)
        const allCells = table.querySelectorAll('td, th');
        log(`[processTableHTML] Found ${allCells.length} cells`);

        allCells.forEach((cell, index) => {
            // Get computed style
            const computedStyle = window.getComputedStyle(cell);

            // Extract important styles
            const bgColor = computedStyle.backgroundColor;
            const color = computedStyle.color;
            const fontWeight = computedStyle.fontWeight;
            const textAlign = computedStyle.textAlign;

            log(`[processTableHTML] Cell ${index}: bgColor=${bgColor}, color=${color}, fontWeight=${fontWeight}`);

            // Build style string preserving colors
            let styleStr = 'border: 1px solid #000000; padding: 8px; vertical-align: top;';

            // Add background color if not transparent
            if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
                styleStr += ` background-color: ${bgColor};`;
            }

            // Add text color if specified
            if (color && color !== 'rgb(0, 0, 0)') {
                styleStr += ` color: ${color};`;
            }

            // Add font weight if bold
            if (fontWeight === 'bold' || parseInt(fontWeight) >= 700) {
                styleStr += ` font-weight: bold;`;
            }

            // Add text alignment
            if (textAlign) {
                styleStr += ` text-align: ${textAlign};`;
            }

            cell.style.cssText = styleStr;
            cell.setAttribute('border', '1');
        });

        // Get the final HTML
        const result = table.outerHTML;

        log('[processTableHTML] Table processed successfully');
        log('[processTableHTML] Result preview:', result.substring(0, 200));

        // Clean up
        document.body.removeChild(tempDiv);

        return result;
    } catch (error) {
        logError('[processTableHTML] Error processing table:', error);
        document.body.removeChild(tempDiv);
        return null;
    }
}

// Get Quill editor configuration
function getQuillConfig() {
    return {
        theme: 'snow',
        modules: {
            toolbar: {
                container: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'align': [] }],
                    ['link', 'image'],
                    ['blockquote', 'code-block'],
                    ['insertTable'],  // Custom table button
                    ['clean']
                ],
                handlers: {
                    'insertTable': function() {
                        insertTableIntoQuill(announcementBodyEditor);
                    }
                }
            },
            clipboard: {
                matchVisual: true  // Keep visual formatting
            }
        },
        placeholder: 'Compose your email announcement here...\n\nYou can format text, add tables, lists, and more!\n\nTip: You can paste HTML tables directly from Excel, Word, or web pages!'
    };
}

function initQuillEditor() {
    const editorContainer = document.getElementById('announcement-body-editor');
    if (!editorContainer) return;

    // ✅ NOW USING CONTENTEDITABLE DIV - Same as "Paste HTML Table" modal
    // No Quill initialization needed - it's already a contenteditable div in HTML

    // Sync contenteditable content to hidden input on any change
    editorContainer.addEventListener('input', () => {
        document.getElementById('announcement-body').value = editorContainer.innerHTML;
    });

    // Process tables on paste to ensure formatting is preserved
    editorContainer.addEventListener('paste', (e) => {
        const clipboardData = e.clipboardData || window.clipboardData;
        const htmlData = clipboardData.getData('text/html');

        // Check if pasted content contains a table
        if (htmlData && htmlData.includes('<table')) {
            e.preventDefault();

            log('[Paste Handler] Table detected, processing...');

            // Process the table to preserve formatting
            const processedTable = processTableHTML(htmlData);

            if (processedTable) {
                log('[Paste Handler] Table processed, inserting...');

                // Insert at cursor position using document.execCommand
                document.execCommand('insertHTML', false, processedTable + '<p><br></p>');

                // Update hidden input
                document.getElementById('announcement-body').value = editorContainer.innerHTML;

                log('[Paste Handler] Table inserted successfully');
            }
        } else {
            // For non-table content, let default paste behavior handle it
            // The input event will sync to hidden field
        }
    });

    log('[Announcement Editor] Initialized with contenteditable (same as Paste HTML Table modal)');
}

function initTemplateQuillEditor() {
    const editorContainer = document.getElementById('template-body-editor');
    if (!editorContainer) return;

    templateBodyEditor = new Quill('#template-body-editor', {
        theme: 'snow',
        modules: {
            toolbar: {
                container: [
                    [{ 'header': [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                    [{ 'color': [] }, { 'background': [] }],
                    [{ 'align': [] }],
                    ['link', 'image'],
                    ['blockquote', 'code-block'],
                    ['insertTemplateTable'],  // Custom table button
                    ['clean']
                ],
                handlers: {
                    'insertTemplateTable': function() {
                        insertTableIntoQuill(templateBodyEditor);
                    }
                }
            }
        },
        placeholder: 'Compose your email template here...\n\nYou can format text, add tables, lists, and more!'
    });

    // ⚠️ CUSTOM PASTE HANDLER - Intercept paste events to preserve table HTML
    templateBodyEditor.root.addEventListener('paste', (e) => {
        const clipboardData = e.clipboardData || window.clipboardData;
        const htmlData = clipboardData.getData('text/html');

        // Check if pasted content contains a table
        if (htmlData && htmlData.includes('<table')) {
            e.preventDefault();
            e.stopPropagation();

            log('[Template Paste Handler] Table detected, processing...');

            // Process the table to preserve formatting
            const processedTable = processTableHTML(htmlData);

            if (processedTable) {
                log('[Template Paste Handler] Table processed, inserting...');

                // Get cursor position
                const range = templateBodyEditor.getSelection(true);
                const index = range ? range.index : templateBodyEditor.getLength();

                // Insert the processed HTML directly into the editor
                templateBodyEditor.clipboard.dangerouslyPasteHTML(index, processedTable + '<p><br></p>');

                // Update hidden input
                document.getElementById('template-body').value = templateBodyEditor.root.innerHTML;

                log('[Template Paste Handler] Table inserted successfully');
            }
        }
    }, true); // Use capture phase to intercept before Quill

    log('[Template Editor] Initialized with custom table paste handler');

    // Sync Quill content to hidden input whenever it changes
    templateBodyEditor.on('text-change', () => {
        document.getElementById('template-body').value = templateBodyEditor.root.innerHTML;
    });
}

// Insert table directly into Quill as HTML
function insertTableIntoQuill(editor) {
    if (!editor) return;

    const tableHTML = `<table style="border-collapse: collapse; width: 100%; border: 1px solid #d1d5db;">
<thead>
<tr>
<th style="border: 1px solid #d1d5db; padding: 8px 12px; background-color: #3b82f6; color: white; font-weight: 600;">Header 1</th>
<th style="border: 1px solid #d1d5db; padding: 8px 12px; background-color: #3b82f6; color: white; font-weight: 600;">Header 2</th>
<th style="border: 1px solid #d1d5db; padding: 8px 12px; background-color: #3b82f6; color: white; font-weight: 600;">Header 3</th>
</tr>
</thead>
<tbody>
<tr>
<td style="border: 1px solid #d1d5db; padding: 8px 12px;">Data 1</td>
<td style="border: 1px solid #d1d5db; padding: 8px 12px;">Data 2</td>
<td style="border: 1px solid #d1d5db; padding: 8px 12px;">Data 3</td>
</tr>
<tr style="background-color: #f3f4f6;">
<td style="border: 1px solid #d1d5db; padding: 8px 12px;">Data 4</td>
<td style="border: 1px solid #d1d5db; padding: 8px 12px;">Data 5</td>
<td style="border: 1px solid #d1d5db; padding: 8px 12px;">Data 6</td>
</tr>
</tbody>
</table><p><br></p>`;

    const range = editor.getSelection(true);
    editor.clipboard.dangerouslyPasteHTML(range.index, tableHTML);
    editor.setSelection(range.index + 1);
}

function setAnnouncementBody(content) {
    const editorContainer = document.getElementById('announcement-body-editor');
    if (editorContainer) {
        // Set content directly - contenteditable div
        editorContainer.innerHTML = content;
        // Update hidden input
        document.getElementById('announcement-body').value = content;
    } else {
        // Fallback if editor not ready
        document.getElementById('announcement-body').value = content;
    }
}

async function loadClients() {
    // Resolve team_id — may not be set if this page loaded before main.js ran
    let teamId = appState.currentUserTeamId;
    if (!teamId) {
        const { data: { user } } = await _supabase.auth.getUser();
        if (user) {
            const { data: settings } = await _supabase
                .from('user_settings')
                .select('team_id')
                .eq('user_id', user.id)
                .single();
            teamId = settings?.team_id || null;
            appState.currentUserTeamId = teamId;
        }
    }

    if (!teamId) throw new Error('No team ID available');

    const { data, error } = await _supabase
        .from('clients')
        .select('*')
        .eq('team_id', teamId)
        .order('name', { ascending: true });

    if (error) throw error;

    allClients = data || [];
    applyFilters();
}

function setupEventListeners() {
    // Search input (clients page only)
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearch = e.target.value.toLowerCase();
            applyFilters();
            renderClients();
        });
    }

    // Filter buttons (clients page only)
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            applyFilters();
            renderClients();
        });
    });

    // Status modal select (clients page only)
    const statusSelect = document.getElementById('status-select');
    if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
            const reasonGroup = document.getElementById('reason-group');
            if (e.target.value === 'false') {
                reasonGroup.style.display = 'block';
            } else {
                reasonGroup.style.display = 'none';
            }
        });
    }

    // Announcement reply thread select
    const replyThreadSelect = document.getElementById('announcement-reply-thread');
    if (replyThreadSelect) {
        replyThreadSelect.addEventListener('change', (e) => {
            const messageId = e.target.value;
            if (messageId) {
                handleReplyThreadSelection(messageId);
            }
        });
    }

    // Modal background click to close (clients page only)
    const statusModal = document.getElementById('status-modal');
    if (statusModal) statusModal.addEventListener('click', (e) => {
        if (e.target.id === 'status-modal') closeStatusModal();
    });
    const emailsModal = document.getElementById('emails-modal');
    if (emailsModal) emailsModal.addEventListener('click', (e) => {
        if (e.target.id === 'emails-modal') closeEmailsModal();
    });
    const docModal = document.getElementById('doc-modal');
    if (docModal) docModal.addEventListener('click', (e) => {
        if (e.target.id === 'doc-modal') closeDocModal();
    });
}

function setupRealtimeSubscription() {
    _supabase
        .channel('public:clients')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'clients', filter: `team_id=eq.${appState.currentUserTeamId}` }, (payload) => {
            handleRealtimeUpdate(payload);
        })
        .subscribe();
}

function handleRealtimeUpdate(payload) {
    const { eventType, new: newRecord, old: oldRecord } = payload;

    switch (eventType) {
        case 'INSERT':
            allClients.push(newRecord);
            break;
        case 'UPDATE':
            const updateIndex = allClients.findIndex(c => c.id === newRecord.id);
            if (updateIndex !== -1) {
                allClients[updateIndex] = newRecord;
            }
            break;
        case 'DELETE':
            allClients = allClients.filter(c => c.id !== oldRecord.id);
            break;
    }

    applyFilters();
    renderClients();
}

function applyFilters() {
    filteredClients = allClients.filter(client => {
        // Client type filter
        const clientType = client.client_type || 'saas';
        if (clientType !== currentClientType) return false;

        // Status filter
        let statusMatch = true;
        if (currentFilter === 'active') {
            statusMatch = client.is_active === true;
        } else if (currentFilter === 'inactive') {
            statusMatch = client.is_active === false;
        }

        // Search filter
        let searchMatch = true;
        if (currentSearch) {
            if (clientType === 'prem') {
                // Search name, bpal_url, and all server IPs
                const serverIpMatch = Array.isArray(client.servers) &&
                    client.servers.some(s =>
                        (s.public_ip || '').toLowerCase().includes(currentSearch) ||
                        (s.private_ip || '').toLowerCase().includes(currentSearch) ||
                        (s.role || '').toLowerCase().includes(currentSearch)
                    );
                searchMatch =
                    client.name.toLowerCase().includes(currentSearch) ||
                    (client.bpal_url && client.bpal_url.toLowerCase().includes(currentSearch)) ||
                    (client.domain && client.domain.toLowerCase().includes(currentSearch)) ||
                    serverIpMatch;
            } else {
                searchMatch =
                    client.name.toLowerCase().includes(currentSearch) ||
                    (client.private_ip || '').toLowerCase().includes(currentSearch) ||
                    (client.public_ip || '').toLowerCase().includes(currentSearch) ||
                    (client.domain && client.domain.toLowerCase().includes(currentSearch));
            }
        }

        return statusMatch && searchMatch;
    });

    // Sort: Active clients first, then by name
    filteredClients.sort((a, b) => {
        // First sort by status (active first)
        if (a.is_active !== b.is_active) {
            return b.is_active - a.is_active; // true (1) comes before false (0)
        }
        // Then sort by name alphabetically
        return a.name.localeCompare(b.name);
    });
}

function renderClients() {
    const grid = document.getElementById('clients-grid');
    if (!grid) return; // not on the clients page (e.g. announcement page)

    if (filteredClients.length === 0) {
        grid.innerHTML = '<div class="no-results">No clients found</div>';
        return;
    }

    grid.innerHTML = filteredClients.map(client => createClientCard(client)).join('');

    // Update stats
    updateStats();
}

function updateStats() {
    const typeClients = allClients.filter(c => (c.client_type || 'saas') === currentClientType);
    const totalClients = typeClients.length;
    const activeClients = typeClients.filter(c => c.is_active).length;
    const inactiveClients = typeClients.filter(c => !c.is_active).length;

    document.getElementById('total-clients').textContent = totalClients;
    document.getElementById('active-clients').textContent = activeClients;
    document.getElementById('inactive-clients').textContent = inactiveClients;
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';

    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // Format: Jan 15, 2024
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    const formattedDate = date.toLocaleDateString('en-US', options);

    // Add relative time for recent dates
    if (diffDays === 0) {
        return `${formattedDate} (Today)`;
    } else if (diffDays === 1) {
        return `${formattedDate} (Yesterday)`;
    } else if (diffDays < 7) {
        return `${formattedDate} (${diffDays} days ago)`;
    } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return `${formattedDate} (${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago)`;
    }

    return formattedDate;
}

function createClientCard(client) {
    if ((client.client_type || 'saas') === 'prem') {
        return createPremClientCard(client);
    }
    return createSaasClientCard(client);
}

function createPremClientCard(client) {
    const statusClass = client.is_active ? 'active' : 'inactive';
    const statusText = client.is_active ? 'Active' : 'Inactive';
    const cardClass = client.is_active ? '' : 'inactive';

    const createdDate = client.created_at ? formatDate(client.created_at) : 'N/A';

    const inactiveReasonTooltip = !client.is_active && client.inactive_reason
        ? `<div class="status-tooltip">Reason: ${client.inactive_reason}</div>`
        : '';

    const bpalHtml = client.bpal_url
        ? `<div class="info-row">
               <span class="info-label">B-PAL URL:</span>
               <span class="info-value">
                   <a href="${client.bpal_url.startsWith('http') ? '' : 'https://'}${client.bpal_url}" target="_blank" class="bpal-url-link">${client.bpal_url}</a>
               </span>
           </div>`
        : '';

    const servers = Array.isArray(client.servers) ? client.servers : [];
    const serversHtml = servers.length > 0
        ? `<div class="info-row" style="flex-direction: column; align-items: flex-start;">
               <span class="info-label" style="margin-bottom: 0.4rem;">Servers:</span>
               <table class="servers-table">
                   <thead><tr>
                       <th>Role</th>
                       <th>Public IP</th>
                       <th>Private IP</th>
                   </tr></thead>
                   <tbody>
                       ${servers.map(s => `
                           <tr>
                               <td><span class="server-role-badge">${s.role || ''}</span></td>
                               <td><span class="copyable" onclick="clients.copyToClipboard('${s.public_ip || ''}')">${s.public_ip || '—'}</span></td>
                               <td>${s.private_ip ? `<span class="copyable" onclick="clients.copyToClipboard('${s.private_ip}')">${s.private_ip}</span>` : '—'}</td>
                           </tr>`).join('')}
                   </tbody>
               </table>
           </div>`
        : '<div class="info-row"><span class="info-label" style="color:#64748b;">No servers on record</span></div>';

    const emailsHtml = client.emails && client.emails.length > 0
        ? `<div class="emails-section">
               <div class="info-label">Emails:</div>
               <div class="emails-container">
                   ${client.emails.map(email => `<span class="email-badge" onclick="clients.copyToClipboard('${email}')">${email}</span>`).join('')}
               </div>
           </div>`
        : '';

    const docBtnClass = client.http_documentation_url ? 'action-btn doc-exists' : 'action-btn';
    const docBtnText = client.http_documentation_url ? '📄 View/Update Docs' : 'Upload Docs';
    const docBtnTitle = client.http_documentation_url ? 'HTTP Documentation Available' : 'Upload HTTP Documentation';

    return `
        <div class="client-card ${cardClass}">
            <div style="position: absolute; top: 0.5rem; left: 50%; transform: translateX(-50%); z-index: 10;">
                <span class="status-badge ${statusClass}" onclick="clients.openStatusModal(${client.id})" style="cursor: pointer;">
                    ${statusText}
                    ${inactiveReasonTooltip}
                </span>
            </div>
            <div style="position: absolute; top: 1rem; right: 1rem; display: flex; gap: 0.5rem; z-index: 10;">
                <button style="position: relative; top: auto; right: auto; padding: 0.5rem; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 0.5rem; color: white; cursor: pointer; transition: all 0.3s ease; font-size: 0.875rem;"
                    onclick="clients.openEditClientModal(${client.id})"
                    title="Edit Client"
                    onmouseover="this.style.background='rgba(59, 130, 246, 0.3)'; this.style.borderColor='#60a5fa'; this.style.transform='translateY(-2px)';"
                    onmouseout="this.style.background='rgba(59, 130, 246, 0.2)'; this.style.borderColor='rgba(59, 130, 246, 0.3)'; this.style.transform='translateY(0)';">✏️</button>
                <button style="position: relative; top: auto; right: auto; padding: 0.5rem; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 0.5rem; color: white; cursor: pointer; transition: all 0.3s ease; font-size: 0.875rem;"
                    onclick="clientGuidesHistory.openClientHistory(${client.id})"
                    title="View History"
                    onmouseover="this.style.background='rgba(59, 130, 246, 0.3)'; this.style.borderColor='#60a5fa'; this.style.transform='translateY(-2px)';"
                    onmouseout="this.style.background='rgba(59, 130, 246, 0.2)'; this.style.borderColor='rgba(59, 130, 246, 0.3)'; this.style.transform='translateY(0)';">📜</button>
            </div>
            <div class="client-header">
                <div>
                    <h3 class="client-name">${client.name}</h3>
                    <div class="client-created-date">Created: ${createdDate}</div>
                </div>
            </div>

            <div class="client-info">
                ${bpalHtml}
                ${serversHtml}
            </div>

            ${emailsHtml}

            <div class="client-actions">
                <button class="action-btn" onclick="clients.openEmailsModal(${client.id})">Manage Emails</button>
                <button class="${docBtnClass}" onclick="clients.openDocModal(${client.id})" title="${docBtnTitle}">${docBtnText}</button>
            </div>
        </div>
    `;
}

function createSaasClientCard(client) {
    const statusClass = client.is_active ? 'active' : 'inactive';
    const statusText = client.is_active ? 'Active' : 'Inactive';
    const cardClass = client.is_active ? '' : 'inactive';

    // Format created date
    const createdDate = client.created_at ? formatDate(client.created_at) : 'N/A';

    const emailsHtml = client.emails && client.emails.length > 0
        ? `<div class="emails-section">
               <div class="info-label">Emails:</div>
               <div class="emails-container">
                   ${client.emails.map(email => `<span class="email-badge" onclick="clients.copyToClipboard('${email}')">${email}</span>`).join('')}
               </div>
           </div>`
        : '';

    const inactiveReasonTooltip = !client.is_active && client.inactive_reason
        ? `<div class="status-tooltip">Reason: ${client.inactive_reason}</div>`
        : '';

    const domainHtml = client.domain
        ? `<div class="info-row">
               <span class="info-label">Domain:</span>
               <span class="info-value">
                   <a href="https://${client.domain}" target="_blank" class="domain-link">${client.domain}</a>
               </span>
           </div>`
        : '';

    const docBtnClass = client.http_documentation_url ? 'action-btn doc-exists' : 'action-btn';
    const docBtnText = client.http_documentation_url ? '📄 View/Update Docs' : 'Upload Docs';
    const docBtnTitle = client.http_documentation_url ? 'HTTP Documentation Available - Click to view or update' : 'Upload HTTP Documentation';

    return `
        <div class="client-card ${cardClass}">
            <div style="position: absolute; top: 0.5rem; left: 50%; transform: translateX(-50%); z-index: 10;">
                <span class="status-badge ${statusClass}" onclick="clients.openStatusModal(${client.id})" style="cursor: pointer;">
                    ${statusText}
                    ${inactiveReasonTooltip}
                </span>
            </div>
            <div style="position: absolute; top: 1rem; right: 1rem; display: flex; gap: 0.5rem; z-index: 10;">
                <button style="position: relative; top: auto; right: auto; padding: 0.5rem; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 0.5rem; color: white; cursor: pointer; transition: all 0.3s ease; font-size: 0.875rem;"
                    onclick="clients.openEditClientModal(${client.id})"
                    title="Edit Client"
                    onmouseover="this.style.background='rgba(59, 130, 246, 0.3)'; this.style.borderColor='#60a5fa'; this.style.transform='translateY(-2px)';"
                    onmouseout="this.style.background='rgba(59, 130, 246, 0.2)'; this.style.borderColor='rgba(59, 130, 246, 0.3)'; this.style.transform='translateY(0)';">✏️</button>
                <button style="position: relative; top: auto; right: auto; padding: 0.5rem; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 0.5rem; color: white; cursor: pointer; transition: all 0.3s ease; font-size: 0.875rem;"
                    onclick="clientGuidesHistory.openClientHistory(${client.id})"
                    title="View History"
                    onmouseover="this.style.background='rgba(59, 130, 246, 0.3)'; this.style.borderColor='#60a5fa'; this.style.transform='translateY(-2px)';"
                    onmouseout="this.style.background='rgba(59, 130, 246, 0.2)'; this.style.borderColor='rgba(59, 130, 246, 0.3)'; this.style.transform='translateY(0)';">📜</button>
            </div>
            <div class="client-header">
                <div>
                    <h3 class="client-name">${client.name}</h3>
                    <div class="client-created-date">Created: ${createdDate}</div>
                </div>
            </div>

            <div class="client-info">
                <div class="info-row">
                    <span class="info-label">Private IP:</span>
                    <span class="info-value">
                        <span class="copyable" onclick="clients.copyToClipboard('${client.private_ip}')">${client.private_ip}</span>
                    </span>
                </div>

                <div class="info-row">
                    <span class="info-label">Public IP:</span>
                    <span class="info-value">
                        <span class="copyable" onclick="clients.copyToClipboard('${client.public_ip}')">${client.public_ip}</span>
                    </span>
                </div>

                ${domainHtml}

                <div class="info-row">
                    <span class="info-label">Ports:</span>
                    <div class="ports-container">
                        <span class="port-badge smpp" onclick="clients.copyToClipboard('${client.smpp_port}')" title="SMPP Port">SMPP: ${client.smpp_port}</span>
                        <span class="port-badge http" onclick="clients.copyToClipboard('${client.http_port}')" title="HTTP Port">HTTP: ${client.http_port}</span>
                        <span class="port-badge dlr" onclick="clients.copyToClipboard('${client.dlr_port}')" title="DLR Port">DLR: ${client.dlr_port}</span>
                    </div>
                </div>
            </div>

            ${emailsHtml}

            <div class="client-actions">
                <button class="action-btn" onclick="clients.openEmailsModal(${client.id})">Manage Emails</button>
                <button class="${docBtnClass}" onclick="clients.openDocModal(${client.id})" title="${docBtnTitle}">${docBtnText}</button>
            </div>
        </div>
    `;
}

// Status Modal Functions
function openStatusModal(clientId) {
    currentClientId = clientId;
    const client = allClients.find(c => c.id === clientId);

    if (!client) return;

    const statusSelect = document.getElementById('status-select');
    const reasonTextarea = document.getElementById('reason-textarea');
    const reasonGroup = document.getElementById('reason-group');

    statusSelect.value = client.is_active.toString();
    reasonTextarea.value = client.inactive_reason || '';

    if (client.is_active) {
        reasonGroup.style.display = 'none';
    } else {
        reasonGroup.style.display = 'block';
    }

    document.getElementById('status-modal').classList.add('active');
}

function closeStatusModal() {
    document.getElementById('status-modal').classList.remove('active');
    currentClientId = null;
}

async function saveStatus() {
    if (!currentClientId) return;

    const isActive = document.getElementById('status-select').value === 'true';
    const reason = document.getElementById('reason-textarea').value.trim();

    if (!isActive && !reason) {
        showToast('Please provide a reason for inactive status', 'error');
        return;
    }

    try {
        const { error } = await _supabase
            .from('clients')
            .update({
                is_active: isActive,
                inactive_reason: isActive ? null : reason,
                updated_at: new Date().toISOString()
            })
            .eq('id', currentClientId);

        if (error) throw error;

        showToast('Client status updated successfully');
        closeStatusModal();
    } catch (error) {
        logError('Error updating status:', error);
        showToast('Failed to update status', 'error');
    }
}

// Emails Modal Functions
function openEmailsModal(clientId) {
    currentClientId = clientId;
    const client = allClients.find(c => c.id === clientId);

    if (!client) return;

    currentEmails = client.emails ? [...client.emails] : [];
    renderEmailsList();

    document.getElementById('emails-modal').classList.add('active');
}

function closeEmailsModal() {
    document.getElementById('emails-modal').classList.remove('active');
    currentClientId = null;
    currentEmails = [];
    document.getElementById('new-email-input').value = '';
}

function renderEmailsList() {
    const emailsList = document.getElementById('emails-list');

    if (currentEmails.length === 0) {
        emailsList.innerHTML = '<div class="info-label" style="text-align: center; padding: 1rem;">No emails added yet</div>';
        return;
    }

    emailsList.innerHTML = currentEmails.map((email, index) => `
        <div class="email-list-item">
            <span style="color: #e2e8f0;">${email}</span>
            <button class="remove-email-btn" onclick="clients.removeEmailFromList(${index})">Remove</button>
        </div>
    `).join('');
}

function addEmailToList() {
    const input = document.getElementById('new-email-input');
    const inputValue = input.value.trim();

    if (!inputValue) {
        showToast('Please enter at least one email address', 'error');
        return;
    }

    // Split by both comma and semicolon, then clean up
    const emailsToAdd = inputValue
        .split(/[,;]+/)  // Split by comma or semicolon
        .map(e => e.trim().toLowerCase())  // Trim and lowercase each email
        .filter(e => e);  // Remove empty strings

    if (emailsToAdd.length === 0) {
        showToast('Please enter valid email addresses', 'error');
        return;
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const validEmails = [];
    const invalidEmails = [];
    const duplicateEmails = [];

    emailsToAdd.forEach(email => {
        if (!emailRegex.test(email)) {
            invalidEmails.push(email);
        } else if (currentEmails.includes(email)) {
            duplicateEmails.push(email);
        } else {
            validEmails.push(email);
        }
    });

    // Add valid emails
    if (validEmails.length > 0) {
        currentEmails.push(...validEmails);
        input.value = '';
        renderEmailsList();

        if (validEmails.length === 1) {
            showToast(`Added 1 email successfully`);
        } else {
            showToast(`Added ${validEmails.length} emails successfully`);
        }
    }

    // Show warnings for invalid or duplicate emails
    if (invalidEmails.length > 0) {
        showToast(`Invalid email(s): ${invalidEmails.join(', ')}`, 'error');
    }
    if (duplicateEmails.length > 0) {
        showToast(`Already exists: ${duplicateEmails.join(', ')}`, 'error');
    }
}

function removeEmailFromList(index) {
    currentEmails.splice(index, 1);
    renderEmailsList();
}

async function saveEmails() {
    if (!currentClientId) return;

    try {
        const { error } = await _supabase
            .from('clients')
            .update({
                emails: currentEmails,
                updated_at: new Date().toISOString()
            })
            .eq('id', currentClientId);

        if (error) throw error;

        showToast('Emails updated successfully');
        closeEmailsModal();
    } catch (error) {
        logError('Error updating emails:', error);
        showToast('Failed to update emails', 'error');
    }
}

// Documentation Modal Functions
function openDocModal(clientId) {
    currentClientId = clientId;
    const client = allClients.find(c => c.id === clientId);

    if (!client) return;

    const currentDocInfo = document.getElementById('current-doc-info');

    if (client.http_documentation_url) {
        const fileName = client.http_documentation_url.split('/').pop();
        currentDocInfo.innerHTML = `
            <div style="padding: 1rem; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.2); border-radius: 0.5rem;">
                <div style="color: #86efac; font-weight: 600; margin-bottom: 0.5rem;">Current Documentation:</div>
                <div style="color: #e2e8f0; margin-bottom: 1rem;">${fileName}</div>
                <div style="display: flex; gap: 0.5rem;">
                    <button class="action-btn" onclick="clients.downloadDocumentation(${clientId})" style="flex: 1;">Download</button>
                    <button class="action-btn" onclick="clients.deleteDocumentation(${clientId})" style="flex: 1; background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.3); color: #fca5a5;">Delete</button>
                </div>
            </div>
        `;
    } else {
        currentDocInfo.innerHTML = '<div class="info-label" style="text-align: center;">No documentation uploaded</div>';
    }

    document.getElementById('doc-modal').classList.add('active');
}

function closeDocModal() {
    document.getElementById('doc-modal').classList.remove('active');
    currentClientId = null;
    document.getElementById('doc-file-input').value = '';
}

async function uploadDocumentation() {
    if (!currentClientId) return;

    const fileInput = document.getElementById('doc-file-input');
    const file = fileInput.files[0];

    if (!file) {
        showToast('Please select a file', 'error');
        return;
    }

    try {
        const client = allClients.find(c => c.id === currentClientId);

        // Delete old file if exists
        if (client.http_documentation_url) {
            const oldPath = client.http_documentation_url.split('/').pop();
            await _supabase.storage
                .from('client-documentation')
                .remove([`${currentClientId}/${oldPath}`]);
        }

        // Upload new file
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}.${fileExt}`;
        const filePath = `${currentClientId}/${fileName}`;

        const { error: uploadError } = await _supabase.storage
            .from('client-documentation')
            .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: { publicUrl } } = _supabase.storage
            .from('client-documentation')
            .getPublicUrl(filePath);

        // Update database
        const { error: updateError } = await _supabase
            .from('clients')
            .update({
                http_documentation_url: publicUrl,
                updated_at: new Date().toISOString()
            })
            .eq('id', currentClientId);

        if (updateError) throw updateError;

        showToast('Documentation uploaded successfully');
        closeDocModal();
    } catch (error) {
        logError('Error uploading documentation:', error);
        showToast('Failed to upload documentation', 'error');
    }
}

async function downloadDocumentation(clientId) {
    const client = allClients.find(c => c.id === clientId);
    if (!client || !client.http_documentation_url) return;

    window.open(client.http_documentation_url, '_blank');
}

async function deleteDocumentation(clientId) {
    if (!confirm('Are you sure you want to delete this documentation?')) return;

    try {
        const client = allClients.find(c => c.id === clientId);
        if (!client || !client.http_documentation_url) return;

        // Delete from storage
        const path = client.http_documentation_url.split('/').pop();
        await _supabase.storage
            .from('client-documentation')
            .remove([`${clientId}/${path}`]);

        // Update database
        const { error } = await _supabase
            .from('clients')
            .update({
                http_documentation_url: null,
                updated_at: new Date().toISOString()
            })
            .eq('id', clientId);

        if (error) throw error;

        showToast('Documentation deleted successfully');
        closeDocModal();
    } catch (error) {
        logError('Error deleting documentation:', error);
        showToast('Failed to delete documentation', 'error');
    }
}

// Utility Functions
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard: ' + text);
    }).catch(err => {
        logError('Failed to copy:', err);
        showToast('Failed to copy to clipboard', 'error');
    });
}

function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = message;

    if (type === 'error') {
        toast.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ── Client Type Toggle ──────────────────────────────────────────────────────
function setClientType(type) {
    currentClientType = type;
    document.getElementById('type-saas-btn').classList.toggle('active', type === 'saas');
    document.getElementById('type-prem-btn').classList.toggle('active', type === 'prem');
    // Reset status filter
    currentFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    applyFilters();
    renderClients();
}

// ── Add modal type switcher ──────────────────────────────────────────────────
function toggleAddModalType(type) {
    document.getElementById('add-modal-type-saas').classList.toggle('active', type === 'saas');
    document.getElementById('add-modal-type-prem').classList.toggle('active', type === 'prem');
    document.getElementById('add-saas-fields').style.display = type === 'saas' ? '' : 'none';
    document.getElementById('add-prem-fields').style.display = type === 'prem' ? '' : 'none';
}

// ── Server row helpers ───────────────────────────────────────────────────────
function addServerRow(containerId, role = '', publicIp = '', privateIp = '') {
    const container = document.getElementById(containerId);
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'server-row';
    row.innerHTML = `
        <input type="text" placeholder="Role" value="${role}">
        <input type="text" placeholder="Public IP" value="${publicIp}">
        <input type="text" placeholder="Private IP (opt.)" value="${privateIp}">
        <button class="server-row-remove" onclick="clients.removeServerRow(this)">✕</button>
    `;
    container.appendChild(row);
}

function removeServerRow(btn) {
    btn.closest('.server-row').remove();
}

function collectServers(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.server-row')).map(row => {
        const inputs = row.querySelectorAll('input');
        const role = inputs[0].value.trim();
        const publicIp = inputs[1].value.trim();
        const privateIp = inputs[2].value.trim();
        const obj = { role, public_ip: publicIp };
        if (privateIp) obj.private_ip = privateIp;
        return obj;
    }).filter(s => s.role || s.public_ip);
}

function renderServersInModal(servers, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    (servers || []).forEach(s => addServerRow(containerId, s.role || '', s.public_ip || '', s.private_ip || ''));
}

// Edit Client Modal Functions
function openEditClientModal(clientId) {
    const client = allClients.find(c => c.id === clientId);
    if (!client) return;

    const isPrem = (client.client_type || 'saas') === 'prem';

    document.getElementById('edit-client-id').value = client.id;
    document.getElementById('edit-client-type').value = client.client_type || 'saas';
    document.getElementById('edit-client-name').value = client.name;
    document.getElementById('edit-client-domain').value = client.domain || '';

    // Show/hide type-specific sections
    document.getElementById('edit-saas-fields').style.display = isPrem ? 'none' : '';
    document.getElementById('edit-prem-fields').style.display = isPrem ? '' : 'none';

    if (isPrem) {
        document.getElementById('edit-client-bpal-url').value = client.bpal_url || '';
        renderServersInModal(client.servers || [], 'edit-servers-container');
    } else {
        document.getElementById('edit-client-private-ip').value = client.private_ip || '';
        document.getElementById('edit-client-public-ip').value = client.public_ip || '';
        document.getElementById('edit-client-smpp-port').value = client.smpp_port || '';
        document.getElementById('edit-client-http-port').value = client.http_port || '';
        document.getElementById('edit-client-dlr-port').value = client.dlr_port || '';
    }

    document.getElementById('edit-client-modal').classList.add('active');
}

function closeEditClientModal() {
    document.getElementById('edit-client-modal').classList.remove('active');
}

async function saveEditClient() {
    const clientId = parseInt(document.getElementById('edit-client-id').value);
    const clientType = document.getElementById('edit-client-type').value || 'saas';
    const name = document.getElementById('edit-client-name').value.trim();
    const domain = document.getElementById('edit-client-domain').value.trim();

    if (!name) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    let updateData = { name, domain: domain || null, updated_at: new Date().toISOString() };

    if (clientType === 'prem') {
        const bpalUrl = document.getElementById('edit-client-bpal-url').value.trim();
        if (!bpalUrl) {
            showToast('Please enter the B-PAL URL', 'error');
            return;
        }
        updateData.bpal_url = bpalUrl;
        updateData.servers = collectServers('edit-servers-container');
    } else {
        const privateIp = document.getElementById('edit-client-private-ip').value.trim();
        const publicIp = document.getElementById('edit-client-public-ip').value.trim();
        const smppPort = parseInt(document.getElementById('edit-client-smpp-port').value);
        const httpPort = parseInt(document.getElementById('edit-client-http-port').value);
        const dlrPort = parseInt(document.getElementById('edit-client-dlr-port').value);
        if (!privateIp || !publicIp || !smppPort || !httpPort || !dlrPort) {
            showToast('Please fill in all required fields', 'error');
            return;
        }
        updateData.private_ip = privateIp;
        updateData.public_ip = publicIp;
        updateData.smpp_port = smppPort;
        updateData.http_port = httpPort;
        updateData.dlr_port = dlrPort;
    }

    try {
        const { error } = await _supabase.from('clients').update(updateData).eq('id', clientId);
        if (error) throw error;
        showToast('Client updated successfully');
        closeEditClientModal();
    } catch (error) {
        logError('Error updating client:', error);
        showToast('Failed to update client', 'error');
    }
}

// Add Client Modal Functions
function openAddClientModal() {
    // Pre-select modal type to match current view
    toggleAddModalType(currentClientType);
    document.getElementById('add-client-modal').classList.add('active');
}

function closeAddClientModal() {
    document.getElementById('add-client-modal').classList.remove('active');
    // Clear form
    document.getElementById('add-client-name').value = '';
    document.getElementById('add-client-domain').value = '';
    document.getElementById('add-client-private-ip').value = '';
    document.getElementById('add-client-public-ip').value = '';
    document.getElementById('add-client-smpp-port').value = '';
    document.getElementById('add-client-http-port').value = '';
    document.getElementById('add-client-dlr-port').value = '';
    document.getElementById('add-client-status').value = 'true';
    document.getElementById('add-client-emails').value = '';
    document.getElementById('add-client-bpal-url').value = '';
    const addServersContainer = document.getElementById('add-servers-container');
    if (addServersContainer) addServersContainer.innerHTML = '';
}

async function saveNewClient() {
    const isModalPrem = document.getElementById('add-modal-type-prem').classList.contains('active');
    const clientType = isModalPrem ? 'prem' : 'saas';
    const name = document.getElementById('add-client-name').value.trim();
    const domain = document.getElementById('add-client-domain').value.trim();
    const isActive = document.getElementById('add-client-status').value === 'true';
    const emailsInput = document.getElementById('add-client-emails').value.trim();
    const emails = emailsInput ? emailsInput.split(',').map(e => e.trim()).filter(e => e) : [];

    if (!name) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    let insertData = {
        name,
        domain: domain || null,
        is_active: isActive,
        emails,
        client_type: clientType,
        team_id: appState.currentUserTeamId
    };

    if (clientType === 'prem') {
        const bpalUrl = document.getElementById('add-client-bpal-url').value.trim();
        if (!bpalUrl) {
            showToast('Please enter the B-PAL URL', 'error');
            return;
        }
        insertData.bpal_url = bpalUrl;
        insertData.servers = collectServers('add-servers-container');
    } else {
        const privateIp = document.getElementById('add-client-private-ip').value.trim();
        const publicIp = document.getElementById('add-client-public-ip').value.trim();
        const smppPort = parseInt(document.getElementById('add-client-smpp-port').value);
        const httpPort = parseInt(document.getElementById('add-client-http-port').value);
        const dlrPort = parseInt(document.getElementById('add-client-dlr-port').value);
        if (!privateIp || !publicIp || !smppPort || !httpPort || !dlrPort) {
            showToast('Please fill in all required fields', 'error');
            return;
        }
        insertData.private_ip = privateIp;
        insertData.public_ip = publicIp;
        insertData.smpp_port = smppPort;
        insertData.http_port = httpPort;
        insertData.dlr_port = dlrPort;
    }

    try {
        const { error } = await _supabase.from('clients').insert(insertData);
        if (error) throw error;
        showToast('Client added successfully');
        closeAddClientModal();
    } catch (error) {
        logError('Error adding client:', error);
        showToast('Failed to add client', 'error');
    }
}

// Announcement Modal Functions
let emailTemplates = [];
let previousAnnouncements = [];
let bccEmails = [];
let templatesLoaded = false;
let announcementsLoaded = false;

async function openAnnouncementModal() {
    // Initialize Quill editor lazily on first open
    if (!announcementBodyEditor) {
        initQuillEditor();
    }

    // Only load templates and announcements once
    if (!templatesLoaded) {
        await loadSavedTemplates();
        templatesLoaded = true;
    }
    if (!announcementsLoaded) {
        await loadPreviousAnnouncements();
        announcementsLoaded = true;
    }

    // Clear all fields initially
    document.getElementById('announcement-subject').value = '';
    if (announcementBodyEditor) {
        announcementBodyEditor.setContents([]);  // Clear Quill editor
    }
    document.getElementById('announcement-body').value = '';
    document.getElementById('announcement-to').value = '';
    document.getElementById('announcement-cc').value = '';
    document.getElementById('template-select').value = '';

    // Start with empty BCC - will be populated when template is selected
    bccEmails = [];
    renderBccEmails();

    document.getElementById('announcement-modal').classList.add('active');
}

async function loadPreviousAnnouncements() {
    try {
        log('[loadPreviousAnnouncements] Starting to fetch announcements...');
        const { data, error } = await _supabase
            .from('sent_announcements')
            .select('id, subject, message_id, sent_at, sent_to, sent_cc, sent_bcc')
            .eq('team_id', appState.currentUserTeamId)
            .order('sent_at', { ascending: false })
            .limit(20);

        if (error) {
            logError('[loadPreviousAnnouncements] Error:', error);
            showToast('Failed to load previous announcements', 'error');
            return;
        }

        log('[loadPreviousAnnouncements] Fetched data:', data);
        log('[loadPreviousAnnouncements] Number of announcements:', data?.length || 0);

        previousAnnouncements = data || [];
        renderPreviousAnnouncements();
    } catch (error) {
        logError('[loadPreviousAnnouncements] Catch error:', error);
        showToast('Failed to load previous announcements', 'error');
    }
}

function renderPreviousAnnouncements() {
    const select = document.getElementById('announcement-reply-thread');
    if (!select) {
        logError('[renderPreviousAnnouncements] Select element not found');
        return;
    }

    log('[renderPreviousAnnouncements] Rendering', previousAnnouncements.length, 'announcements');

    // Remove existing options except first one
    while (select.options.length > 1) {
        select.remove(1);
    }

    // Add previous announcements from cache
    previousAnnouncements.forEach(announcement => {
        const option = document.createElement('option');
        option.value = announcement.message_id;
        const date = new Date(announcement.sent_at).toLocaleDateString();
        option.textContent = `${announcement.subject} (${date})`;
        select.appendChild(option);
        log('[renderPreviousAnnouncements] Added option:', announcement.subject);
    });

    log('[renderPreviousAnnouncements] Total options in select:', select.options.length);
}

function handleReplyThreadSelection(messageId) {
    // Find the selected announcement from cache
    const announcement = previousAnnouncements.find(a => a.message_id === messageId);
    if (!announcement) return;

    log('[handleReplyThreadSelection] Selected announcement:', announcement);

    // Auto-populate subject with "Re: " prefix if not already there
    const subjectInput = document.getElementById('announcement-subject');
    const originalSubject = announcement.subject;
    if (!originalSubject.startsWith('Re:')) {
        subjectInput.value = `Re: ${originalSubject}`;
    } else {
        subjectInput.value = originalSubject;
    }

    // Auto-populate TO recipients
    const toInput = document.getElementById('announcement-to');
    if (Array.isArray(announcement.sent_to)) {
        toInput.value = announcement.sent_to.join(', ');
    } else {
        toInput.value = announcement.sent_to || '';
    }

    // Auto-populate CC recipients
    const ccInput = document.getElementById('announcement-cc');
    if (Array.isArray(announcement.sent_cc)) {
        ccInput.value = announcement.sent_cc.join(', ');
    } else {
        ccInput.value = announcement.sent_cc || '';
    }

    // Auto-populate BCC recipients
    if (announcement.sent_bcc) {
        if (Array.isArray(announcement.sent_bcc)) {
            bccEmails = announcement.sent_bcc.filter(email => email);
        } else {
            bccEmails = announcement.sent_bcc.split(',').map(email => email.trim()).filter(email => email);
        }
        renderBccEmails();
    }

    // Clear the body - user needs to write new reply message
    if (announcementBodyEditor) {
        announcementBodyEditor.setContents([]);
    }

    // Clear template selection since we're replying
    document.getElementById('template-select').value = '';

    showToast('Reply fields auto-populated. Please compose your reply message.', 'success');
}

function renderBccEmails() {
    const container = document.getElementById('bcc-email-list');

    if (bccEmails.length === 0) {
        container.innerHTML = '<div style="color: #64748b; padding: 1rem; text-align: center;">No active client emails found</div>';
        return;
    }

    container.innerHTML = bccEmails.map((email, index) => `
        <div class="bcc-email-chip">
            <span>${email}</span>
            <button onclick="clients.removeBccEmail(${index})" title="Remove">×</button>
        </div>
    `).join('');
}

function removeBccEmail(index) {
    bccEmails.splice(index, 1);
    renderBccEmails();
}

function closeAnnouncementModal() {
    document.getElementById('announcement-modal').classList.remove('active');
    document.getElementById('template-select').value = '';
    document.getElementById('announcement-subject').value = '';
    if (announcementBodyEditor) {
        announcementBodyEditor.setContents([]);
    }
    document.getElementById('announcement-body').value = '';
}

function loadTemplate() {
    const templateType = document.getElementById('template-select').value;
    const saveTemplateBtn = document.getElementById('save-template-btn');

    // Clear BCC first
    bccEmails = [];

    if (templateType) {
        // Load template from database
        const template = emailTemplates.find(t => t.id === parseInt(templateType));
        if (template) {
            document.getElementById('announcement-subject').value = template.subject;
            setAnnouncementBody(template.body);
            document.getElementById('announcement-to').value = template.to_recipients || '';
            document.getElementById('announcement-cc').value = template.cc || '';

            // Hide "Save as Template" button for database templates
            if (saveTemplateBtn) saveTemplateBtn.style.display = 'none';

            // Check if template has template_type field
            if (template.template_type === 'external') {
                // External template - populate BCC filtered by client_scope
                const scope = template.client_scope || 'all';
                allClients.forEach(client => {
                    if (client.is_active && client.emails && client.emails.length > 0) {
                        if (scope === 'all' || client.client_type === scope) {
                            bccEmails.push(...client.emails);
                        }
                    }
                });
                bccEmails = [...new Set(bccEmails)];
            }
            // If template_type is 'internal' or undefined, BCC stays empty
        }
    } else {
        // No template selected - hide button
        if (saveTemplateBtn) saveTemplateBtn.style.display = 'none';
    }

    renderBccEmails();
}

async function sendAnnouncement() {
    const subject = document.getElementById('announcement-subject').value.trim();
    const body = document.getElementById('announcement-body').value.trim();
    const to = document.getElementById('announcement-to').value.trim();
    const cc = document.getElementById('announcement-cc').value.trim();
    const inReplyTo = document.getElementById('announcement-reply-thread').value;

    if (!subject || !body) {
        showToast('Please fill in subject and body', 'error');
        return;
    }

    // BCC is optional - no validation needed
    // External templates will have client emails
    // Internal templates will have TO/CC only

    // Check if SMTP is configured
    const smtpConfig = await loadSmtpConfig();
    if (!smtpConfig || !smtpConfig.host) {
        showToast('Please configure SMTP settings first', 'error');
        openSmtpConfig();
        return;
    }

    // Process attachments
    const fileInput = document.getElementById('announcement-attachments');
    const attachments = [];

    if (fileInput.files.length > 0) {
        showToast('Processing attachments...');

        for (const file of fileInput.files) {
            try {
                const base64 = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result.split(',')[1]); // Remove data:...;base64, prefix
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                attachments.push({
                    filename: file.name,
                    content: base64,
                    contentType: file.type || 'application/octet-stream'
                });
            } catch (error) {
                logError('Error reading file:', file.name, error);
                showToast(`Failed to read file: ${file.name}`, 'error');
                return;
            }
        }
    }

    // Build confirmation message based on recipients
    const parseEmails = (emailString) => {
        if (!emailString) return [];
        return emailString
            .split(/[,;]+/)
            .map(e => e.trim())
            .filter(e => e);
    };

    const toEmails = parseEmails(to);
    const ccEmails = parseEmails(cc);

    let confirmMessage = 'Send announcement to:\n';
    if (toEmails.length > 0) {
        confirmMessage += `\n• TO: ${toEmails.length} recipient(s)`;
    }
    if (ccEmails.length > 0) {
        confirmMessage += `\n• CC: ${ccEmails.length} recipient(s)`;
    }
    if (bccEmails.length > 0) {
        confirmMessage += `\n• BCC: ${bccEmails.length} client(s)`;
    }

    if (toEmails.length === 0 && ccEmails.length === 0 && bccEmails.length === 0) {
        showToast('Please add at least one recipient (TO, CC, or BCC)', 'error');
        return;
    }

    if (!confirm(confirmMessage)) {
        return;
    }

    try {
        // Call Vercel serverless function to send email via SMTP
        showToast('Sending announcement... This may take a moment');

        // Get the current domain (works in both local and production)
        const apiUrl = window.location.origin + '/api/send-announcement';

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                subject,
                body,
                to: toEmails,
                cc: ccEmails,
                bcc: bccEmails,
                inReplyTo: inReplyTo || undefined,
                attachments: attachments.length > 0 ? attachments : undefined,
                smtp: smtpConfig
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || result.message || 'Failed to send email');
        }

        // Save sent announcement to database for future threading
        if (result.messageId) {
            try {
                const { data: savedAnnouncement } = await _supabase.from('sent_announcements').insert({
                    subject,
                    message_id: result.messageId,
                    sent_to: toEmails,
                    sent_cc: ccEmails,
                    sent_bcc: bccEmails,
                    sent_by: (await _supabase.auth.getUser()).data.user?.email || 'Unknown',
                    team_id: appState.currentUserTeamId
                }).select().single();

                // Add to cache immediately
                if (savedAnnouncement) {
                    previousAnnouncements.unshift(savedAnnouncement);
                    // Keep only last 20
                    if (previousAnnouncements.length > 20) {
                        previousAnnouncements = previousAnnouncements.slice(0, 20);
                    }
                }
            } catch (saveError) {
                logError('Error saving sent announcement:', saveError);
                // Don't fail the whole operation if saving fails
            }
        }

        // Show detailed success message
        const totalSent = result.totalRecipients?.total || 0;
        showToast(`Announcement sent successfully to ${totalSent} recipient(s)!`);
        closeAnnouncementModal();
    } catch (error) {
        logError('Error sending announcement:', error);
        showToast('Failed to send announcement: ' + error.message, 'error');
    }
}

// SMTP Config Functions
async function openSmtpConfig() {
    const config = await loadSmtpConfig();

    if (config) {
        document.getElementById('smtp-host').value = config.host || '';
        document.getElementById('smtp-port').value = config.port || 587;
        document.getElementById('smtp-secure').value = config.secure ? 'true' : 'false';
        document.getElementById('smtp-user').value = config.smtp_user || '';
        document.getElementById('smtp-password').value = config.smtp_password || '';
        document.getElementById('smtp-from-email').value = config.from_email || '';
        document.getElementById('smtp-from-name').value = config.from_name || 'B-Pal Support Team';
    }

    document.getElementById('smtp-config-modal').classList.add('active');
}

function closeSmtpConfig() {
    document.getElementById('smtp-config-modal').classList.remove('active');
}

async function saveSmtpConfig() {
    const config = {
        host: document.getElementById('smtp-host').value.trim(),
        port: parseInt(document.getElementById('smtp-port').value),
        secure: document.getElementById('smtp-secure').value === 'true',
        smtp_user: document.getElementById('smtp-user').value.trim(),
        smtp_password: document.getElementById('smtp-password').value.trim(),
        from_email: document.getElementById('smtp-from-email').value.trim(),
        from_name: document.getElementById('smtp-from-name').value.trim()
    };

    if (!config.host || !config.port || !config.smtp_user || !config.smtp_password || !config.from_email) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        // Check if config exists for this team
        const { data: existing } = await _supabase
            .from('smtp_config')
            .select('id')
            .eq('team_id', appState.currentUserTeamId)
            .limit(1)
            .single();

        if (existing) {
            // Update
            const { error } = await _supabase
                .from('smtp_config')
                .update(config)
                .eq('id', existing.id)
                .eq('team_id', appState.currentUserTeamId);

            if (error) throw error;
        } else {
            // Insert
            const { error } = await _supabase
                .from('smtp_config')
                .insert({ ...config, team_id: appState.currentUserTeamId });

            if (error) throw error;
        }

        showToast('SMTP configuration saved');
        closeSmtpConfig();
    } catch (error) {
        logError('Error saving SMTP config:', error);
        showToast('Failed to save SMTP config', 'error');
    }
}

async function loadSmtpConfig() {
    try {
        const { data, error } = await _supabase
            .from('smtp_config')
            .select('*')
            .eq('team_id', appState.currentUserTeamId)
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        return data;
    } catch (error) {
        logError('Error loading SMTP config:', error);
        return null;
    }
}

// Called by announcement.html on load (replaces openAnnouncementModal for full-page use)
export async function initAnnouncementPage() {
    if (!announcementBodyEditor) {
        initQuillEditor();
    }
    if (!templatesLoaded) {
        await loadSavedTemplates();
        templatesLoaded = true;
    }
    if (!announcementsLoaded) {
        await loadPreviousAnnouncements();
        announcementsLoaded = true;
    }
    bccEmails = [];
    renderBccEmails();

    // Pre-populate the inline SMTP form if it exists on the page
    await populateSmtpForm();

    // Render saved templates into the inline panel if it exists
    renderSavedTemplates();

    // Wire reply-thread select (on the full page it may not exist during setupEventListeners)
    const replyThreadSelect = document.getElementById('announcement-reply-thread');
    if (replyThreadSelect && !replyThreadSelect._wired) {
        replyThreadSelect._wired = true;
        replyThreadSelect.addEventListener('change', (e) => {
            if (e.target.value) handleReplyThreadSelection(e.target.value);
        });
    }
}

// Populates SMTP form fields without opening a modal — used for inline SMTP section
export async function populateSmtpForm() {
    const config = await loadSmtpConfig();
    if (config) {
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        set('smtp-host', config.host || '');
        set('smtp-port', config.port || 587);
        set('smtp-secure', config.secure ? 'true' : 'false');
        set('smtp-user', config.smtp_user || '');
        set('smtp-password', config.smtp_password || '');
        set('smtp-from-email', config.from_email || '');
        set('smtp-from-name', config.from_name || 'B-Pal Support Team');
    }
}

// Template Manager Functions
export function toggleClientScopeVisibility() {
    const type = document.getElementById('template-type')?.value;
    const scopeGroup = document.getElementById('client-scope-group');
    if (scopeGroup) scopeGroup.style.display = type === 'external' ? '' : 'none';
}

function openTemplateManager() {
    loadSavedTemplates();
    renderSavedTemplates();

    // Initialize template editor if not already initialized
    if (!templateBodyEditor) {
        initTemplateQuillEditor();
    }

    document.getElementById('template-manager-modal').classList.add('active');
}

function closeTemplateManager() {
    document.getElementById('template-manager-modal').classList.remove('active');
    // Clear form
    document.getElementById('template-name').value = '';
    document.getElementById('template-subject').value = '';
    if (templateBodyEditor) {
        templateBodyEditor.setContents([]);
    }
    document.getElementById('template-body').value = '';
    document.getElementById('template-type').value = 'internal';
    document.getElementById('template-to').value = '';
    document.getElementById('template-cc').value = '';
    document.getElementById('template-bcc').value = '';
}

async function loadSavedTemplates() {
    try {
        const { data, error } = await _supabase
            .from('email_templates')
            .select('*')
            .eq('team_id', appState.currentUserTeamId)
            .order('created_at', { ascending: false });

        if (error && error.code !== 'PGRST116') throw error;

        emailTemplates = data || [];

        // Update template select dropdown
        const templateSelect = document.getElementById('template-select');
        // Remove custom templates
        const customOptions = templateSelect.querySelectorAll('option[data-custom="true"]');
        customOptions.forEach(opt => opt.remove());

        // Add custom templates
        emailTemplates.forEach(template => {
            const option = document.createElement('option');
            option.value = template.id;
            option.textContent = template.name;
            option.setAttribute('data-custom', 'true');
            templateSelect.appendChild(option);
        });
    } catch (error) {
        logError('Error loading templates:', error);
    }
}

function renderSavedTemplates() {
    const container = document.getElementById('saved-templates-list');

    if (emailTemplates.length === 0) {
        container.innerHTML = '<div style="color: #64748b; text-align: center; padding: 1rem;">No templates saved yet</div>';
        return;
    }

    const scopeBadge = (t) => {
        if (t.template_type !== 'external') return '<span style="font-size:0.68rem;color:#475569;">internal</span>';
        const scope = t.client_scope || 'all';
        const map = { all: ['scope-all','All'], saas: ['scope-saas','SAAS'], prem: ['scope-prem','PREM'] };
        const [cls, label] = map[scope] || map.all;
        return `<span class="scope-badge ${cls}">${label}</span>`;
    };
    container.innerHTML = emailTemplates.map(template => `
        <div class="template-row">
            <div class="template-row-info">
                <div class="template-row-name">${template.name}</div>
                <div class="template-row-subject" title="${template.subject}">${template.subject}</div>
            </div>
            ${scopeBadge(template)}
            <div class="template-row-actions">
                <button onclick="clients.editTemplate(${template.id})" style="padding:0.28rem 0.65rem;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);border-radius:0.35rem;color:#93c5fd;cursor:pointer;font-size:0.75rem;font-weight:600;">✏️</button>
                <button onclick="clients.deleteTemplate(${template.id})" style="padding:0.28rem 0.65rem;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);border-radius:0.35rem;color:#fca5a5;cursor:pointer;font-size:0.75rem;font-weight:600;">🗑</button>
            </div>
        </div>
    `).join('');
}

async function saveTemplate() {
    const name = document.getElementById('template-name').value.trim();
    const subject = document.getElementById('template-subject').value.trim();
    const body = document.getElementById('template-body').value.trim();
    const template_type = document.getElementById('template-type').value;
    const client_scope = template_type === 'external'
        ? (document.getElementById('template-client-scope').value || 'all')
        : 'all';
    const to_recipients = document.getElementById('template-to').value.trim();
    const cc = document.getElementById('template-cc').value.trim();
    const bcc = document.getElementById('template-bcc').value.trim();

    if (!name || !subject || !body) {
        showToast('Please fill in name, subject, and body', 'error');
        return;
    }

    try {
        const templateData = { name, subject, body, template_type, client_scope, to_recipients, cc, bcc, team_id: appState.currentUserTeamId };

        if (window.editingTemplateId) {
            // Update existing template
            const { error } = await _supabase.from('email_templates')
                .update(templateData)
                .eq('id', window.editingTemplateId);
            if (error) throw error;
            window.editingTemplateId = null;
        } else {
            // Insert new template
            const { error } = await _supabase.from('email_templates').insert(templateData);
            if (error) throw error;
        }

        showToast('Template saved successfully');
        await loadSavedTemplates();
        renderSavedTemplates();

        // Clear form
        document.getElementById('template-name').value = '';
        document.getElementById('template-subject').value = '';
        if (templateBodyEditor) {
            templateBodyEditor.setContents([]);
        }
        document.getElementById('template-body').value = '';
        document.getElementById('template-type').value = 'internal';
        document.getElementById('template-client-scope').value = 'all';
        document.getElementById('template-to').value = '';
        document.getElementById('template-cc').value = '';
        document.getElementById('template-bcc').value = '';
        toggleClientScopeVisibility();
    } catch (error) {
        logError('Error saving template:', error);
        showToast('Failed to save template', 'error');
    }
}

function editTemplate(templateId) {
    const template = emailTemplates.find(t => t.id === templateId);
    if (!template) return;

    document.getElementById('template-name').value = template.name;
    document.getElementById('template-subject').value = template.subject;

    // Set body in Quill editor
    if (templateBodyEditor) {
        templateBodyEditor.setText('');
        templateBodyEditor.clipboard.dangerouslyPasteHTML(0, template.body);
        document.getElementById('template-body').value = templateBodyEditor.root.innerHTML;
    } else {
        document.getElementById('template-body').value = template.body;
    }

    document.getElementById('template-type').value = template.template_type || 'internal';
    document.getElementById('template-client-scope').value = template.client_scope || 'all';
    document.getElementById('template-to').value = template.to_recipients || '';
    document.getElementById('template-cc').value = template.cc || '';
    document.getElementById('template-bcc').value = template.bcc || '';
    toggleClientScopeVisibility();

    // Update existing template on save
    window.editingTemplateId = templateId;
}

async function deleteTemplate(templateId) {
    if (!confirm('Are you sure you want to delete this template?')) return;

    try {
        const { error } = await _supabase
            .from('email_templates')
            .delete()
            .eq('id', templateId);

        if (error) throw error;

        showToast('Template deleted successfully');
        await loadSavedTemplates();
        renderSavedTemplates();
    } catch (error) {
        logError('Error deleting template:', error);
        showToast('Failed to delete template', 'error');
    }
}

// Paste Table Helper Functions
function showPasteTableHelper() {
    document.getElementById('paste-table-helper-modal').classList.add('active');
    // Clear any previous content
    document.getElementById('paste-table-area').innerHTML = '';
}

function closePasteTableHelper() {
    document.getElementById('paste-table-helper-modal').classList.remove('active');
    document.getElementById('paste-table-area').innerHTML = '';
}

function insertPastedTable() {
    const pasteArea = document.getElementById('paste-table-area');
    const htmlContent = pasteArea.innerHTML.trim();

    if (!htmlContent) {
        showToast('Please paste a table first', 'error');
        return;
    }

    log('[insertPastedTable] Getting HTML content from paste area');

    // Use the same processing function as direct paste
    const processedTable = processTableHTML(htmlContent);

    if (!processedTable) {
        showToast('No table found. Please paste a table.', 'error');
        return;
    }

    log('[insertPastedTable] Processed table length:', processedTable.length);

    // Insert into Quill editor (same method as before - this works)
    if (announcementBodyEditor) {
        const range = announcementBodyEditor.getSelection(true) || { index: announcementBodyEditor.getLength() };
        announcementBodyEditor.clipboard.dangerouslyPasteHTML(range.index, processedTable + '<p><br></p>');

        // Update hidden input
        document.getElementById('announcement-body').value = announcementBodyEditor.root.innerHTML;

        log('[insertPastedTable] Table inserted');

        showToast('Table inserted successfully!', 'success');
        closePasteTableHelper();
    } else {
        showToast('Editor not ready. Please try again.', 'error');
    }
}

// Export functions for window access
window.clients = {
    openStatusModal,
    closeStatusModal,
    saveStatus,
    openEmailsModal,
    closeEmailsModal,
    saveEmails,
    addEmailToList,
    removeEmailFromList,
    openDocModal,
    closeDocModal,
    uploadDocumentation,
    downloadDocumentation,
    deleteDocumentation,
    copyToClipboard,
    openEditClientModal,
    closeEditClientModal,
    saveEditClient,
    openAddClientModal,
    closeAddClientModal,
    saveNewClient,
    openAnnouncementModal,
    closeAnnouncementModal,
    loadTemplate,
    sendAnnouncement,
    removeBccEmail,
    openSmtpConfig,
    closeSmtpConfig,
    saveSmtpConfig,
    openTemplateManager,
    closeTemplateManager,
    saveTemplate,
    editTemplate,
    deleteTemplate,
    saveCurrentAsTemplate,
    showPasteTableHelper,
    closePasteTableHelper,
    insertPastedTable,
    getAllClients: () => allClients,
    showToast,
    setClientType,
    toggleAddModalType,
    addServerRow,
    removeServerRow,
    toggleClientScopeVisibility,
    initAnnouncementPage,
    populateSmtpForm
};

// Save Current Announcement as Custom Template
async function saveCurrentAsTemplate() {
    const name = prompt('Enter a name for this template:');
    if (!name) return;

    const subject = document.getElementById('announcement-subject').value.trim();
    const body = document.getElementById('announcement-body').value.trim();
    const to_recipients = document.getElementById('announcement-to').value.trim();
    const cc = document.getElementById('announcement-cc').value.trim();

    if (!subject || !body) {
        showToast('Please fill in subject and body first', 'error');
        return;
    }

    try {
        const { error } = await _supabase.from('email_templates').insert({
            name,
            subject,
            body,
            template_type: 'external',  // Default templates are external
            to_recipients,
            cc,
            bcc: '',  // BCC is auto-populated for external templates
            team_id: appState.currentUserTeamId
        });

        if (error) throw error;

        showToast(`Template "${name}" saved successfully!`);
        await loadSavedTemplates();
    } catch (error) {
        logError('Error saving template:', error);
        showToast('Failed to save template', 'error');
    }
}
