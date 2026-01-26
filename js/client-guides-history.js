import { log, logError, logWarn } from './logger.js';
// Client Guides and History Module
import { _supabase } from './config.js';

// Store all guides for search filtering
let allGuidesCache = [];

// ============================================
// USER GUIDES FUNCTIONS
// ============================================

export async function openGuidesModal() {
    document.getElementById('guides-modal').classList.add('active');
    document.getElementById('guide-search').value = ''; // Clear search on open
    await loadGuides();
}

export function closeGuidesModal() {
    document.getElementById('guides-modal').classList.remove('active');
    document.getElementById('guide-label').value = '';
    document.getElementById('guide-file').value = '';
    document.getElementById('guide-search').value = '';
}

async function loadGuides(searchTerm = '') {
    const guidesList = document.getElementById('guides-list');

    try {
        const { data: guides, error } = await _supabase
            .from('user_guides')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Cache all guides for search
        allGuidesCache = guides || [];

        // Filter guides based on search term
        let filteredGuides = allGuidesCache;
        if (searchTerm) {
            const searchLower = searchTerm.toLowerCase();
            filteredGuides = allGuidesCache.filter(guide =>
                guide.label.toLowerCase().includes(searchLower) ||
                guide.file_name.toLowerCase().includes(searchLower) ||
                guide.uploaded_by_name.toLowerCase().includes(searchLower)
            );
        }

        if (!filteredGuides || filteredGuides.length === 0) {
            guidesList.innerHTML = `
                <div style="text-align: center; color: #94a3b8; padding: 2rem;">
                    <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">📚</p>
                    <p>${searchTerm ? 'No guides found matching your search' : 'No guides uploaded yet'}</p>
                </div>
            `;
            return;
        }

        guidesList.innerHTML = filteredGuides.map(guide => {
            const uploadDate = new Date(guide.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            const fileSizeMB = (guide.file_size / (1024 * 1024)).toFixed(2);

            return `
                <div style="background: rgba(30, 41, 59, 0.4); border-radius: 0.5rem; padding: 0.75rem 1rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="color: #e2e8f0; font-size: 0.9rem; font-weight: 600; margin-bottom: 0.25rem;">${guide.label}</div>
                        <div style="color: #94a3b8; font-size: 0.75rem;">${guide.file_name} • ${fileSizeMB} MB • ${guide.uploaded_by_name} • ${uploadDate}</div>
                    </div>
                    <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
                        <button onclick="clientGuidesHistory.downloadGuide('${guide.file_path}', '${guide.file_name}')"
                            style="padding: 0.5rem 0.75rem; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 0.375rem; color: white; cursor: pointer; font-size: 0.875rem; transition: all 0.2s;"
                            onmouseover="this.style.background='rgba(59, 130, 246, 0.3)'"
                            onmouseout="this.style.background='rgba(59, 130, 246, 0.2)'">
                            ⬇️
                        </button>
                        <button onclick="clientGuidesHistory.deleteGuide(${guide.id})"
                            style="padding: 0.5rem 0.75rem; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 0.375rem; color: white; cursor: pointer; font-size: 0.875rem; transition: all 0.2s;"
                            onmouseover="this.style.background='rgba(239, 68, 68, 0.3)'"
                            onmouseout="this.style.background='rgba(239, 68, 68, 0.2)'">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        logError('Error loading guides:', error);
        guidesList.innerHTML = `
            <div style="text-align: center; color: #ef4444; padding: 2rem;">
                Error loading guides. Please try again.
            </div>
        `;
    }
}

export async function uploadGuide() {
    const label = document.getElementById('guide-label').value.trim();
    const fileInput = document.getElementById('guide-file');
    const file = fileInput.files[0];

    if (!label) {
        showToast('Please enter a guide label', 'error');
        return;
    }

    if (!file) {
        showToast('Please select a file to upload', 'error');
        return;
    }

    // Validate file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
        showToast('File size must be less than 50MB', 'error');
        return;
    }

    try {
        showToast('Uploading guide...', 'info');

        // Upload to Supabase storage
        const fileName = `${Date.now()}_${file.name}`;
        const filePath = `user-guides/${fileName}`;

        const { error: uploadError } = await _supabase.storage
            .from('guides')
            .upload(filePath, file);

        if (uploadError) throw uploadError;

        // Get current user
        const { data: { user } } = await _supabase.auth.getUser();

        // Save metadata to database
        const { error: dbError } = await _supabase
            .from('user_guides')
            .insert({
                label: label,
                file_name: file.name,
                file_path: filePath,
                file_size: file.size,
                uploaded_by: user.id,
                uploaded_by_name: user.user_metadata.display_name || user.email
            });

        if (dbError) throw dbError;

        showToast('Guide uploaded successfully!', 'success');
        document.getElementById('guide-label').value = '';
        document.getElementById('guide-file').value = '';
        await loadGuides();

    } catch (error) {
        logError('Error uploading guide:', error);
        showToast('Failed to upload guide: ' + error.message, 'error');
    }
}

export async function downloadGuide(filePath, fileName) {
    try {
        const { data, error } = await _supabase.storage
            .from('guides')
            .download(filePath);

        if (error) throw error;

        // Create download link
        const url = window.URL.createObjectURL(data);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        showToast('Download started', 'success');
    } catch (error) {
        logError('Error downloading guide:', error);
        showToast('Failed to download guide', 'error');
    }
}

export async function deleteGuide(guideId) {
    if (!confirm('Are you sure you want to delete this guide?')) return;

    try {
        // Get guide info first to delete from storage
        const { data: guide, error: fetchError } = await _supabase
            .from('user_guides')
            .select('file_path')
            .eq('id', guideId)
            .single();

        if (fetchError) throw fetchError;

        // Delete from storage
        const { error: storageError } = await _supabase.storage
            .from('guides')
            .remove([guide.file_path]);

        if (storageError) logError('Storage delete error:', storageError);

        // Delete from database
        const { error: dbError } = await _supabase
            .from('user_guides')
            .delete()
            .eq('id', guideId);

        if (dbError) throw dbError;

        showToast('Guide deleted successfully', 'success');
        await loadGuides();

    } catch (error) {
        logError('Error deleting guide:', error);
        showToast('Failed to delete guide', 'error');
    }
}

// ============================================
// CLIENT HISTORY FUNCTIONS
// ============================================

export async function openClientHistory(clientId) {
    const client = window.clients.getAllClients().find(c => c.id === clientId);
    if (!client) return;

    document.getElementById('history-client-name').textContent = `History for: ${client.name}`;
    document.getElementById('history-modal').classList.add('active');

    await loadClientHistory(clientId);
}

export function closeHistoryModal() {
    document.getElementById('history-modal').classList.remove('active');
}

async function loadClientHistory(clientId) {
    const historyList = document.getElementById('history-list');

    try {
        const { data: history, error } = await _supabase
            .from('client_history')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!history || history.length === 0) {
            historyList.innerHTML = `
                <div style="text-align: center; color: #94a3b8; padding: 2rem;">
                    <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">📜</p>
                    <p>No history records found</p>
                </div>
            `;
            return;
        }

        historyList.innerHTML = history.map(record => {
            const actionDate = new Date(record.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            const actionTime = new Date(record.created_at).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit'
            });

            let actionIcon = '📝';
            switch (record.action_type) {
                case 'created':
                    actionIcon = '✨';
                    break;
                case 'status_changed':
                    actionIcon = '🔄';
                    break;
                case 'updated':
                    actionIcon = '✏️';
                    break;
                case 'emails_updated':
                    actionIcon = '📧';
                    break;
                case 'document_uploaded':
                    actionIcon = '📄';
                    break;
            }

            // Build simple change description
            let changeDetails = '';
            if (record.changes && Object.keys(record.changes).length > 0) {
                const changesArray = Object.entries(record.changes).map(([field, values]) => {
                    return `${field}: ${values.old || 'empty'} → ${values.new || 'empty'}`;
                });
                changeDetails = `<div style="color: #94a3b8; font-size: 0.8rem; margin-top: 0.25rem;">${changesArray.join(' • ')}</div>`;
            }

            return `
                <div style="background: rgba(30, 41, 59, 0.4); border-radius: 0.5rem; padding: 0.75rem 1rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.75rem; flex: 1;">
                        <span style="font-size: 1.25rem;">${actionIcon}</span>
                        <div style="flex: 1;">
                            <div style="color: #e2e8f0; font-size: 0.9rem;">${record.description}</div>
                            ${changeDetails}
                        </div>
                    </div>
                    <div style="text-align: right; color: #94a3b8; font-size: 0.75rem; white-space: nowrap;">
                        <div>${record.changed_by_name}</div>
                        <div>${actionDate} ${actionTime}</div>
                    </div>
                </div>
            `;
        }).join('');

    } catch (error) {
        logError('Error loading client history:', error);
        historyList.innerHTML = `
            <div style="text-align: center; color: #ef4444; padding: 2rem;">
                Error loading history. Please try again.
            </div>
        `;
    }
}

// Search guides function
export function searchGuides(searchTerm) {
    const guidesList = document.getElementById('guides-list');

    // Filter cached guides
    const searchLower = searchTerm.toLowerCase().trim();
    let filteredGuides = allGuidesCache;

    if (searchLower) {
        filteredGuides = allGuidesCache.filter(guide =>
            guide.label.toLowerCase().includes(searchLower) ||
            guide.file_name.toLowerCase().includes(searchLower) ||
            guide.uploaded_by_name.toLowerCase().includes(searchLower)
        );
    }

    // Render filtered results
    if (!filteredGuides || filteredGuides.length === 0) {
        guidesList.innerHTML = `
            <div style="text-align: center; color: #94a3b8; padding: 2rem;">
                <p style="font-size: 1.2rem; margin-bottom: 0.5rem;">📚</p>
                <p>No guides found matching "${searchTerm}"</p>
            </div>
        `;
        return;
    }

    guidesList.innerHTML = filteredGuides.map(guide => {
        const uploadDate = new Date(guide.created_at).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
        const fileSizeMB = (guide.file_size / (1024 * 1024)).toFixed(2);

        return `
            <div style="background: rgba(30, 41, 59, 0.4); border-radius: 0.5rem; padding: 0.75rem 1rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                <div style="flex: 1; min-width: 0;">
                    <div style="color: #e2e8f0; font-size: 0.9rem; font-weight: 600; margin-bottom: 0.25rem;">${guide.label}</div>
                    <div style="color: #94a3b8; font-size: 0.75rem;">${guide.file_name} • ${fileSizeMB} MB • ${guide.uploaded_by_name} • ${uploadDate}</div>
                </div>
                <div style="display: flex; gap: 0.5rem; flex-shrink: 0;">
                    <button onclick="clientGuidesHistory.downloadGuide('${guide.file_path}', '${guide.file_name}')"
                        style="padding: 0.5rem 0.75rem; background: rgba(59, 130, 246, 0.2); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 0.375rem; color: white; cursor: pointer; font-size: 0.875rem; transition: all 0.2s;"
                        onmouseover="this.style.background='rgba(59, 130, 246, 0.3)'"
                        onmouseout="this.style.background='rgba(59, 130, 246, 0.2)'">
                        ⬇️
                    </button>
                    <button onclick="clientGuidesHistory.deleteGuide(${guide.id})"
                        style="padding: 0.5rem 0.75rem; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 0.375rem; color: white; cursor: pointer; font-size: 0.875rem; transition: all 0.2s;"
                        onmouseover="this.style.background='rgba(239, 68, 68, 0.3)'"
                        onmouseout="this.style.background='rgba(239, 68, 68, 0.2)'">
                        🗑️
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

// Helper function to show toast notifications
function showToast(message, type = 'info') {
    if (window.clients && window.clients.showToast) {
        window.clients.showToast(message, type);
    } else {
        log(`[${type.toUpperCase()}] ${message}`);
    }
}

// Export functions
window.clientGuidesHistory = {
    openGuidesModal,
    closeGuidesModal,
    uploadGuide,
    downloadGuide,
    deleteGuide,
    openClientHistory,
    closeHistoryModal,
    searchGuides
};
