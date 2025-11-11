// Clients Management Module
import { _supabase } from './config.js';

// State
let allClients = [];
let filteredClients = [];
let currentFilter = 'all';
let currentSearch = '';
let currentClientId = null;
let currentEmails = [];
let announcementBodyEditor = null;
let templateBodyEditor = null;

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
        console.error('Error initializing clients:', error);
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
        console.error('Error checking admin access:', error);
    }
}

// Helper function to process table HTML and preserve styles
function processTableHTML(htmlData) {
    if (!htmlData) {
        console.log('[processTableHTML] No HTML data provided');
        return null;
    }

    console.log('[processTableHTML] Processing table HTML...');

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
            console.log('[processTableHTML] No table found in HTML');
            document.body.removeChild(tempDiv);
            return null;
        }

        console.log('[processTableHTML] Table found, processing cells...');

        // Apply email-safe styling to the table
        table.setAttribute('border', '1');
        table.setAttribute('cellpadding', '8');
        table.setAttribute('cellspacing', '0');
        table.style.cssText = 'border-collapse: collapse; width: 100%; border: 1px solid #000000; margin: 10px 0; font-family: Arial, sans-serif;';

        // Process all cells (td and th)
        const allCells = table.querySelectorAll('td, th');
        console.log(`[processTableHTML] Found ${allCells.length} cells`);

        allCells.forEach((cell, index) => {
            // Get computed style
            const computedStyle = window.getComputedStyle(cell);

            // Extract important styles
            const bgColor = computedStyle.backgroundColor;
            const color = computedStyle.color;
            const fontWeight = computedStyle.fontWeight;
            const textAlign = computedStyle.textAlign;

            console.log(`[processTableHTML] Cell ${index}: bgColor=${bgColor}, color=${color}, fontWeight=${fontWeight}`);

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

        console.log('[processTableHTML] Table processed successfully');
        console.log('[processTableHTML] Result preview:', result.substring(0, 200));

        // Clean up
        document.body.removeChild(tempDiv);

        return result;
    } catch (error) {
        console.error('[processTableHTML] Error processing table:', error);
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

    announcementBodyEditor = new Quill('#announcement-body-editor', getQuillConfig());

    // Custom paste handler for tables - EXACT SAME METHOD as helper modal button
    announcementBodyEditor.root.addEventListener('paste', (e) => {
        const clipboardData = e.clipboardData || window.clipboardData;
        let htmlData = clipboardData.getData('text/html');

        if (!htmlData) {
            return;
        }

        if (htmlData.includes('<table')) {
            e.preventDefault();
            e.stopPropagation();

            console.log('[Paste Handler] Table detected in clipboard');

            // Process the HTML first
            const processedTable = processTableHTML(htmlData);

            if (processedTable) {
                console.log('[Paste Handler] Table processed, inserting...');

                // Use EXACT SAME method as insertPastedTable() function
                const range = announcementBodyEditor.getSelection(true) || { index: announcementBodyEditor.getLength() };
                announcementBodyEditor.clipboard.dangerouslyPasteHTML(range.index, processedTable + '<p><br></p>');

                // Update hidden input
                document.getElementById('announcement-body').value = announcementBodyEditor.root.innerHTML;

                console.log('[Paste Handler] Table inserted successfully');
            }
        }
    });

    // Sync Quill content to hidden input whenever it changes
    announcementBodyEditor.on('text-change', () => {
        document.getElementById('announcement-body').value = announcementBodyEditor.root.innerHTML;
    });
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

    // Custom paste handler for tables - EXACT SAME METHOD as helper modal button
    templateBodyEditor.root.addEventListener('paste', (e) => {
        const clipboardData = e.clipboardData || window.clipboardData;
        let htmlData = clipboardData.getData('text/html');

        if (!htmlData) {
            return;
        }

        if (htmlData.includes('<table')) {
            e.preventDefault();
            e.stopPropagation();

            console.log('[Template Paste Handler] Table detected in clipboard');

            // Process the HTML first
            const processedTable = processTableHTML(htmlData);

            if (processedTable) {
                console.log('[Template Paste Handler] Table processed, inserting...');

                // Use EXACT SAME method as insertPastedTable() function
                const range = templateBodyEditor.getSelection(true) || { index: templateBodyEditor.getLength() };
                templateBodyEditor.clipboard.dangerouslyPasteHTML(range.index, processedTable + '<p><br></p>');

                // Update hidden input
                document.getElementById('template-body').value = templateBodyEditor.root.innerHTML;

                console.log('[Template Paste Handler] Table inserted successfully');
            }
        }
    });

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
    if (announcementBodyEditor) {
        // Clear existing content first
        announcementBodyEditor.setText('');
        // Set new content
        announcementBodyEditor.clipboard.dangerouslyPasteHTML(0, content);
        // Update hidden input
        document.getElementById('announcement-body').value = announcementBodyEditor.root.innerHTML;
    } else {
        // Fallback if editor not ready
        document.getElementById('announcement-body').value = content;
    }
}

async function loadClients() {
    const { data, error } = await _supabase
        .from('clients')
        .select('*')
        .order('name', { ascending: true });

    if (error) throw error;

    allClients = data || [];
    applyFilters();
}

function setupEventListeners() {
    // Search input
    const searchInput = document.getElementById('search-input');
    searchInput.addEventListener('input', (e) => {
        currentSearch = e.target.value.toLowerCase();
        applyFilters();
        renderClients();
    });

    // Filter buttons
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

    // Status modal select
    const statusSelect = document.getElementById('status-select');
    statusSelect.addEventListener('change', (e) => {
        const reasonGroup = document.getElementById('reason-group');
        if (e.target.value === 'false') {
            reasonGroup.style.display = 'block';
        } else {
            reasonGroup.style.display = 'none';
        }
    });

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

    // Modal background click to close
    document.getElementById('status-modal').addEventListener('click', (e) => {
        if (e.target.id === 'status-modal') closeStatusModal();
    });
    document.getElementById('emails-modal').addEventListener('click', (e) => {
        if (e.target.id === 'emails-modal') closeEmailsModal();
    });
    document.getElementById('doc-modal').addEventListener('click', (e) => {
        if (e.target.id === 'doc-modal') closeDocModal();
    });
}

function setupRealtimeSubscription() {
    _supabase
        .channel('public:clients')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, (payload) => {
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
            searchMatch =
                client.name.toLowerCase().includes(currentSearch) ||
                client.private_ip.toLowerCase().includes(currentSearch) ||
                client.public_ip.toLowerCase().includes(currentSearch) ||
                (client.domain && client.domain.toLowerCase().includes(currentSearch));
        }

        return statusMatch && searchMatch;
    });
}

function renderClients() {
    const grid = document.getElementById('clients-grid');

    if (filteredClients.length === 0) {
        grid.innerHTML = '<div class="no-results">No clients found</div>';
        return;
    }

    grid.innerHTML = filteredClients.map(client => createClientCard(client)).join('');
}

function createClientCard(client) {
    const statusClass = client.is_active ? 'active' : 'inactive';
    const statusText = client.is_active ? 'Active' : 'Inactive';
    const cardClass = client.is_active ? '' : 'inactive';

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
            <button class="edit-client-btn" onclick="clients.openEditClientModal(${client.id})" title="Edit Client">✏️</button>
            <div class="client-header">
                <h3 class="client-name">${client.name}</h3>
                <span class="status-badge ${statusClass}" onclick="clients.openStatusModal(${client.id})">
                    ${statusText}
                    ${inactiveReasonTooltip}
                </span>
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
        console.error('Error updating status:', error);
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
        console.error('Error updating emails:', error);
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
        console.error('Error uploading documentation:', error);
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
        console.error('Error deleting documentation:', error);
        showToast('Failed to delete documentation', 'error');
    }
}

// Utility Functions
function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard: ' + text);
    }).catch(err => {
        console.error('Failed to copy:', err);
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

// Edit Client Modal Functions
function openEditClientModal(clientId) {
    const client = allClients.find(c => c.id === clientId);
    if (!client) return;

    document.getElementById('edit-client-id').value = client.id;
    document.getElementById('edit-client-name').value = client.name;
    document.getElementById('edit-client-domain').value = client.domain || '';
    document.getElementById('edit-client-private-ip').value = client.private_ip;
    document.getElementById('edit-client-public-ip').value = client.public_ip;
    document.getElementById('edit-client-smpp-port').value = client.smpp_port;
    document.getElementById('edit-client-http-port').value = client.http_port;
    document.getElementById('edit-client-dlr-port').value = client.dlr_port;

    document.getElementById('edit-client-modal').classList.add('active');
}

function closeEditClientModal() {
    document.getElementById('edit-client-modal').classList.remove('active');
}

async function saveEditClient() {
    const clientId = parseInt(document.getElementById('edit-client-id').value);
    const name = document.getElementById('edit-client-name').value.trim();
    const domain = document.getElementById('edit-client-domain').value.trim();
    const privateIp = document.getElementById('edit-client-private-ip').value.trim();
    const publicIp = document.getElementById('edit-client-public-ip').value.trim();
    const smppPort = parseInt(document.getElementById('edit-client-smpp-port').value);
    const httpPort = parseInt(document.getElementById('edit-client-http-port').value);
    const dlrPort = parseInt(document.getElementById('edit-client-dlr-port').value);

    // Validation
    if (!name || !privateIp || !publicIp || !smppPort || !httpPort || !dlrPort) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    try {
        const { error } = await _supabase.from('clients').update({
            name,
            domain: domain || null,
            private_ip: privateIp,
            public_ip: publicIp,
            smpp_port: smppPort,
            http_port: httpPort,
            dlr_port: dlrPort,
            updated_at: new Date().toISOString()
        }).eq('id', clientId);

        if (error) throw error;

        showToast('Client updated successfully');
        closeEditClientModal();
    } catch (error) {
        console.error('Error updating client:', error);
        showToast('Failed to update client', 'error');
    }
}

// Add Client Modal Functions
function openAddClientModal() {
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
}

async function saveNewClient() {
    const name = document.getElementById('add-client-name').value.trim();
    const domain = document.getElementById('add-client-domain').value.trim();
    const privateIp = document.getElementById('add-client-private-ip').value.trim();
    const publicIp = document.getElementById('add-client-public-ip').value.trim();
    const smppPort = parseInt(document.getElementById('add-client-smpp-port').value);
    const httpPort = parseInt(document.getElementById('add-client-http-port').value);
    const dlrPort = parseInt(document.getElementById('add-client-dlr-port').value);
    const isActive = document.getElementById('add-client-status').value === 'true';
    const emailsInput = document.getElementById('add-client-emails').value.trim();

    // Validation
    if (!name || !privateIp || !publicIp || !smppPort || !httpPort || !dlrPort) {
        showToast('Please fill in all required fields', 'error');
        return;
    }

    // Parse emails
    const emails = emailsInput ? emailsInput.split(',').map(e => e.trim()).filter(e => e) : [];

    try {
        const { error } = await _supabase.from('clients').insert({
            name,
            domain: domain || null,
            private_ip: privateIp,
            public_ip: publicIp,
            smpp_port: smppPort,
            http_port: httpPort,
            dlr_port: dlrPort,
            is_active: isActive,
            emails
        });

        if (error) throw error;

        showToast('Client added successfully');
        closeAddClientModal();
    } catch (error) {
        console.error('Error adding client:', error);
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
        console.log('[loadPreviousAnnouncements] Starting to fetch announcements...');
        const { data, error } = await _supabase
            .from('sent_announcements')
            .select('id, subject, message_id, sent_at, sent_to, sent_cc, sent_bcc')
            .order('sent_at', { ascending: false })
            .limit(20);

        if (error) {
            console.error('[loadPreviousAnnouncements] Error:', error);
            showToast('Failed to load previous announcements', 'error');
            return;
        }

        console.log('[loadPreviousAnnouncements] Fetched data:', data);
        console.log('[loadPreviousAnnouncements] Number of announcements:', data?.length || 0);

        previousAnnouncements = data || [];
        renderPreviousAnnouncements();
    } catch (error) {
        console.error('[loadPreviousAnnouncements] Catch error:', error);
        showToast('Failed to load previous announcements', 'error');
    }
}

function renderPreviousAnnouncements() {
    const select = document.getElementById('announcement-reply-thread');
    if (!select) {
        console.error('[renderPreviousAnnouncements] Select element not found');
        return;
    }

    console.log('[renderPreviousAnnouncements] Rendering', previousAnnouncements.length, 'announcements');

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
        console.log('[renderPreviousAnnouncements] Added option:', announcement.subject);
    });

    console.log('[renderPreviousAnnouncements] Total options in select:', select.options.length);
}

function handleReplyThreadSelection(messageId) {
    // Find the selected announcement from cache
    const announcement = previousAnnouncements.find(a => a.message_id === messageId);
    if (!announcement) return;

    console.log('[handleReplyThreadSelection] Selected announcement:', announcement);

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
                // External template - populate BCC with active client emails
                allClients.forEach(client => {
                    if (client.is_active && client.emails && client.emails.length > 0) {
                        bccEmails.push(...client.emails);
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
                console.error('Error reading file:', file.name, error);
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
                    sent_by: (await _supabase.auth.getUser()).data.user?.email || 'Unknown'
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
                console.error('Error saving sent announcement:', saveError);
                // Don't fail the whole operation if saving fails
            }
        }

        // Show detailed success message
        const totalSent = result.totalRecipients?.total || 0;
        showToast(`Announcement sent successfully to ${totalSent} recipient(s)!`);
        closeAnnouncementModal();
    } catch (error) {
        console.error('Error sending announcement:', error);
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
        // Check if config exists
        const { data: existing } = await _supabase
            .from('smtp_config')
            .select('id')
            .limit(1)
            .single();

        if (existing) {
            // Update
            const { error } = await _supabase
                .from('smtp_config')
                .update(config)
                .eq('id', existing.id);

            if (error) throw error;
        } else {
            // Insert
            const { error } = await _supabase
                .from('smtp_config')
                .insert(config);

            if (error) throw error;
        }

        showToast('SMTP configuration saved');
        closeSmtpConfig();
    } catch (error) {
        console.error('Error saving SMTP config:', error);
        showToast('Failed to save SMTP config', 'error');
    }
}

async function loadSmtpConfig() {
    try {
        const { data, error } = await _supabase
            .from('smtp_config')
            .select('*')
            .limit(1)
            .single();

        if (error && error.code !== 'PGRST116') throw error;
        return data;
    } catch (error) {
        console.error('Error loading SMTP config:', error);
        return null;
    }
}

// Template Manager Functions
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
        console.error('Error loading templates:', error);
    }
}

function renderSavedTemplates() {
    const container = document.getElementById('saved-templates-list');

    if (emailTemplates.length === 0) {
        container.innerHTML = '<div style="color: #64748b; text-align: center; padding: 1rem;">No templates saved yet</div>';
        return;
    }

    container.innerHTML = emailTemplates.map(template => `
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 0.5rem; margin-bottom: 0.5rem;">
            <div>
                <div style="color: #e2e8f0; font-weight: 600;">${template.name}</div>
                <div style="color: #94a3b8; font-size: 0.75rem;">${template.subject}</div>
            </div>
            <div style="display: flex; gap: 0.5rem;">
                <button onclick="clients.editTemplate(${template.id})" style="padding: 0.25rem 0.75rem; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 0.25rem; color: #93c5fd; cursor: pointer; font-size: 0.75rem;">Edit</button>
                <button onclick="clients.deleteTemplate(${template.id})" style="padding: 0.25rem 0.75rem; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 0.25rem; color: #fca5a5; cursor: pointer; font-size: 0.75rem;">Delete</button>
            </div>
        </div>
    `).join('');
}

async function saveTemplate() {
    const name = document.getElementById('template-name').value.trim();
    const subject = document.getElementById('template-subject').value.trim();
    const body = document.getElementById('template-body').value.trim();
    const template_type = document.getElementById('template-type').value;
    const to_recipients = document.getElementById('template-to').value.trim();
    const cc = document.getElementById('template-cc').value.trim();
    const bcc = document.getElementById('template-bcc').value.trim();

    if (!name || !subject || !body) {
        showToast('Please fill in name, subject, and body', 'error');
        return;
    }

    try {
        const { error } = await _supabase.from('email_templates').insert({
            name,
            subject,
            body,
            template_type,
            to_recipients,
            cc,
            bcc
        });

        if (error) throw error;

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
        document.getElementById('template-to').value = '';
        document.getElementById('template-cc').value = '';
        document.getElementById('template-bcc').value = '';
    } catch (error) {
        console.error('Error saving template:', error);
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
    document.getElementById('template-to').value = template.to_recipients || '';
    document.getElementById('template-cc').value = template.cc || '';
    document.getElementById('template-bcc').value = template.bcc || '';

    // Delete the old template when user saves
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
        console.error('Error deleting template:', error);
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

    console.log('[insertPastedTable] Getting HTML content from paste area');

    // Use the same processing function as direct paste
    const processedTable = processTableHTML(htmlContent);

    if (!processedTable) {
        showToast('No table found. Please paste a table.', 'error');
        return;
    }

    console.log('[insertPastedTable] Processed table length:', processedTable.length);

    // Insert into Quill editor (same method as before - this works)
    if (announcementBodyEditor) {
        const range = announcementBodyEditor.getSelection(true) || { index: announcementBodyEditor.getLength() };
        announcementBodyEditor.clipboard.dangerouslyPasteHTML(range.index, processedTable + '<p><br></p>');

        // Update hidden input
        document.getElementById('announcement-body').value = announcementBodyEditor.root.innerHTML;

        console.log('[insertPastedTable] Table inserted');

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
    insertPastedTable
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
            bcc: ''  // BCC is auto-populated for external templates
        });

        if (error) throw error;

        showToast(`Template "${name}" saved successfully!`);
        await loadSavedTemplates();
    } catch (error) {
        console.error('Error saving template:', error);
        showToast('Failed to save template', 'error');
    }
}
