// Supabase Edge Function: admin-set-password
// Allows super admins to set a password directly for any user
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Missing authorization header')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // Verify the requesting user is an admin
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: requestingUser }, error: authError } = await supabase.auth.getUser(token)

    if (authError || !requestingUser) throw new Error('Unauthorized')

    const isAdmin =
      requestingUser.user_metadata?.is_admin === true ||
      requestingUser.user_metadata?.role === 'admin' ||
      requestingUser.email?.includes('ali.elzein') ||
      requestingUser.email?.includes('ali.alzein')

    if (!isAdmin) throw new Error('Forbidden: Admin access required')

    const { targetUserId, newPassword } = await req.json()

    if (!targetUserId || !newPassword) {
      throw new Error('Missing required fields: targetUserId and newPassword')
    }

    if (newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters')
    }

    // Set the password directly via admin API
    const { data, error: updateError } = await supabase.auth.admin.updateUserById(
      targetUserId,
      { password: newPassword }
    )

    if (updateError) throw new Error(`Failed to set password: ${updateError.message}`)

    // Log the action
    const adminUsername = requestingUser.user_metadata?.display_name || requestingUser.email?.split('@')[0]
    await supabase.from('admin_audit_log').insert({
      admin_user_id: requestingUser.id,
      admin_username: adminUsername,
      action: 'password_set',
      target_user_id: targetUserId,
      details: { set_by: adminUsername }
    })

    return new Response(
      JSON.stringify({ success: true, message: 'Password updated successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: error.message?.includes('Unauthorized') ? 401 :
                error.message?.includes('Forbidden') ? 403 : 500,
      }
    )
  }
})
