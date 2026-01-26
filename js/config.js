// js/config.js

/**
 * Supabase Configuration
 * This file centralizes the Supabase URL and anonymous key.
 * It creates and exports a single Supabase client instance to be used throughout the application,
 * ensuring consistency and making it easy to update credentials in one place.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Replace with your actual Supabase project URL
const SUPABASE_URL = 'https://gdapxyyrvcwknjmcplna.supabase.co';

// Replace with your actual Supabase anonymous key
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkYXB4eXlydmN3a25qbWNwbG5hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTc1MTA0MzAsImV4cCI6MjA3MzA4NjQzMH0.Jla3hIjQuGLBBrsK-vyguEjC7RA0y4o10d8FULSeznc';

// Create and export the Supabase client
// We use localStorage for session persistence.
export const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        storage: localStorage
    }
});

// Export the URL for Edge Function calls
export const SUPABASE_URL_EXPORT = SUPABASE_URL;
