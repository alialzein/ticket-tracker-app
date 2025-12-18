// Supabase Edge Function: admin-delete-user
// This function handles user deletion with admin privileges
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface DeleteUserRequest {
  userId: string
  hardDelete?: boolean // true = permanent delete, false = soft delete
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
    const isRequestingUserAdmin =
      requestingUser.user_metadata?.is_admin === true ||
      requestingUser.user_metadata?.role === 'admin' ||
      requestingUser.email?.includes('ali.elzein') ||
      requestingUser.email?.includes('ali.alzein')

    if (!isRequestingUserAdmin) {
      throw new Error('Forbidden: Admin access required')
    }

    // Parse request body
    const body: DeleteUserRequest = await req.json()
    const { userId, hardDelete } = body

    if (!userId) {
      throw new Error('Missing userId')
    }

    // Get user info before deletion for audit log
    const { data: userToDelete } = await supabase
      .from('user_settings')
      .select('system_username, display_name')
      .eq('user_id', userId)
      .single()

    if (!userToDelete) {
      throw new Error('User not found')
    }

    if (hardDelete) {
      // HARD DELETE: Permanently remove user from auth.users
      // This will cascade to user_settings and team_members due to FK constraints
      // User-generated data (tickets, points, attendance) will remain but orphaned

      const { error: deleteError } = await supabase.auth.admin.deleteUser(userId)

      if (deleteError) {
        throw new Error(`Failed to delete user: ${deleteError.message}`)
      }

      // Log admin action
      await supabase
        .from('admin_audit_log')
        .insert({
          admin_user_id: requestingUser.id,
          admin_username: requestingUser.user_metadata?.display_name || requestingUser.email?.split('@')[0],
          action: 'user_deleted',
          target_user_id: userId,
          target_username: userToDelete.system_username,
          details: {
            delete_type: 'hard',
            display_name: userToDelete.display_name
          }
        })

      return new Response(
        JSON.stringify({
          success: true,
          message: 'User permanently deleted'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )

    } else {
      // SOFT DELETE: Mark user as deleted in user_settings
      // This requires adding an is_deleted column to user_settings

      const { error: softDeleteError } = await supabase
        .from('user_settings')
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_by: requestingUser.id
        })
        .eq('user_id', userId)

      if (softDeleteError) {
        throw new Error(`Failed to soft delete user: ${softDeleteError.message}`)
      }

      // Also disable auth account
      const { error: disableError } = await supabase.auth.admin.updateUserById(
        userId,
        {
          ban_duration: '876000h' // Ban for 100 years (effectively permanent)
        }
      )

      if (disableError) {
        console.error('Failed to disable user account:', disableError)
      }

      // Log admin action
      await supabase
        .from('admin_audit_log')
        .insert({
          admin_user_id: requestingUser.id,
          admin_username: requestingUser.user_metadata?.display_name || requestingUser.email?.split('@')[0],
          action: 'user_deleted',
          target_user_id: userId,
          target_username: userToDelete.system_username,
          details: {
            delete_type: 'soft',
            display_name: userToDelete.display_name
          }
        })

      return new Response(
        JSON.stringify({
          success: true,
          message: 'User marked as deleted'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

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
