import { _supabase } from './config.js';

let currentUser = null;
let currentSettings = {};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    await loadUserSettings();
    setupEventListeners();
});

// Check authentication
async function checkAuth() {
    const { data: { user } } = await _supabase.auth.getUser();
    if (!user) {
        window.location.href = 'index.html';
        return;
    }
    currentUser = user;
    document.getElementById('current-user-email').textContent = user.email;
}

// Load user settings from database
async function loadUserSettings() {
    showLoading(true);

    try {
        // Get user settings from user_settings table
        const { data: settings, error } = await _supabase
            .from('user_settings')
            .select('*')
            .eq('user_id', currentUser.id)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        // If no settings exist, create default settings
        if (!settings) {
            currentSettings = await createDefaultSettings();
        } else {
            currentSettings = settings;
        }

        // Populate form fields
        populateForm(currentSettings);

    } catch (error) {
        console.error('Error loading settings:', error);
        showNotification('Error loading settings', error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Create default settings for new user
async function createDefaultSettings() {
    const defaultSettings = {
        user_id: currentUser.id,
        system_username: currentUser.email.split('@')[0], // Immutable system identifier
        display_name: currentUser.user_metadata.display_name || currentUser.email.split('@')[0],
        profile_image_url: null,
        name_color: '#6366f1', // Indigo
        email_notifications: true,
        browser_notifications: true,
        sound_notifications: true,
        assignment_notifications: true,
        default_view: 'tickets',
        timezone: 'UTC+2',
        default_break_duration: 15,
        language: 'en',
        show_online_status: true
    };

    const { data, error } = await _supabase
        .from('user_settings')
        .insert(defaultSettings)
        .select()
        .single();

    if (error) {
        console.error('Error creating default settings:', error);
        return defaultSettings;
    }

    return data;
}

// Populate form with current settings
function populateForm(settings) {
    // Profile settings
    document.getElementById('display-name').value = settings.display_name || '';

    // Profile image
    if (settings.profile_image_url) {
        document.getElementById('profile-image-display').src = settings.profile_image_url;
        document.getElementById('profile-image-display').classList.remove('hidden');
        document.getElementById('profile-initials').classList.add('hidden');
    } else {
        const initials = getInitials(settings.display_name);
        document.getElementById('profile-initials').textContent = initials;
    }

    // Notification settings
    document.getElementById('email-notifications').checked = settings.email_notifications ?? true;
    document.getElementById('browser-notifications').checked = settings.browser_notifications ?? true;
    document.getElementById('sound-notifications').checked = settings.sound_notifications ?? true;
    document.getElementById('assignment-notifications').checked = settings.assignment_notifications ?? true;

    // Preferences
    document.getElementById('default-view').value = settings.default_view || 'tickets';
    document.getElementById('timezone').value = settings.timezone || 'UTC+2';
    document.getElementById('default-break-duration').value = settings.default_break_duration || 15;
    document.getElementById('language').value = settings.language || 'en';
    document.getElementById('show-online-status').checked = settings.show_online_status ?? true;
}

// Setup event listeners
function setupEventListeners() {
    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await _supabase.auth.signOut();
        window.location.href = 'index.html';
    });

    // Profile image upload
    document.getElementById('upload-image-btn').addEventListener('click', () => {
        document.getElementById('profile-image-input').click();
    });

    document.getElementById('profile-image-input').addEventListener('change', handleImageUpload);
    document.getElementById('remove-image-btn').addEventListener('click', removeProfileImage);

    // Display name preview
    document.getElementById('display-name').addEventListener('input', (e) => {
        const name = e.target.value || 'Your Name';

        // Update initials
        if (!currentSettings.profile_image_url) {
            document.getElementById('profile-initials').textContent = getInitials(name);
        }
    });

    // Save buttons
    document.getElementById('save-profile-btn').addEventListener('click', saveProfileSettings);
    document.getElementById('save-notifications-btn').addEventListener('click', saveNotificationSettings);
    document.getElementById('save-preferences-btn').addEventListener('click', savePreferences);
    document.getElementById('change-password-btn').addEventListener('click', changePassword);
}

// Handle image upload
async function handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    // Validate file
    if (!file.type.startsWith('image/')) {
        showNotification('Invalid file', 'Please select an image file', 'error');
        return;
    }

    if (file.size > 2 * 1024 * 1024) { // 2MB
        showNotification('File too large', 'Image must be less than 2MB', 'error');
        return;
    }

    showLoading(true);

    try {
        // Upload to Supabase Storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${currentUser.id}-${Date.now()}.${fileExt}`;
        const filePath = `profile-images/${fileName}`;

        const { data: uploadData, error: uploadError } = await _supabase.storage
            .from('user-uploads')
            .upload(filePath, file, {
                upsert: true
            });

        if (uploadError) throw uploadError;

        // Get public URL
        const { data: urlData } = _supabase.storage
            .from('user-uploads')
            .getPublicUrl(filePath);

        const imageUrl = urlData.publicUrl;

        // Update preview
        document.getElementById('profile-image-display').src = imageUrl;
        document.getElementById('profile-image-display').classList.remove('hidden');
        document.getElementById('profile-initials').classList.add('hidden');

        // Update current settings
        currentSettings.profile_image_url = imageUrl;

        showNotification('Image uploaded', 'Profile image uploaded successfully. Click "Save Profile Changes" to save.', 'success');

    } catch (error) {
        console.error('Error uploading image:', error);
        showNotification('Upload failed', error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Remove profile image
async function removeProfileImage() {
    document.getElementById('profile-image-display').classList.add('hidden');
    document.getElementById('profile-initials').classList.remove('hidden');

    const displayName = document.getElementById('display-name').value || currentUser.email.split('@')[0];
    document.getElementById('profile-initials').textContent = getInitials(displayName);

    currentSettings.profile_image_url = null;

    showNotification('Image removed', 'Profile image removed. Click "Save Profile Changes" to save.', 'info');
}

// Save profile settings
async function saveProfileSettings() {
    showLoading(true);

    try {
        const displayName = document.getElementById('display-name').value.trim();

        if (!displayName) {
            showNotification('Validation error', 'Display name cannot be empty', 'error');
            showLoading(false);
            return;
        }

        const { error } = await _supabase
            .from('user_settings')
            .update({
                display_name: displayName,
                profile_image_url: currentSettings.profile_image_url
            })
            .eq('user_id', currentUser.id);

        if (error) throw error;

        // Success - settings saved to user_settings table
        // Note: name_color is admin-only and cannot be changed by users
        showNotification('Success', 'Profile settings saved successfully!', 'success');

    } catch (error) {
        console.error('Error saving profile:', error);
        showNotification('Error', error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Save notification settings
async function saveNotificationSettings() {
    showLoading(true);

    try {
        const { error } = await _supabase
            .from('user_settings')
            .update({
                email_notifications: document.getElementById('email-notifications').checked,
                browser_notifications: document.getElementById('browser-notifications').checked,
                sound_notifications: document.getElementById('sound-notifications').checked,
                assignment_notifications: document.getElementById('assignment-notifications').checked
            })
            .eq('user_id', currentUser.id);

        if (error) throw error;

        // Request browser notification permission if enabled
        if (document.getElementById('browser-notifications').checked) {
            if (Notification.permission === 'default') {
                await Notification.requestPermission();
            }
        }

        showNotification('Success', 'Notification settings saved successfully!', 'success');

    } catch (error) {
        console.error('Error saving notifications:', error);
        showNotification('Error', error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Save preferences
async function savePreferences() {
    showLoading(true);

    try {
        const { error } = await _supabase
            .from('user_settings')
            .update({
                default_view: document.getElementById('default-view').value,
                timezone: document.getElementById('timezone').value,
                default_break_duration: parseInt(document.getElementById('default-break-duration').value),
                language: document.getElementById('language').value,
                show_online_status: document.getElementById('show-online-status').checked
            })
            .eq('user_id', currentUser.id);

        if (error) throw error;

        showNotification('Success', 'Preferences saved successfully!', 'success');

    } catch (error) {
        console.error('Error saving preferences:', error);
        showNotification('Error', error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Change password
async function changePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
        showNotification('Validation error', 'All password fields are required', 'error');
        return;
    }

    if (newPassword !== confirmPassword) {
        showNotification('Validation error', 'New passwords do not match', 'error');
        return;
    }

    if (newPassword.length < 6) {
        showNotification('Validation error', 'New password must be at least 6 characters', 'error');
        return;
    }

    showLoading(true);

    try {
        // Update password
        const { error } = await _supabase.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;

        // Clear fields
        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';

        showNotification('Success', 'Password changed successfully!', 'success');

    } catch (error) {
        console.error('Error changing password:', error);
        showNotification('Error', error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// Helper functions
function getInitials(name) {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length === 1) {
        return parts[0].substring(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (show) {
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

function showNotification(title, message, type) {
    const panel = document.getElementById('notification-panel');
    const notification = document.createElement('div');

    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        info: 'bg-blue-600',
        warning: 'bg-yellow-600'
    };

    notification.className = `${colors[type]} text-white p-4 rounded-lg shadow-lg fade-in`;
    notification.innerHTML = `
        <div class="flex items-start gap-3">
            <div class="flex-1">
                <p class="font-semibold">${title}</p>
                <p class="text-sm opacity-90">${message}</p>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" class="text-white hover:text-gray-200">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
            </button>
        </div>
    `;

    panel.appendChild(notification);

    // Auto remove after 5 seconds
    setTimeout(() => {
        notification.remove();
    }, 5000);
}
