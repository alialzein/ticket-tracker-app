import { log, logError, logWarn } from './logger.js';
// js/auth.js

import { _supabase } from './config.js';
import { initializeApp, resetApp } from './main.js';
import { showNotification, openNewPasswordModal } from './ui.js';

// Pending MFA state
let _pendingMfaFactorId = null;

export function initAuth() {
    _supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            openNewPasswordModal();
        } else if (session) {
            // initializeApp will check MFA internally and gate itself
            initializeApp(session);
        } else {
            resetApp();
        }
    });
}

export async function signIn() {
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    const errorP = document.getElementById('auth-error');
    errorP.textContent = '';

    try {
        const { data, error } = await _supabase.auth.signInWithPassword({
            email: emailInput.value,
            password: passwordInput.value
        });
        if (error) throw error;

        // Check if user is blocked
        if (data?.user) {
            const { data: userSettings, error: settingsError } = await _supabase
                .from('user_settings')
                .select('is_blocked, blocked_reason')
                .eq('user_id', data.user.id)
                .single();

            if (settingsError) {
                logError('Error checking user status:', settingsError);
            }

            if (userSettings?.is_blocked) {
                await _supabase.auth.signOut();
                errorP.style.color = 'rgb(248 113 113)';
                errorP.textContent = `Access denied: Your account has been blocked. Reason: ${userSettings.blocked_reason || 'Please contact your administrator.'}`;
                return;
            }
        }
        // MFA is handled inside initializeApp — nothing more to do here

    } catch (error) {
        logError('Sign In Error:', error);
        errorP.textContent = error.message;
    }
}

// Called from initializeApp when MFA is required
export function showMfaGate(factorId) {
    _pendingMfaFactorId = factorId;
    const authForm = document.getElementById('auth-form');
    const mfaForm = document.getElementById('mfa-form');
    if (!mfaForm) return;

    authForm.style.display = 'none';
    mfaForm.style.display = 'block';

    const input = document.getElementById('mfa-code-input');
    if (input) {
        input.value = '';
        input.focus();
    }
    const errorP = document.getElementById('mfa-error');
    if (errorP) errorP.textContent = '';
}

export function showLoginStep() {
    const authForm = document.getElementById('auth-form');
    const mfaForm = document.getElementById('mfa-form');
    if (authForm) authForm.style.display = '';
    if (mfaForm) mfaForm.style.display = 'none';
    _pendingMfaFactorId = null;
}

export async function completeMfaLogin() {
    const code = document.getElementById('mfa-code-input')?.value?.replace(/\D/g, '').trim();
    const errorP = document.getElementById('mfa-error');
    if (errorP) errorP.textContent = '';

    if (!code || code.length !== 6) {
        if (errorP) errorP.textContent = 'Please enter the 6-digit code from your authenticator app.';
        return;
    }
    if (!_pendingMfaFactorId) {
        if (errorP) errorP.textContent = 'Session expired. Please sign in again.';
        showLoginStep();
        return;
    }

    try {
        const { data: challengeData, error: challengeError } = await _supabase.auth.mfa.challenge({
            factorId: _pendingMfaFactorId
        });
        if (challengeError) throw challengeError;

        const { data, error } = await _supabase.auth.mfa.verify({
            factorId: _pendingMfaFactorId,
            challengeId: challengeData.id,
            code
        });
        if (error) throw error;

        // MFA passed — clear pending state, init app with skipMfaCheck
        _pendingMfaFactorId = null;
        const { data: { session } } = await _supabase.auth.getSession();
        if (session) {
            initializeApp(session, true);
        }

    } catch (err) {
        logError('MFA verification error:', err);
        if (errorP) errorP.textContent = err.message || 'Invalid code. Please try again.';
    }
}

export async function signUp() {
    const errorP = document.getElementById('auth-error');
    errorP.style.color = 'rgb(248 113 113)';
    errorP.textContent = 'Sign up is disabled. Please contact your administrator for access.';
}

export async function signOut() {
    const { error } = await _supabase.auth.signOut();
    if (error) logError('Sign Out Error:', error);
}

export async function setNewPassword() {
    const newPassword = document.getElementById('new-password-input').value;
    if (newPassword.length < 6) {
        return showNotification('Password Too Short', 'Your password must be at least 6 characters long.', 'error');
    }
    const { data, error } = await _supabase.auth.updateUser({ password: newPassword });
    if (error) {
        showNotification('Error', error.message, 'error');
    } else {
        showNotification('Success!', 'Your password has been updated successfully.', 'success');
        ui.closeNewPasswordModal();
    }
}
