// admin/js/admin-ticket-config.js
// Ticket Form Configuration — per-team customization

import { _supabase } from '../../js/config.js';
import { showNotification } from './admin-main.js';

const DEFAULT_CONFIG = {
    require_shift: true,
    sources: [
        { id: 'outlook', label: 'Outlook', emoji: '📧', enabled: true },
        { id: 'teams',   label: 'Teams',   emoji: '💬', enabled: true }
    ],
    tags: [
        { value: 'MM',         label: 'MM',         enabled: true },
        { value: 'Prem',       label: 'Prem',       enabled: true },
        { value: 'SAAS',       label: 'SAAS',       enabled: true },
        { value: 'AS',         label: 'AS',         enabled: true },
        { value: 'Deployment', label: 'Deployment', enabled: true }
    ],
    fields: {
        source:    { enabled: true },
        subject:   { enabled: true, label: 'Subject' },
        assign_to: { enabled: true },
        priority:  { enabled: true },
        tags:      { enabled: true }
    }
};

const FIELD_LABELS = {
    source:    'Source Buttons',
    subject:   'Subject',
    assign_to: 'Assign To',
    priority:  'Priority',
    tags:      'Tags'
};

let currentConfig = null;
let currentTeamId = null;

// -----------------------------------------------------------------
// Load teams into the selector
// -----------------------------------------------------------------
async function loadTeamsIntoSelector() {
    const sel = document.getElementById('settings-team-select');
    if (!sel) return;
    const { data: teams } = await _supabase
        .from('teams')
        .select('id, name')
        .eq('is_active', true)
        .order('name');
    sel.innerHTML = '<option value="">— Select a team —</option>' +
        (teams || []).map(t => `<option value="${t.id}">${t.name}</option>`).join('');
}

// -----------------------------------------------------------------
// Load config for selected team
// -----------------------------------------------------------------
async function loadConfig() {
    const sel = document.getElementById('settings-team-select');
    currentTeamId = sel?.value || null;
    if (!currentTeamId) {
        showNotification('No Team Selected', 'Please select a team first.', 'error');
        return;
    }

    const { data } = await _supabase
        .from('team_ticket_config')
        .select('config')
        .eq('team_id', currentTeamId)
        .maybeSingle();

    currentConfig = JSON.parse(JSON.stringify(data?.config || DEFAULT_CONFIG));
    renderEditor();
    document.getElementById('ticket-config-editor').classList.remove('hidden');
}

// -----------------------------------------------------------------
// Render the editor UI from currentConfig
// -----------------------------------------------------------------
function renderEditor() {
    if (!currentConfig) return;

    // Shift toggle
    document.getElementById('cfg-require-shift').checked = currentConfig.require_shift !== false;

    // Fields
    const fieldsList = document.getElementById('cfg-fields-list');
    fieldsList.innerHTML = Object.entries(currentConfig.fields || DEFAULT_CONFIG.fields).map(([key, field]) => `
        <div class="flex items-center gap-4 bg-gray-700/40 rounded-lg p-3">
            <label class="flex items-center gap-2 cursor-pointer w-40">
                <div class="relative flex-shrink-0">
                    <input type="checkbox" data-field="${key}" class="cfg-field-toggle sr-only peer"
                        ${field.enabled !== false ? 'checked' : ''}>
                    <div class="w-9 h-5 bg-gray-600 rounded-full peer peer-checked:bg-indigo-600 transition-colors"></div>
                    <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
                </div>
                <span class="text-gray-300 text-sm">${FIELD_LABELS[key]}</span>
            </label>
            ${key === 'subject' ? `
                <input type="text" data-field-label="${key}" value="${field.label || 'Subject'}"
                    class="flex-1 bg-gray-700 border border-gray-600 text-white text-sm rounded px-3 py-1.5 focus:border-indigo-500 focus:outline-none"
                    placeholder="Field label...">
            ` : '<div class="flex-1"></div>'}
        </div>
    `).join('');

    // Sources
    renderSourcesList();

    // Tags
    renderTagsList();
}

function renderSourcesList() {
    const list = document.getElementById('cfg-sources-list');
    const sources = currentConfig.sources || [];
    list.innerHTML = sources.map((s, i) => `
        <div class="flex items-center gap-3 bg-gray-700/40 rounded-lg p-3" data-source-index="${i}">
            <label class="relative flex-shrink-0 cursor-pointer">
                <input type="checkbox" class="cfg-source-enabled sr-only peer" data-idx="${i}"
                    ${s.enabled ? 'checked' : ''}>
                <div class="w-9 h-5 bg-gray-600 rounded-full peer peer-checked:bg-indigo-600 transition-colors"></div>
                <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
            </label>
            <input type="text" class="cfg-source-emoji w-12 bg-gray-700 border border-gray-600 text-white text-sm rounded px-2 py-1.5 text-center focus:border-indigo-500 focus:outline-none"
                value="${s.emoji}" data-idx="${i}" placeholder="📧">
            <input type="text" class="cfg-source-label flex-1 bg-gray-700 border border-gray-600 text-white text-sm rounded px-3 py-1.5 focus:border-indigo-500 focus:outline-none"
                value="${s.label}" data-idx="${i}" placeholder="Source name">
            <button onclick="window.ticketConfig.removeSource(${i})"
                class="text-red-400 hover:text-red-300 transition-colors text-lg leading-none px-1" title="Remove">×</button>
        </div>
    `).join('');
}

function renderTagsList() {
    const list = document.getElementById('cfg-tags-list');
    const tags = currentConfig.tags || [];
    list.innerHTML = tags.map((t, i) => `
        <div class="flex items-center gap-3 bg-gray-700/40 rounded-lg p-3" data-tag-index="${i}">
            <label class="relative flex-shrink-0 cursor-pointer">
                <input type="checkbox" class="cfg-tag-enabled sr-only peer" data-idx="${i}"
                    ${t.enabled ? 'checked' : ''}>
                <div class="w-9 h-5 bg-gray-600 rounded-full peer peer-checked:bg-indigo-600 transition-colors"></div>
                <div class="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4"></div>
            </label>
            <input type="text" class="cfg-tag-label flex-1 bg-gray-700 border border-gray-600 text-white text-sm rounded px-3 py-1.5 focus:border-indigo-500 focus:outline-none"
                value="${t.label}" data-idx="${i}" placeholder="Tag label">
            <button onclick="window.ticketConfig.removeTag(${i})"
                class="text-red-400 hover:text-red-300 transition-colors text-lg leading-none px-1" title="Remove">×</button>
        </div>
    `).join('');
}

// -----------------------------------------------------------------
// Collect current UI values into currentConfig
// -----------------------------------------------------------------
function collectConfig() {
    // Shift
    currentConfig.require_shift = document.getElementById('cfg-require-shift').checked;

    // Fields
    document.querySelectorAll('.cfg-field-toggle').forEach(cb => {
        const key = cb.dataset.field;
        if (!currentConfig.fields[key]) currentConfig.fields[key] = {};
        currentConfig.fields[key].enabled = cb.checked;
    });
    document.querySelectorAll('[data-field-label]').forEach(inp => {
        const key = inp.dataset.fieldLabel;
        if (!currentConfig.fields[key]) currentConfig.fields[key] = {};
        currentConfig.fields[key].label = inp.value.trim() || 'Subject';
    });

    // Sources
    currentConfig.sources.forEach((s, i) => {
        const enabledCb = document.querySelector(`.cfg-source-enabled[data-idx="${i}"]`);
        const emojiIn   = document.querySelector(`.cfg-source-emoji[data-idx="${i}"]`);
        const labelIn   = document.querySelector(`.cfg-source-label[data-idx="${i}"]`);
        if (enabledCb) s.enabled = enabledCb.checked;
        if (emojiIn)   s.emoji   = emojiIn.value.trim() || '📋';
        if (labelIn)   s.label   = labelIn.value.trim() || `Source ${i + 1}`;
    });

    // Tags
    currentConfig.tags.forEach((t, i) => {
        const enabledCb = document.querySelector(`.cfg-tag-enabled[data-idx="${i}"]`);
        const labelIn   = document.querySelector(`.cfg-tag-label[data-idx="${i}"]`);
        if (enabledCb) t.enabled = enabledCb.checked;
        if (labelIn) {
            const newLabel = labelIn.value.trim() || `Tag ${i + 1}`;
            t.label = newLabel;
            t.value = newLabel; // keep value in sync for DB storage
        }
    });
}

// -----------------------------------------------------------------
// Save to Supabase
// -----------------------------------------------------------------
async function saveConfig() {
    if (!currentTeamId) {
        showNotification('Error', 'No team selected.', 'error');
        return;
    }
    collectConfig();

    const { data: saved, error } = await _supabase
        .from('team_ticket_config')
        .upsert({ team_id: currentTeamId, config: currentConfig, updated_at: new Date().toISOString() },
                 { onConflict: 'team_id' })
        .select();

    console.log('[TicketConfig] upsert result:', { saved, error, teamId: currentTeamId });

    if (error) {
        showNotification('Save Failed', error.message, 'error');
    } else if (!saved || saved.length === 0) {
        showNotification('Save Blocked', 'Config was not saved — RLS policy may be blocking this insert. Check the console.', 'error');
    } else {
        showNotification('Saved', 'Ticket form config updated successfully.', 'success');
    }
}

// -----------------------------------------------------------------
// Reset to default
// -----------------------------------------------------------------
function resetToDefault() {
    if (!confirm('Reset this team\'s config to default? This cannot be undone.')) return;
    currentConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    renderEditor();
}

// -----------------------------------------------------------------
// Add / Remove Sources
// -----------------------------------------------------------------
function addSource() {
    collectConfig();
    currentConfig.sources.push({ id: `source_${Date.now()}`, label: 'New Source', emoji: '📋', enabled: true });
    renderSourcesList();
}

function removeSource(idx) {
    collectConfig();
    currentConfig.sources.splice(idx, 1);
    renderSourcesList();
}

// -----------------------------------------------------------------
// Add / Remove Tags
// -----------------------------------------------------------------
function addTag() {
    collectConfig();
    currentConfig.tags.push({ value: `tag_${Date.now()}`, label: 'New Tag', enabled: true });
    renderTagsList();
}

function removeTag(idx) {
    collectConfig();
    currentConfig.tags.splice(idx, 1);
    renderTagsList();
}

// -----------------------------------------------------------------
// Initialize when Settings section is shown
// -----------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    // Load teams into selector whenever the settings section becomes visible
    const observer = new MutationObserver((mutations) => {
        mutations.forEach(m => {
            if (m.target.id === 'section-settings' && !m.target.classList.contains('hidden')) {
                loadTeamsIntoSelector();
            }
        });
    });
    const settingsSection = document.getElementById('section-settings');
    if (settingsSection) {
        observer.observe(settingsSection, { attributes: true, attributeFilter: ['class'] });
    }
});

// Expose globally so inline onclick handlers work
window.ticketConfig = { loadConfig, saveConfig, resetToDefault, addSource, removeSource, addTag, removeTag };
