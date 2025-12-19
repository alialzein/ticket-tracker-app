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
  isTeamLeader?: boolean
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

    // Check if requesting user is super admin (can grant admin privileges)
    const { data: isSuperAdminResult } = await supabase
      .rpc('is_super_admin', { check_user_id: requestingUser.id })

    const isRequestingUserSuperAdmin = isSuperAdminResult === true ||
      requestingUser.email?.includes('ali.elzein') ||
      requestingUser.email?.includes('ali.alzein')

    // Parse request body
    const body: CreateUserRequest = await req.json()
    const { email, displayName, teamId, isTeamLeader, sendEmail } = body

    // SECURITY: Only super admins can create team leaders
    // If a non-super-admin tries to set isTeamLeader=true, ignore it and set to false
    const actualIsTeamLeader = isTeamLeader && isRequestingUserSuperAdmin

    if (isTeamLeader && !isRequestingUserSuperAdmin) {
      console.warn(`User ${requestingUser.email} tried to create team leader but is not super admin`)
    }

    // Validate team leader must have a team
    if (actualIsTeamLeader && !teamId) {
      throw new Error('Team leaders must be assigned to a team')
    }

    // Validate email format (basic validation for any email)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email || !emailRegex.test(email)) {
      throw new Error('Invalid email format. Please provide a valid email address.')
    }

    // Extract username from email (everything before @)
    const username = email.split('@')[0]
    const finalDisplayName = displayName || username

    // Create user in auth.users using admin API
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        display_name: finalDisplayName,
        role: 'user'
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
        email: email,  // Store the actual email
        team_id: teamId || null,
        is_team_leader: actualIsTeamLeader,
        team_leader_for_team_id: actualIsTeamLeader ? teamId : null
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
          is_team_leader: actualIsTeamLeader
        }
      })

    if (logError) {
      console.error('Failed to log admin action:', logError)
    }

    // Generate password reset link for the new user
    let passwordResetLink = null
    if (sendEmail) {
      // Send password reset email
      const { data: linkData, error: resetError } = await supabase.auth.admin.generateLink({
        type: 'recovery',
        email,
      })

      if (resetError) {
        console.error('Failed to generate password reset link:', resetError)
      } else {
        passwordResetLink = linkData?.properties?.action_link
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
        },
        passwordResetLink: passwordResetLink || null,
        message: passwordResetLink
          ? 'User created successfully. Password reset link generated - share this with the user to set their password.'
          : 'User created successfully. No password reset link was generated.'
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
