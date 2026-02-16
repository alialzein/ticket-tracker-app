// Supabase Edge Function: admin-update-user
// Updates auth.users metadata (display_name) for any user — super admin only
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

    const { targetUserId, displayName } = await req.json()

    if (!targetUserId || !displayName) {
      throw new Error('Missing required fields: targetUserId and displayName')
    }

    // Update the display_name in auth.users user_metadata
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      targetUserId,
      { user_metadata: { display_name: displayName } }
    )

    if (updateError) throw new Error(`Failed to update user metadata: ${updateError.message}`)

    return new Response(
      JSON.stringify({ success: true, message: 'User metadata updated successfully' }),
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
