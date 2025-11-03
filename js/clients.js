// Clients Management Module
import { _supabase } from './config.js';

// State
let allClients = [];
let filteredClients = [];
let currentFilter = 'all';
let currentSearch = '';
let currentClientId = null;
let currentEmails = [];

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await initClients();
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

    const docBtnText = client.http_documentation_url ? 'View/Update Docs' : 'Upload Docs';

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
                <button class="action-btn" onclick="clients.openDocModal(${client.id})">${docBtnText}</button>
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
let bccEmails = [];

function openAnnouncementModal() {
    loadSavedTemplates();
    // Set default CC
    document.getElementById('announcement-cc').value = '"Ali Sabbagh" <ali.sabbagh@montymobile.com>, "B-Pal Support" <support@b-pal.net>, "Mohammad Aboud" <mohammad.aboud@montymobile.com>';

    // Collect emails from ACTIVE clients only
    bccEmails = [];
    allClients.forEach(client => {
        if (client.is_active && client.emails && client.emails.length > 0) {
            bccEmails.push(...client.emails);
        }
    });

    // Remove duplicates
    bccEmails = [...new Set(bccEmails)];

    renderBccEmails();
    document.getElementById('announcement-modal').classList.add('active');
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
    document.getElementById('announcement-body').value = '';
}

function loadTemplate() {
    const templateType = document.getElementById('template-select').value;

    if (templateType === 'urgent') {
        document.getElementById('announcement-subject').value = 'Urgent Maintenance Notification';
        document.getElementById('announcement-body').value = `Hello Team,

Kindly note that we have an urgent maintenance next Tuesday 21/10/2025 at 6 AM GMT time, which will require a restart of the B-Pal Web service.

The downtime will be 5-10 minutes; please don't make any updates on B-Pal during the activity.

Traffic will not be affected by this maintenance.

Regards,
B-Pal Support Team`;
    } else if (templateType === 'release') {
        document.getElementById('announcement-subject').value = 'Scheduled Maintenance Notification';
        document.getElementById('announcement-body').value = `Hello Team,

We would like to inform you that on Sep 16, 2025, a maintenance will take place Tuesday September 16th as per the below.
you might face service interruptions at the web level between 5:45 am and 6:15 am GMT time.
Traffic will not be affected.


BPAL Maintenance



Date
Date/Time (GMT Time):
    Tuesday Sep 16th, 2025, between 5:45 and 6:15 am
IMPACT
Impact
User may face interruption at the level of BPAL web



Regards,

B-Pal Support Team`;
    } else if (templateType) {
        // Load custom template
        const template = emailTemplates.find(t => t.id === parseInt(templateType));
        if (template) {
            document.getElementById('announcement-subject').value = template.subject;
            document.getElementById('announcement-body').value = template.body;
            document.getElementById('announcement-to').value = template.to_recipients || '';
            document.getElementById('announcement-cc').value = template.cc || '';
        }
    }
}

async function sendAnnouncement() {
    const subject = document.getElementById('announcement-subject').value.trim();
    const body = document.getElementById('announcement-body').value.trim();
    const to = document.getElementById('announcement-to').value.trim();
    const cc = document.getElementById('announcement-cc').value.trim();

    if (!subject || !body) {
        showToast('Please fill in subject and body', 'error');
        return;
    }

    if (bccEmails.length === 0) {
        showToast('No client emails selected for BCC', 'error');
        return;
    }

    // Check if SMTP is configured
    const smtpConfig = await loadSmtpConfig();
    if (!smtpConfig || !smtpConfig.host) {
        showToast('Please configure SMTP settings first', 'error');
        openSmtpConfig();
        return;
    }

    if (!confirm(`Send announcement to ${bccEmails.length} client email addresses?`)) {
        return;
    }

    try {
        // Call your email sending function or Edge Function
        showToast('Sending announcement... This may take a moment');

        // You'll need to create an Edge Function to handle email sending
        const { error } = await _supabase.functions.invoke('send-announcement', {
            body: {
                subject,
                body,
                to: to.split(',').map(e => e.trim()).filter(e => e),
                cc: cc.split(',').map(e => e.trim()).filter(e => e),
                bcc: bccEmails,
                smtp: smtpConfig
            }
        });

        if (error) throw error;

        showToast('Announcement sent successfully!');
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
    document.getElementById('template-manager-modal').classList.add('active');
}

function closeTemplateManager() {
    document.getElementById('template-manager-modal').classList.remove('active');
    // Clear form
    document.getElementById('template-name').value = '';
    document.getElementById('template-subject').value = '';
    document.getElementById('template-body').value = '';
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
        document.getElementById('template-body').value = '';
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
    document.getElementById('template-body').value = template.body;
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
    deleteTemplate
};
