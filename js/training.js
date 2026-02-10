import { log, logError, logWarn } from './logger.js';
import { _supabase, SUPABASE_URL_EXPORT } from './config.js';
import { appState } from './state.js';

// Training Session Content Structure
const TRAINING_SESSIONS = {
    1: {
        title: 'Session 1: System Overview & Core Functionalities',
        duration: '1-2 hours',
        objective: 'Understand the basics of B-PAL, user management, routing, and traffic monitoring.',
        subjects: [
            { id: 's1_1', title: 'General Introduction to B-PAL & System Overview', description: 'Purpose & key functionalities' },
            { id: 's1_2', title: 'User & Role Management', description: 'Creating users & assigning roles based on specific permissions' },
            { id: 's1_3', title: 'System Configuration (Overview and Target)', description: 'Configure the SMTP and IMAP Details (a must) and ability to send/receive notification (emails) to system' },
            { id: 's1_4', title: 'Notification Panel', description: 'Viewing system notification\'s status' },
            { id: 's1_5', title: 'Profile & Account Creation', description: 'Creating a profile & linking accounts (HTTP, SMPP), Discussing profile schema & filters' },
            { id: 's1_6', title: 'Vendor Cost Management', description: 'Importing costs for a specific vendor using sheet importation or manual in cost plan' },
            { id: 's1_7', title: 'Routing & Rate Plans', description: 'Creating routes via sheet importation or route plan, Managing subroutes' },
            { id: 's1_8', title: 'Client Notifications', description: 'How to send client notifications (internal or external)' },
            { id: 's1_9', title: 'Vendor Testing', description: 'Running & managing vendor test sessions' },
            { id: 's1_10', title: 'Traffic Monitoring', description: 'Checking Live Monitor for real-time traffic, Viewing logs in EDR Page, Monitoring gateway accounts' }
        ]
    },
    2: {
        title: 'Session 2: Advanced Routing & Security',
        duration: '1-2 hours',
        objective: 'Master routing management, Prefix settings, and translation rules.',
        subjects: [
            { id: 's2_1', title: 'Operator Page Management', description: 'Adding operators & setting aliases' },
            { id: 's2_2', title: 'MCC MNC Management', description: 'Understanding MCC/MNC and configuring it' },
            { id: 's2_3', title: 'Prefix Management', description: 'Adding, editing, and managing prefixes' },
            { id: 's2_4', title: 'Operator Management Tool', description: 'Importing & managing sessions, Confirmation of session after importation' },
            { id: 's2_5', title: 'Dynamic Rules for Routing', description: 'Alert, Block, or route shift in case of loss (profit<0), Alert, shift to another route (in case of low DLR)' },
            { id: 's2_6', title: 'SMS Firewall', description: 'Block all content which are not OTP, Translate SID from numeric to Fixed alphanumeric code' },
            { id: 's2_7', title: 'Prefix Translation', description: 'Remove Specific digits from SID or destination number received from Client before forwarding to vendor' },
            { id: 's2_8', title: 'Content Translation', description: 'Translate Specific Content before forwarding to vendor (Ex: Forward only the OTP from Full text message)' },
            { id: 's2_9', title: 'General Overview of the Repricing Tool', description: 'Manual reprice and filters that can be applied, Automatic reprice' }
        ]
    },
    3: {
        title: 'Session 3: Financials, Reporting & Alerts',
        duration: '1-2 hours',
        objective: 'Cover financial management, service provider settings, and reporting.',
        subjects: [
            { id: 's3_1', title: 'Account Managers', description: 'Assigning & managing account managers' },
            { id: 's3_2', title: 'Invoice Management', description: 'Generating & configuring invoices, Understanding MO/MT credit limits' },
            { id: 's3_3', title: 'Payments & Financial Tracking', description: 'Adding & managing payments, Adding notes & handling currency settings' },
            { id: 's3_4', title: 'SOA Report & Financial Analysis', description: 'Generating statement of accounts (SOA)' },
            { id: 's3_5', title: 'Deals & Tax Management', description: 'Configuring deals & commitments, Managing tax settings' },
            { id: 's3_6', title: 'Starting Balance Configuration', description: 'Updating & resetting starting balances' },
            { id: 's3_7', title: 'Service Provider Page', description: 'Adding & managing service providers' },
            { id: 's3_8', title: 'Alerts & Notifications', description: 'Setting up system alerts for critical events' },
            { id: 's3_9', title: 'Traffic Reports & Analysis', description: 'Viewing & analyzing traffic reports' }
        ]
    }
};

// Current state
let currentSessions = [];
let currentSessionDetails = null;
let additionalSessionCount = 0;

// Initialize
export async function init() {
    log('[Training] Initializing training module...');

    // Ensure appState has current user
    if (!appState.currentUser) {
        const { data: { user } } = await _supabase.auth.getUser();
        if (user) {
            appState.currentUser = user;
        }
    }

    // Resolve team_id if not already set (standalone page scenario)
    if (!appState.currentUserTeamId && appState.currentUser) {
        const { data: settings } = await _supabase
            .from('user_settings')
            .select('team_id')
            .eq('user_id', appState.currentUser.id)
            .single();
        appState.currentUserTeamId = settings?.team_id || null;
    }

    await loadSessions();
    await loadBroadcastMessages();
    renderSessions();
}

// Load all training sessions from database (for current team only)
async function loadSessions() {
    try {
        const { data, error } = await _supabase
            .from('training_sessions')
            .select('*')
            .eq('team_id', appState.currentUserTeamId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Fetch creator usernames and admin usernames for each session
        const sessionsWithCreators = await Promise.all((data || []).map(async (session) => {
            try {
                const { data: userSettings, error: userError } = await _supabase
                    .from('user_settings')
                    .select('system_username')
                    .eq('user_id', session.user_id)
                    .single();

                if (!userError && userSettings) {
                    session.creator_username = userSettings.system_username;
                }
            } catch (err) {
                log('[Training] Could not fetch username for user:', session.user_id);
            }

            // If admin assigned, fetch admin username
            if (session.is_admin_assigned && session.assigned_by_admin) {
                try {
                    const { data: adminSettings, error: adminError } = await _supabase
                        .from('user_settings')
                        .select('system_username')
                        .eq('user_id', session.assigned_by_admin)
                        .single();

                    if (!adminError && adminSettings) {
                        session.admin_username = adminSettings.system_username;
                    }
                } catch (err) {
                    log('[Training] Could not fetch admin username for:', session.assigned_by_admin);
                }
            }

            return session;
        }));

        currentSessions = sessionsWithCreators;
    } catch (err) {
        logError('[Training] Error loading sessions:', err);
        window.ui.showNotification('Error', 'Failed to load training sessions', 'error');
    }
}

// Load and display broadcast messages for current user
async function loadBroadcastMessages() {
    try {
        const { data, error } = await _supabase
            .from('broadcast_messages')
            .select('*')
            .eq('user_id', appState.currentUser.id)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .limit(1);

        if (error) throw error;

        if (data && data.length > 0) {
            const message = data[0];
            window.ui.showNotification('📚 Training Assignment', message.message, 'info');
        }
    } catch (err) {
        logError('[Training] Error loading broadcast messages:', err);
    }
}

// Render all sessions grouped by client name
function renderSessions() {
    const container = document.getElementById('sessions-container');

    if (currentSessions.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-12">
                <svg class="w-16 h-16 text-gray-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C6.5 6.253 2 10.998 2 17s4.5 10.747 10 10.747c5.5 0 10-4.75 10-10.747S17.5 6.253 12 6.253z"/>
                </svg>
                <p class="text-gray-400">No training sessions yet. Create one to get started!</p>
            </div>
        `;
        return;
    }

    // Group sessions by client name
    const groupedByClient = {};
    currentSessions.forEach(session => {
        if (!groupedByClient[session.client_name]) {
            groupedByClient[session.client_name] = [];
        }
        groupedByClient[session.client_name].push(session);
    });

    // Sort client names alphabetically
    const sortedClientNames = Object.keys(groupedByClient).sort();

    // Build HTML with grouped sessions
    let html = '';
    sortedClientNames.forEach(clientName => {
        const sessionsForClient = groupedByClient[clientName];

        html += `<div class="col-span-full">
            <div class="mb-6">
                <h2 class="text-2xl font-bold text-white mb-4 flex items-center gap-2">
                    <span>👥 ${clientName}</span>
                    <span class="text-sm font-normal text-gray-400">(${sessionsForClient.length} session${sessionsForClient.length !== 1 ? 's' : ''})</span>
                </h2>
                <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    ${sessionsForClient.map(session => {
                        const sessionContent = TRAINING_SESSIONS[session.session_number];
                        const completedCount = session.completed_subjects ? JSON.parse(session.completed_subjects).length : 0;
                        const totalCount = sessionContent.subjects.length;
                        const progress = (completedCount / totalCount) * 100;

                        const statusBadge = session.is_completed
                            ? '<span class="inline-block bg-green-500/20 text-green-300 text-xs px-2 py-1 rounded-full font-semibold">✅ Completed</span>'
                            : `<span class="inline-block bg-amber-500/20 text-amber-300 text-xs px-2 py-1 rounded-full font-semibold">${completedCount}/${totalCount}</span>`;

                        // Determine creator/assignee text
                        let creatorText = '';
                        const isOwnSession = session.user_id === appState.currentUser.id;
                        const creatorName = session.creator_username || 'Unknown';

                        if (session.is_admin_assigned) {
                            const adminName = session.admin_username || 'Admin';
                            const assignedName = session.creator_username || 'User';
                            creatorText = `<p class="text-xs text-blue-400 mb-2">📌 Assigned by ${adminName} to ${assignedName}</p>`;
                        } else if (isOwnSession) {
                            creatorText = `<p class="text-xs text-purple-400 mb-2">✏️ Created by you</p>`;
                        } else {
                            creatorText = `<p class="text-xs text-gray-400 mb-2">📝 Created by <span class="text-gray-300 font-semibold">${creatorName}</span></p>`;
                        }

                        return `
                            <div class="glassmorphism rounded-xl p-5 border border-gray-700/50 session-card cursor-pointer hover" onclick="training.openSessionDetails('${session.id}')">
                                <div class="flex items-start justify-between mb-3">
                                    <div>
                                        <h3 class="text-lg font-bold text-white">Session ${session.session_number}</h3>
                                        ${creatorText}
                                    </div>
                                    ${statusBadge}
                                </div>

                                <p class="text-sm text-gray-300 mb-3">${sessionContent.title}</p>

                                <div class="mb-3">
                                    <div class="flex items-center justify-between text-xs text-gray-400 mb-1">
                                        <span>Progress</span>
                                        <span class="font-semibold text-indigo-400">${Math.round(progress)}%</span>
                                    </div>
                                    <div class="w-full bg-gray-700/50 rounded-full h-2">
                                        <div class="bg-gradient-to-r from-indigo-600 to-blue-600 h-2 rounded-full transition-all" style="width: ${progress}%"></div>
                                    </div>
                                </div>

                                <p class="text-xs text-gray-500 mb-2">📅 ${sessionContent.duration}</p>

                                ${session.session_date || session.session_time ? `<p class="text-xs text-cyan-400 mb-3">📅 ${session.session_date ? new Date(session.session_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''} ${session.session_time ? '🕐 ' + session.session_time : ''}</p>` : ''}

                                <button onclick="event.stopPropagation(); training.deleteSession('${session.id}')" class="text-xs text-red-400 hover:text-red-300 transition-colors">
                                    🗑️ Delete Session
                                </button>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}

// Open create session modal
export function openCreateSessionModal() {
    additionalSessionCount = 0;
    document.getElementById('create-client-name').value = '';
    document.getElementById('create-session-number').value = '';
    document.getElementById('create-session-date').value = '';
    document.getElementById('create-session-time').value = '';
    document.getElementById('additional-sessions-container').innerHTML = '';
    document.getElementById('create-session-modal').classList.remove('hidden');
}

// Close create session modal
export function closeCreateSessionModal() {
    document.getElementById('create-session-modal').classList.add('hidden');
}

// Add additional session selector
export function addAdditionalSession() {
    additionalSessionCount++;
    const container = document.getElementById('additional-sessions-container');

    const sessionSelect = document.createElement('div');
    sessionSelect.className = 'space-y-2';
    sessionSelect.innerHTML = `
        <div>
            <div class="flex items-center justify-between mb-2">
                <label class="text-sm font-semibold text-gray-300">Additional Session ${additionalSessionCount}</label>
                <button type="button" onclick="this.parentElement.parentElement.remove(); training.additionalSessionCount--;" class="text-red-400 hover:text-red-300 text-sm">
                    Remove
                </button>
            </div>
            <select class="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 additional-session-select">
                <option value="">Select a session</option>
                <option value="1">Session 1: System Overview & Core Functionalities</option>
                <option value="2">Session 2: Advanced Routing & Security</option>
                <option value="3">Session 3: Financials, Reporting & Alerts</option>
            </select>
        </div>
    `;

    container.appendChild(sessionSelect);
}

// Create new training session
export async function createSession() {
    const clientName = document.getElementById('create-client-name').value.trim();
    const sessionNumber = document.getElementById('create-session-number').value;
    const sessionDate = document.getElementById('create-session-date').value;
    const sessionTime = document.getElementById('create-session-time').value;

    if (!clientName) {
        window.ui.showNotification('Error', 'Please enter a client name', 'error');
        return;
    }

    if (!sessionNumber) {
        window.ui.showNotification('Error', 'Please select a training session', 'error');
        return;
    }

    // Collect additional sessions
    const additionalSessions = [];
    document.querySelectorAll('.additional-session-select').forEach(select => {
        if (select.value) {
            additionalSessions.push(parseInt(select.value));
        }
    });

    try {
        showLoading();

        // Create main session
        const { data: mainSession, error: mainError } = await _supabase
            .from('training_sessions')
            .insert({
                user_id: appState.currentUser.id,
                client_name: clientName,
                session_number: parseInt(sessionNumber),
                session_date: sessionDate || null,
                session_time: sessionTime || null,
                completed_subjects: JSON.stringify([]),
                session_notes: '',
                is_completed: false,
                team_id: appState.currentUserTeamId
            })
            .select()
            .single();

        if (mainError) throw mainError;

        // Create additional sessions if any
        if (additionalSessions.length > 0) {
            const additionalData = additionalSessions.map(sessionNum => ({
                user_id: appState.currentUser.id,
                client_name: clientName,
                session_number: sessionNum,
                session_date: sessionDate || null,
                session_time: sessionTime || null,
                completed_subjects: JSON.stringify([]),
                session_notes: '',
                is_completed: false,
                team_id: appState.currentUserTeamId
            }));

            const { error: addError } = await _supabase
                .from('training_sessions')
                .insert(additionalData);

            if (addError) throw addError;
        }

        window.ui.showNotification('Success', 'Training session created! Click to view details.', 'success');
        closeCreateSessionModal();
        await loadSessions();
        renderSessions();
    } catch (err) {
        logError('[Training] Error creating session:', err);
        window.ui.showNotification('Error', err.message || 'Failed to create session', 'error');
    } finally {
        hideLoading();
    }
}

// Open session details
export async function openSessionDetails(sessionId) {
    try {
        const { data, error } = await _supabase
            .from('training_sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (error) throw error;

        // Fetch creator/admin/assigned-user usernames
        let creatorUsername = null;
        let adminUsername = null;
        let assignedUserUsername = null;

        if (data.is_admin_assigned && data.assigned_by_admin) {
            try {
                const { data: adminSettings, error: adminError } = await _supabase
                    .from('user_settings')
                    .select('system_username')
                    .eq('user_id', data.assigned_by_admin)
                    .single();

                if (!adminError && adminSettings) {
                    adminUsername = adminSettings.system_username;
                }
            } catch (err) {
                log('[Training] Could not fetch admin username for:', data.assigned_by_admin);
            }

            // Fetch assigned user username
            try {
                const { data: userSettings, error: userError } = await _supabase
                    .from('user_settings')
                    .select('system_username')
                    .eq('user_id', data.user_id)
                    .single();

                if (!userError && userSettings) {
                    assignedUserUsername = userSettings.system_username;
                }
            } catch (err) {
                log('[Training] Could not fetch assigned user username for:', data.user_id);
            }
        } else if (!data.is_admin_assigned && data.user_id !== appState.currentUser.id) {
            try {
                const { data: userSettings, error: userError } = await _supabase
                    .from('user_settings')
                    .select('system_username')
                    .eq('user_id', data.user_id)
                    .single();

                if (!userError && userSettings) {
                    creatorUsername = userSettings.system_username;
                }
            } catch (err) {
                log('[Training] Could not fetch username for user:', data.user_id);
            }
        }

        currentSessionDetails = data;
        const sessionContent = TRAINING_SESSIONS[data.session_number];
        const completedSubjects = data.completed_subjects ? JSON.parse(data.completed_subjects) : [];

        // Set header
        document.getElementById('detail-client-name').textContent = data.client_name;

        // Add creator/assignee info to session title
        let titleWithInfo = sessionContent.title;
        if (data.is_admin_assigned) {
            const displayAdminName = adminUsername || 'Admin';
            const displayUserName = assignedUserUsername || 'User';
            titleWithInfo += ` <span class="text-sm text-blue-300">(📌 Assigned by ${displayAdminName} to ${displayUserName})</span>`;
        } else if (data.user_id === appState.currentUser.id) {
            titleWithInfo += ' <span class="text-sm text-purple-300">(✏️ Created by you)</span>';
        } else {
            titleWithInfo += ` <span class="text-sm text-gray-300">(📝 Created by <span class="font-semibold">${creatorUsername || 'Unknown'}</span>)</span>`;
        }
        document.getElementById('detail-session-title').innerHTML = titleWithInfo;

        // Set session date and time
        if (data.session_date) {
            const dateObj = new Date(data.session_date);
            const formattedDate = dateObj.toLocaleDateString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
            document.getElementById('detail-session-date').innerHTML = `<span>📅</span><span>${formattedDate}</span>`;
        } else {
            document.getElementById('detail-session-date').innerHTML = `<span>📅</span><span>Not scheduled</span>`;
        }

        if (data.session_time) {
            document.getElementById('detail-session-time').innerHTML = `<span>🕐</span><span>${data.session_time}</span>`;
        } else {
            document.getElementById('detail-session-time').innerHTML = `<span>🕐</span><span>No time set</span>`;
        }

        document.getElementById('detail-session-notes').value = data.session_notes || '';

        // Render subjects with checkboxes in numbered table format (2 per row)
        const subjectsList = document.getElementById('detail-subjects-list');
        let subjectNumber = 1;

        subjectsList.innerHTML = sessionContent.subjects.map(subject => {
            const isCompleted = completedSubjects.includes(subject.id);
            const currentNumber = subjectNumber++;
            const bgColor = isCompleted ? 'bg-yellow-500/20' : 'bg-gray-700/40';
            const borderColor = isCompleted ? 'border-yellow-500/50' : 'border-gray-600/30';
            const hoverBg = isCompleted ? 'hover:bg-yellow-500/30' : 'hover:bg-gray-700/60';
            return `
                <div class="flex items-start gap-3 p-4 ${bgColor} rounded-lg ${hoverBg} transition-colors border ${borderColor} hover:border-yellow-500/70">
                    <!-- Number Badge -->
                    <div class="flex-shrink-0">
                        <div class="w-8 h-8 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 flex items-center justify-center font-bold text-white text-sm">
                            ${currentNumber}
                        </div>
                    </div>

                    <!-- Checkbox & Content -->
                    <div class="flex-1">
                        <div class="flex items-start gap-3">
                            <input type="checkbox" class="subject-checkbox mt-1 flex-shrink-0" data-subject-id="${subject.id}" ${isCompleted ? 'checked' : ''}
                                onchange="training.updateSubjectCompletion()">
                            <div class="flex-1">
                                <p class="font-semibold text-white leading-tight">${subject.title}</p>
                                <p class="text-xs text-gray-400 mt-1">${subject.description}</p>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');

        updateProgress();
        document.getElementById('session-details-modal').classList.remove('hidden');
    } catch (err) {
        logError('[Training] Error opening session details:', err);
        window.ui.showNotification('Error', 'Failed to load session details', 'error');
    }
}

// Close session details modal
export function closeSessionDetailsModal() {
    document.getElementById('session-details-modal').classList.add('hidden');
    currentSessionDetails = null;
}

// Toggle check all subjects
export function toggleCheckAll() {
    const checkAllCheckbox = document.getElementById('check-all-subjects');
    const subjectCheckboxes = document.querySelectorAll('.subject-checkbox:not(#check-all-subjects)');

    subjectCheckboxes.forEach(checkbox => {
        checkbox.checked = checkAllCheckbox.checked;
    });

    updateSubjectCompletion();
}

// Update subject completion
export async function updateSubjectCompletion() {
    if (!currentSessionDetails) return;

    try {
        const completedSubjects = Array.from(document.querySelectorAll('.subject-checkbox:not(#check-all-subjects):checked'))
            .map(checkbox => checkbox.dataset.subjectId);

        // Update database
        const { error } = await _supabase
            .from('training_sessions')
            .update({
                completed_subjects: JSON.stringify(completedSubjects)
            })
            .eq('id', currentSessionDetails.id);

        if (error) throw error;

        // Update local state
        currentSessionDetails.completed_subjects = JSON.stringify(completedSubjects);

        // Re-render subjects with updated colors
        renderSubjectsWithHighlighting();

        // Update progress and show/hide complete button
        updateProgress();
    } catch (err) {
        logError('[Training] Error updating subjects:', err);
        window.ui.showNotification('Error', 'Failed to update progress', 'error');
    }
}

// Helper function to re-render subjects with color highlighting
function renderSubjectsWithHighlighting() {
    const sessionContent = TRAINING_SESSIONS[currentSessionDetails.session_number];
    const completedSubjects = JSON.parse(currentSessionDetails.completed_subjects || '[]');
    const subjectsList = document.getElementById('detail-subjects-list');
    let subjectNumber = 1;

    subjectsList.innerHTML = sessionContent.subjects.map(subject => {
        const isCompleted = completedSubjects.includes(subject.id);
        const currentNumber = subjectNumber++;
        const bgColor = isCompleted ? 'bg-yellow-500/20' : 'bg-gray-700/40';
        const borderColor = isCompleted ? 'border-yellow-500/50' : 'border-gray-600/30';
        const hoverBg = isCompleted ? 'hover:bg-yellow-500/30' : 'hover:bg-gray-700/60';
        return `
            <div class="flex items-start gap-3 p-4 ${bgColor} rounded-lg ${hoverBg} transition-colors border ${borderColor} hover:border-yellow-500/70">
                <!-- Number Badge -->
                <div class="flex-shrink-0">
                    <div class="w-8 h-8 rounded-full bg-gradient-to-r from-indigo-600 to-blue-600 flex items-center justify-center font-bold text-white text-sm">
                        ${currentNumber}
                    </div>
                </div>

                <!-- Checkbox & Content -->
                <div class="flex-1">
                    <div class="flex items-start gap-3">
                        <input type="checkbox" class="subject-checkbox mt-1 flex-shrink-0" data-subject-id="${subject.id}" ${isCompleted ? 'checked' : ''}
                            onchange="training.updateSubjectCompletion()">
                        <div class="flex-1">
                            <p class="font-semibold text-white leading-tight">${subject.title}</p>
                            <p class="text-xs text-gray-400 mt-1">${subject.description}</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Update progress bar and complete button visibility
function updateProgress() {
    const sessionContent = TRAINING_SESSIONS[currentSessionDetails.session_number];
    const completedSubjects = JSON.parse(currentSessionDetails.completed_subjects || '[]');
    const totalCount = sessionContent.subjects.length;
    const progress = (completedSubjects.length / totalCount) * 100;

    // Update progress bar
    document.getElementById('detail-progress-bar').style.width = progress + '%';
    document.getElementById('detail-progress-text').textContent = `${completedSubjects.length}/${totalCount}`;

    // Show/hide complete button
    const completeButtonContainer = document.getElementById('detail-complete-button-container');
    if (completedSubjects.length === totalCount && !currentSessionDetails.is_completed) {
        completeButtonContainer.classList.remove('hidden');
    } else {
        completeButtonContainer.classList.add('hidden');
    }

    // Update check all checkbox
    const checkAll = document.getElementById('check-all-subjects');
    if (checkAll) {
        checkAll.checked = completedSubjects.length === totalCount;
    }
}

// Complete session and award points
export async function completeSession() {
    if (!currentSessionDetails) return;

    try {
        showLoading();

        // Update session as completed
        const { error: updateError } = await _supabase
            .from('training_sessions')
            .update({
                is_completed: true,
                completed_at: new Date().toISOString()
            })
            .eq('id', currentSessionDetails.id);

        if (updateError) {
            throw updateError;
        }

        // Get the current auth session for the token
        const { data: { session }, error: sessionError } = await _supabase.auth.getSession();
        if (sessionError) {
            throw new Error('Failed to get authentication session');
        }
        if (!session) {
            throw new Error('No active authentication session');
        }

        // Call Edge Function to award points
        const edgeFunctionUrl = `${SUPABASE_URL_EXPORT}/functions/v1/smart-task`;

        const requestBody = {
            eventType: 'TRAINING_COMPLETED',
            userId: appState.currentUser.id,
            username: appState.currentUser.email.split('@')[0],
            data: {
                sessionNumber: currentSessionDetails.session_number,
                clientName: currentSessionDetails.client_name
            }
        };

        const fetchHeaders = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`
        };

        const response = await fetch(edgeFunctionUrl, {
            method: 'POST',
            headers: fetchHeaders,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            let errorData;
            try {
                errorData = await response.json();
            } catch (parseErr) {
                const textData = await response.text();
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            throw new Error(errorData.error || `HTTP ${response.status}: Failed to award points`);
        }

        const result = await response.json();

        if (!result.success) {
            throw new Error('Edge function returned error');
        }

        window.ui.showNotification('🎉 Success', 'Session marked as complete! You earned 50 bonus points!', 'success');

        // Refresh and close
        setTimeout(() => {
            closeSessionDetailsModal();
            loadSessions();
            renderSessions();
        }, 1500);
    } catch (err) {
        window.ui.showNotification('Error', err.message || 'Failed to complete session', 'error');
    } finally {
        hideLoading();
    }
}

// Save session notes
export async function saveSessionNotes() {
    if (!currentSessionDetails) return;

    try {
        const notes = document.getElementById('detail-session-notes').value;

        const { error } = await _supabase
            .from('training_sessions')
            .update({ session_notes: notes })
            .eq('id', currentSessionDetails.id);

        if (error) throw error;

        currentSessionDetails.session_notes = notes;
        window.ui.showNotification('Success', 'Notes saved', 'success');
    } catch (err) {
        logError('[Training] Error saving notes:', err);
        window.ui.showNotification('Error', 'Failed to save notes', 'error');
    }
}

// Auto-save notes on blur
document.addEventListener('DOMContentLoaded', () => {
    const notesTextarea = document.getElementById('detail-session-notes');
    if (notesTextarea) {
        notesTextarea.addEventListener('blur', saveSessionNotes);
    }
});

// Delete session
export async function deleteSession(sessionId) {
    if (!confirm('Are you sure you want to delete this training session?')) return;

    try {
        showLoading();

        const { error } = await _supabase
            .from('training_sessions')
            .delete()
            .eq('id', sessionId);

        if (error) throw error;

        window.ui.showNotification('Success', 'Training session deleted', 'success');
        await loadSessions();
        renderSessions();
    } catch (err) {
        logError('[Training] Error deleting session:', err);
        window.ui.showNotification('Error', 'Failed to delete session', 'error');
    } finally {
        hideLoading();
    }
}

// Open edit session modal
export function openEditSessionModal() {
    if (!currentSessionDetails) return;

    // Populate edit form with current values
    document.getElementById('edit-session-date').value = currentSessionDetails.session_date || '';
    document.getElementById('edit-session-time').value = currentSessionDetails.session_time || '';

    document.getElementById('edit-session-modal').classList.remove('hidden');
}

// Close edit session modal
export function closeEditSessionModal() {
    document.getElementById('edit-session-modal').classList.add('hidden');
}

// Save edited session
export async function saveEditedSession() {
    if (!currentSessionDetails) return;

    try {
        showLoading();

        const sessionDate = document.getElementById('edit-session-date').value;
        const sessionTime = document.getElementById('edit-session-time').value;

        const { error } = await _supabase
            .from('training_sessions')
            .update({
                session_date: sessionDate || null,
                session_time: sessionTime || null
            })
            .eq('id', currentSessionDetails.id);

        if (error) throw error;

        // Update local state
        currentSessionDetails.session_date = sessionDate || null;
        currentSessionDetails.session_time = sessionTime || null;

        window.ui.showNotification('Success', 'Session updated successfully!', 'success');
        closeEditSessionModal();

        // Refresh the list and update details display
        await loadSessions();
        renderSessions();
        await openSessionDetails(currentSessionDetails.id);
    } catch (err) {
        logError('[Training] Error updating session:', err);
        window.ui.showNotification('Error', err.message || 'Failed to update session', 'error');
    } finally {
        hideLoading();
    }
}

// Loading functions
function showLoading() {
    document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
    document.getElementById('loading-overlay').classList.add('hidden');
}

// Export as object
export const training = {
    init,
    openCreateSessionModal,
    closeCreateSessionModal,
    addAdditionalSession,
    createSession,
    openSessionDetails,
    closeSessionDetailsModal,
    openEditSessionModal,
    closeEditSessionModal,
    saveEditedSession,
    toggleCheckAll,
    updateSubjectCompletion,
    completeSession,
    saveSessionNotes,
    deleteSession,
    additionalSessionCount: 0
};
