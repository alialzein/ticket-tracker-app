// Supabase Edge Function: admin-create-user
// This function handles user creation with admin privileges
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface CreateUserRequest {
  email: string
  displayName?: string
  teamId?: string
  isAdmin?: boolean
  sendEmail?: boolean
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Verify requesting user is admin
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: requestingUser }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !requestingUser) {
      throw new Error('Unauthorized')
    }

    // Check if requesting user is admin
    const { data: userSettings } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', requestingUser.id)
      .single()

    const isRequestingUserAdmin =
      requestingUser.user_metadata?.is_admin === true ||
      requestingUser.user_metadata?.role === 'admin' ||
      requestingUser.email?.includes('ali.elzein') ||
      requestingUser.email?.includes('ali.alzein')

    if (!isRequestingUserAdmin) {
      throw new Error('Forbidden: Admin access required')
    }

    // Parse request body
    const body: CreateUserRequest = await req.json()
    const { email, displayName, teamId, isAdmin, sendEmail } = body

    // Validate email format
    if (!email || !email.endsWith('@b-pal.net')) {
      throw new Error('Invalid email format. Must be username@b-pal.net')
    }

    // Extract username from email
    const username = email.split('@')[0]
    const finalDisplayName = displayName || username

    // Create user in auth.users using admin API
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        is_admin: isAdmin || false,
        role: isAdmin ? 'admin' : 'user',
        display_name: finalDisplayName
      }
    })

    if (createError) {
      throw new Error(`Failed to create user: ${createError.message}`)
    }

    if (!newUser.user) {
      throw new Error('User creation failed')
    }

    // Create user_settings record
    const { error: settingsError } = await supabase
      .from('user_settings')
      .insert({
        user_id: newUser.user.id,
        system_username: username,
        display_name: finalDisplayName,
        theme_preference: 'dark',
        team_id: teamId || null
      })

    if (settingsError) {
      // Rollback: delete the user we just created
      await supabase.auth.admin.deleteUser(newUser.user.id)
      throw new Error(`Failed to create user settings: ${settingsError.message}`)
    }

    // Add to team_members if team specified
    if (teamId) {
      const { error: teamError } = await supabase
        .from('team_members')
        .insert({
          team_id: teamId,
          user_id: newUser.user.id,
          added_by: requestingUser.id
        })

      if (teamError) {
        console.error('Failed to add user to team:', teamError)
        // Don't rollback user creation, just log the error
      }
    }

    // Log admin action
    const { error: logError } = await supabase
      .from('admin_audit_log')
      .insert({
        admin_user_id: requestingUser.id,
        admin_username: requestingUser.user_metadata?.display_name || requestingUser.email?.split('@')[0],
        action: 'user_created',
        target_user_id: newUser.user.id,
        target_username: username,
        details: {
          email,
          display_name: finalDisplayName,
          team_id: teamId,
          is_admin: isAdmin
        }
      })

    if (logError) {
      console.error('Failed to log admin action:', logError)
    }

    // Send password reset email if requested
    if (sendEmail) {
      const { error: resetError } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email,
      })

      if (resetError) {
        console.error('Failed to send welcome email:', resetError)
      }
    }

    // Return success response
    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUser.user.id,
          email: newUser.user.email,
          display_name: finalDisplayName,
          username
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || 'Internal server error'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message?.includes('Unauthorized') ? 401 :
                error.message?.includes('Forbidden') ? 403 : 500,
      }
    )
  }
})
