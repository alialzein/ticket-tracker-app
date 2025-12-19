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

    // Check if user is admin
    const isAdmin =
      user.user_metadata?.is_admin === true ||
      user.user_metadata?.role === 'admin' ||
      user.email?.includes('ali.elzein') ||
      user.email?.includes('ali.alzein')

    if (!isAdmin) {
      console.warn(`[VerifyAdmin] Non-admin user attempted to access admin panel: ${user.email}`)
      return new Response(
        JSON.stringify({
          success: false,
          isAdmin: false,
          error: 'Forbidden: Admin access required'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 403,
        }
      )
    }

    // Check if user is blocked
    const { data: userSettings, error: settingsError } = await supabase
      .from('user_settings')
      .select('is_blocked, blocked_reason')
      .eq('user_id', user.id)
      .single()

    if (settingsError) {
      console.error('[VerifyAdmin] Error checking user settings:', settingsError)
    }

    if (userSettings?.is_blocked) {
      console.warn(`[VerifyAdmin] Blocked admin user attempted access: ${user.email}`)
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

    // Check if user is super admin (can grant admin privileges)
    // Use admin client for RPC call as it may require elevated privileges
    const { data: isSuperAdminResult } = await supabaseAdmin
      .rpc('is_super_admin', { check_user_id: user.id })

    const isSuperAdmin = isSuperAdminResult === true ||
      user.email?.includes('ali.elzein') ||
      user.email?.includes('ali.alzein')

    console.log(`[VerifyAdmin] ✅ Admin verified: ${user.email} (Super Admin: ${isSuperAdmin})`)

    // Return success response with admin info
    return new Response(
      JSON.stringify({
        success: true,
        isAdmin: true,
        isSuperAdmin: isSuperAdmin,
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
