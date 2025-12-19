// Edge Function: verify-admin
// Purpose: Server-side verification of admin privileges
// This prevents users from bypassing client-side checks by directly accessing admin URLs

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    // Extract the JWT token from the Authorization header
    const token = authHeader.replace('Bearer ', '')

    // Create Supabase client with service role for admin operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // Create a client with the user's token for user-specific operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        global: {
          headers: { Authorization: authHeader },
        },
      }
    )

    // Get the authenticated user using their token
    const { data: { user }, error: userError } = await supabase.auth.getUser(token)

    if (userError || !user) {
      throw new Error('Not authenticated')
    }

    // Check if user is blocked first
    const { data: userSettings, error: settingsError } = await supabase
      .from('user_settings')
      .select('is_blocked, blocked_reason, is_team_leader, team_leader_for_team_id')
      .eq('user_id', user.id)
      .single()

    if (settingsError) {
      console.error('[VerifyAdmin] Error checking user settings:', settingsError)
    }

    if (userSettings?.is_blocked) {
      console.warn(`[VerifyAdmin] Blocked user attempted access: ${user.email}`)
      return new Response(
        JSON.stringify({
          success: false,
          isAdmin: false,
          isBlocked: true,
          error: `Access denied: Your account has been blocked. Reason: ${userSettings.blocked_reason || 'Please contact your administrator.'}`
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        }
      )
    }

    // Check if user is super admin (full access)
    const { data: isSuperAdminResult } = await supabaseAdmin
      .rpc('is_super_admin', { check_user_id: user.id })

    const isSuperAdmin = isSuperAdminResult === true ||
      user.email?.includes('ali.elzein') ||
      user.email?.includes('ali.alzein')

    // Check if user is team leader (limited access to their team only)
    const isTeamLeader = userSettings?.is_team_leader === true

    // User must be either super admin OR team leader to access admin panel
    if (!isSuperAdmin && !isTeamLeader) {
      console.warn(`[VerifyAdmin] Non-admin/non-team-leader user attempted to access admin panel: ${user.email}`)
      return new Response(
        JSON.stringify({
          success: false,
          isAdmin: false,
          error: 'Forbidden: You do not have permission to access the admin panel'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        }
      )
    }

    console.log(`[VerifyAdmin] ✅ Access granted: ${user.email} (Super Admin: ${isSuperAdmin}, Team Leader: ${isTeamLeader})`)

    // Return success response with role info
    return new Response(
      JSON.stringify({
        success: true,
        isAdmin: isSuperAdmin || isTeamLeader, // Both can access admin panel
        isSuperAdmin: isSuperAdmin,
        isTeamLeader: isTeamLeader,
        teamLeaderForTeamId: userSettings?.team_leader_for_team_id || null,
        user: {
          id: user.id,
          email: user.email,
          display_name: user.user_metadata?.display_name
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('[VerifyAdmin] Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        isAdmin: false,
        error: error.message
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      }
    )
  }
})
