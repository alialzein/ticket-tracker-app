import { log, logError } from './logger.js';
import { _supabase } from './config.js';

let currentUser = null;
let enrollingFactorId = null;
let enrollingChallengeId = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();
    setupEventListeners();
    await load2FAStatus();
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

// Setup event listeners
function setupEventListeners() {
    document.getElementById('logout-btn').addEventListener('click', async () => {
        await _supabase.auth.signOut();
        window.location.href = 'index.html';
    });

    document.getElementById('change-password-btn').addEventListener('click', changePassword);

    // 2FA buttons
    document.getElementById('tfa-enable-btn').addEventListener('click', startEnable2FA);
    document.getElementById('tfa-verify-btn').addEventListener('click', verify2FAEnrollment);
    document.getElementById('tfa-cancel-enroll-btn').addEventListener('click', cancelEnrollment);
    document.getElementById('tfa-disable-btn').addEventListener('click', disable2FA);

    // Auto-format OTP inputs (digits only)
    ['tfa-verify-code', 'tfa-disable-code'].forEach(id => {
        document.getElementById(id).addEventListener('input', (e) => {
            e.target.value = e.target.value.replace(/\D/g, '').slice(0, 6);
        });
        document.getElementById(id).addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (id === 'tfa-verify-code') verify2FAEnrollment();
                else disable2FA();
            }
        });
    });
}

// ─── 2FA ─────────────────────────────────────────────────────────────────────

async function load2FAStatus() {
    showLoading(true, 'Checking 2FA status...');
    try {
        const { data, error } = await _supabase.auth.mfa.listFactors();
        if (error) throw error;

        const totpFactors = data?.totp || [];
        const verified = totpFactors.find(f => f.status === 'verified');

        if (verified) {
            // 2FA is active
            setStatusUI(true);
        } else {
            // 2FA not set up
            setStatusUI(false);
        }
    } catch (err) {
        logError('Error loading 2FA status:', err);
        setStatusUI(false);
    } finally {
        showLoading(false);
    }
}

function setStatusUI(enabled) {
    const dot = document.getElementById('tfa-status-dot');
    const label = document.getElementById('tfa-status-label');
    const sub = document.getElementById('tfa-status-sub');
    const badge = document.getElementById('tfa-badge');
    const enableBtn = document.getElementById('tfa-enable-btn');
    const disableSection = document.getElementById('tfa-disable-section');
    const enrollSteps = document.getElementById('tfa-enroll-steps');

    if (enabled) {
        dot.className = 'w-3 h-3 rounded-full bg-green-500';
        label.textContent = '2FA is enabled';
        sub.textContent = 'Your account is protected with an authenticator app.';
        badge.className = 'text-xs px-3 py-1 rounded-full bg-green-700/60 text-green-300';
        badge.textContent = 'Active';
        enableBtn.classList.add('hidden');
        enrollSteps.classList.add('hidden');
        disableSection.classList.remove('hidden');
    } else {
        dot.className = 'w-3 h-3 rounded-full bg-gray-500';
        label.textContent = '2FA is not enabled';
        sub.textContent = 'Add an extra layer of security to your account.';
        badge.className = 'text-xs px-3 py-1 rounded-full bg-gray-600 text-gray-300';
        badge.textContent = 'Inactive';
        enableBtn.classList.remove('hidden');
        enrollSteps.classList.add('hidden');
        disableSection.classList.add('hidden');
    }
}

async function startEnable2FA() {
    showLoading(true, 'Setting up 2FA...');
    try {
        // Remove ALL existing unverified TOTP factors to avoid name collision
        const { data: existing } = await _supabase.auth.mfa.listFactors();
        const allFactors = existing?.totp || [];
        for (const f of allFactors) {
            if (f.status !== 'verified') {
                const { error: uErr } = await _supabase.auth.mfa.unenroll({ factorId: f.id });
                if (uErr) log('Could not unenroll factor', f.id, uErr.message);
            }
        }

        // Use a unique friendly name each time to avoid any residual collision
        const { data, error } = await _supabase.auth.mfa.enroll({
            factorType: 'totp',
            friendlyName: `TeamsOps-${Date.now()}`
        });
        if (error) throw error;

        enrollingFactorId = data.id;

        // Show QR code
        const qrUri = data.totp.qr_code;
        const secret = data.totp.secret;

        // Render QR code into div using local qrcodejs vendor
        const qrDiv = document.getElementById('tfa-qr-div');
        qrDiv.innerHTML = '';
        new QRCode(qrDiv, {
            text: qrUri,
            width: 200,
            height: 200,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });

        document.getElementById('tfa-secret-key').textContent = secret;

        // Show enrollment steps
        document.getElementById('tfa-enable-btn').classList.add('hidden');
        document.getElementById('tfa-enroll-steps').classList.remove('hidden');
        document.getElementById('tfa-verify-code').value = '';
        document.getElementById('tfa-verify-code').focus();

    } catch (err) {
        logError('Error starting 2FA enrollment:', err);
        showNotification('Error', err.message, 'error');
    } finally {
        showLoading(false);
    }
}

async function verify2FAEnrollment() {
    const code = document.getElementById('tfa-verify-code').value.trim();
    if (code.length !== 6) {
        showNotification('Invalid code', 'Please enter the 6-digit code from your authenticator app.', 'error');
        return;
    }

    showLoading(true, 'Verifying...');
    try {
        // Create challenge
        const { data: challengeData, error: challengeError } = await _supabase.auth.mfa.challenge({
            factorId: enrollingFactorId
        });
        if (challengeError) throw challengeError;

        // Verify
        const { data, error } = await _supabase.auth.mfa.verify({
            factorId: enrollingFactorId,
            challengeId: challengeData.id,
            code
        });
        if (error) throw error;

        showNotification('Success', '2FA has been enabled! Your account is now protected.', 'success');
        enrollingFactorId = null;
        await load2FAStatus();

    } catch (err) {
        logError('Error verifying 2FA enrollment:', err);
        showNotification('Verification failed', err.message || 'Invalid code. Please try again.', 'error');
    } finally {
        showLoading(false);
    }
}

function cancelEnrollment() {
    enrollingFactorId = null;
    document.getElementById('tfa-enroll-steps').classList.add('hidden');
    document.getElementById('tfa-enable-btn').classList.remove('hidden');
    document.getElementById('tfa-verify-code').value = '';
}

async function disable2FA() {
    const code = document.getElementById('tfa-disable-code').value.trim();
    if (code.length !== 6) {
        showNotification('Invalid code', 'Please enter the 6-digit code from your authenticator app.', 'error');
        return;
    }

    showLoading(true, 'Disabling 2FA...');
    try {
        // Get the active factor
        const { data: factorsData, error: listError } = await _supabase.auth.mfa.listFactors();
        if (listError) throw listError;

        const factor = (factorsData?.totp || []).find(f => f.status === 'verified');
        if (!factor) throw new Error('No active 2FA factor found.');

        // Verify the code first (elevate session to AAL2) before unenrolling
        const { data: challengeData, error: challengeError } = await _supabase.auth.mfa.challenge({
            factorId: factor.id
        });
        if (challengeError) throw challengeError;

        const { error: verifyError } = await _supabase.auth.mfa.verify({
            factorId: factor.id,
            challengeId: challengeData.id,
            code
        });
        if (verifyError) throw verifyError;

        // Now unenroll
        const { error: unenrollError } = await _supabase.auth.mfa.unenroll({ factorId: factor.id });
        if (unenrollError) throw unenrollError;

        document.getElementById('tfa-disable-code').value = '';
        showNotification('2FA disabled', 'Two-factor authentication has been removed from your account.', 'info');
        await load2FAStatus();

    } catch (err) {
        logError('Error disabling 2FA:', err);
        showNotification('Error', err.message || 'Failed to disable 2FA. Check your code and try again.', 'error');
    } finally {
        showLoading(false);
    }
}

// ─── Change Password ──────────────────────────────────────────────────────────

async function changePassword() {
    const currentPassword = document.getElementById('current-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

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

    showLoading(true, 'Changing password...');
    try {
        const { error } = await _supabase.auth.updateUser({ password: newPassword });
        if (error) throw error;

        document.getElementById('current-password').value = '';
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';

        showNotification('Success', 'Password changed successfully!', 'success');
    } catch (err) {
        logError('Error changing password:', err);
        showNotification('Error', err.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showLoading(show, text = 'Loading...') {
    const overlay = document.getElementById('loading-overlay');
    const textEl = document.getElementById('loading-text');
    if (textEl) textEl.textContent = text;
    overlay.classList.toggle('hidden', !show);
}

function showNotification(title, message, type) {
    const panel = document.getElementById('notification-panel');
    const notification = document.createElement('div');

    const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600', warning: 'bg-yellow-600' };
    notification.className = `${colors[type] || 'bg-gray-600'} text-white p-4 rounded-lg shadow-lg fade-in`;
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
    setTimeout(() => notification.remove(), 6000);
}
