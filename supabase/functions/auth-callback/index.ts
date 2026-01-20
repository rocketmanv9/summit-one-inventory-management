// ================================================================
// Auth Callback Edge Function
// ================================================================
// Purpose: Exchange Core SSO token for Supabase session
// Route: /auth/callback?core_token=XXX&core_env=dev|production
// ================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

interface CoreUserPayload {
  id: string
  email: string
  tenant_id: string
  role: string
  full_name: string
}

Deno.serve(async (req) => {
  const url = new URL(req.url)
  const coreToken = url.searchParams.get('core_token')
  const coreEnv = url.searchParams.get('core_env') || 'dev'
  
  console.log('[AUTH-CALLBACK] Received auth callback', { coreEnv, hasToken: !!coreToken })
  
  if (!coreToken) {
    console.error('[AUTH-CALLBACK] Missing core_token parameter')
    return new Response('Missing core_token', { status: 400 })
  }
  
  // Determine Core API URL
  const coreUrl = coreEnv === 'production' 
    ? 'https://summit-one.app'
    : 'https://dev.summit-one.app'
    
  console.log('[AUTH-CALLBACK] Validating token with Core:', coreUrl)
  
  // Validate token with Core API
  try {
    const validateRes = await fetch(`${coreUrl}/api/auth/validate`, {
      headers: { 
        'Authorization': `Bearer ${coreToken}`,
        'Content-Type': 'application/json'
      }
    })
    
    if (!validateRes.ok) {
      const error = await validateRes.text()
      console.error('[AUTH-CALLBACK] Core validation failed:', validateRes.status, error)
      return new Response('Invalid or expired token', { status: 401 })
    }
    
    const user: CoreUserPayload = await validateRes.json()
    console.log('[AUTH-CALLBACK] User validated:', { email: user.email, tenant_id: user.tenant_id })
    
    // Create Supabase client with service role
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
    
    // Check if user exists, create if not
    const { data: existingUsers } = await supabase.auth.admin.listUsers()
    let userId = existingUsers?.users.find(u => u.email === user.email)?.id
    
    if (!userId) {
      console.log('[AUTH-CALLBACK] Creating new user:', user.email)
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: user.email,
        email_confirm: true,
        user_metadata: {
          tenant_id: user.tenant_id,
          role: user.role,
          full_name: user.full_name
        }
      })
      
      if (createError) {
        console.error('[AUTH-CALLBACK] Failed to create user:', createError)
        return new Response('Failed to create user session', { status: 500 })
      }
      
      userId = newUser.user.id
    } else {
      console.log('[AUTH-CALLBACK] User exists, updating metadata')
      // Update metadata for existing user
      await supabase.auth.admin.updateUserById(userId, {
        user_metadata: {
          tenant_id: user.tenant_id,
          role: user.role,
          full_name: user.full_name
        }
      })
    }
    
    // Generate access token
    const { data: sessionData, error: sessionError } = await supabase.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
      options: {
        redirectTo: `${url.origin}/dashboard`
      }
    })
    
    if (sessionError || !sessionData) {
      console.error('[AUTH-CALLBACK] Failed to generate session:', sessionError)
      return new Response('Failed to generate session', { status: 500 })
    }
    
    // Extract tokens from the magic link
    const linkUrl = new URL(sessionData.properties.action_link)
    const accessToken = linkUrl.searchParams.get('access_token')
    const refreshToken = linkUrl.searchParams.get('refresh_token')
    
    if (!accessToken) {
      console.error('[AUTH-CALLBACK] No access token in magic link')
      return new Response('Failed to generate access token', { status: 500 })
    }
    
    console.log('[AUTH-CALLBACK] Session created successfully, redirecting to dashboard')
    
    // Redirect to dashboard with tokens
    const redirectUrl = `${url.origin}/dashboard`
    
    return new Response(null, {
      status: 302,
      headers: {
        'Location': redirectUrl,
        'Set-Cookie': [
          `sb-access-token=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600`,
          `sb-refresh-token=${refreshToken}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`
        ].join(', ')
      }
    })
    
  } catch (error) {
    console.error('[AUTH-CALLBACK] Unexpected error:', error)
    return new Response('Internal server error', { status: 500 })
  }
})
