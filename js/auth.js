// js/auth.js

import { _supabase } from './config.js';
import { initializeApp, resetApp } from './main.js';
import { showNotification, openNewPasswordModal } from './ui.js';

export function initAuth() {
    _supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
            openNewPasswordModal();
        } else if (session) {
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
    errorP.textContent = "";

    try {
        const { error } = await _supabase.auth.signInWithPassword({ 
            email: emailInput.value, 
            password: passwordInput.value 
        });
        if (error) throw error;
    } catch (error) {
        console.error('Sign In Error:', error);
        errorP.textContent = error.message;
    }
}

export async function signUp() {
    const emailInput = document.getElementById('email-input');
    const passwordInput = document.getElementById('password-input');
    const errorP = document.getElementById('auth-error');
    const email = emailInput.value;
    const password = passwordInput.value;
    
    try {
        const { error } = await _supabase.auth.signUp({ 
            email, 
            password, 
            options: { data: { display_name: email.split('@')[0] } } 
        });
        if (error) throw error;
        errorP.style.color = 'rgb(74 222 128)';
        errorP.textContent = 'Success! Please check your email for a confirmation link.';
    } catch (error) {
        errorP.textContent = error.message;
    }
}

export async function signOut() {
    const { error } = await _supabase.auth.signOut();
    if (error) console.error('Sign Out Error:', error);
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

