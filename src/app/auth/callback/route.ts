import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

// Force dynamic rendering
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const coreToken = searchParams.get('core_token');
    const coreEnv = searchParams.get('core_env') || 'dev';
    const targetOrg = searchParams.get('target_org');
    
    console.log('SSO Callback received:', { coreEnv, targetOrg, hasToken: !!coreToken });
    
    if (!coreToken) {
      console.error('No token provided in callback');
      return NextResponse.redirect(new URL('/error?message=no_token', req.url));
    }
    
    const normalizedEnv = ['dev', 'development'].includes(coreEnv) ? 'dev'
      : ['stage', 'staging'].includes(coreEnv) ? 'stage'
      : ['prod', 'production'].includes(coreEnv) ? 'prod'
      : 'dev';

    const coreApiUrl =
      (normalizedEnv === 'dev' ? process.env.CORE_API_URL_DEV : undefined) ||
      (normalizedEnv === 'stage' ? process.env.CORE_API_URL_STAGE : undefined) ||
      (normalizedEnv === 'prod' ? process.env.CORE_API_URL_PROD : undefined) ||
      process.env.NEXT_PUBLIC_CORE_URL ||
      'http://localhost:3000';

    const validateResponse = await fetch(`${coreApiUrl}/api/auth/validate-sso-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${coreToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ token: coreToken, env: normalizedEnv })
    });

    if (!validateResponse.ok) {
      console.error('Core token validation failed:', validateResponse.status);
      return NextResponse.redirect(new URL('/error?message=invalid_token', req.url));
    }

    const validatePayload = await validateResponse.json();
    const user = validatePayload.user || validatePayload;

    const tenantId =
      user?.tenant_id ||
      user?.tenantId ||
      user?.app_metadata?.active_tenant_id ||
      user?.app_metadata?.tenant_id ||
      targetOrg;

    if (!tenantId || !user?.user_id && !user?.id) {
      console.error('Invalid Core validation payload:', validatePayload);
      return NextResponse.redirect(new URL('/error?message=invalid_token', req.url));
    }

    if (!user?.email) {
      console.error('Missing user email in Core validation payload:', validatePayload);
      return NextResponse.redirect(new URL('/error?message=missing_email', req.url));
    }

    // Create or sign in user to Supabase using service role
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const supabaseAnon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    const userId = user.user_id || user.id;
    
    // Check if user exists in Supabase auth
    const { data: existingUser } = await supabaseAdmin.auth.admin.getUserById(userId);
    
    if (!existingUser.user) {
      // Create user if they don't exist
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        id: userId,
        email: user.email,
        email_confirm: true,
        app_metadata: {
          tenant_id: tenantId,
          role: user.role || user.app_metadata?.role || 'user'
        },
        user_metadata: {
          full_name: user.full_name || user.user_metadata?.full_name
        }
      });
      
      if (createError) {
        console.error('Failed to create Supabase user:', createError);
        return NextResponse.redirect(new URL('/error?message=user_creation_failed', req.url));
      }
      
      console.log('Created new Supabase user:', newUser.user?.id);
    } else {
      // Update existing user's metadata
      await supabaseAdmin.auth.admin.updateUserById(userId, {
        app_metadata: {
          tenant_id: tenantId,
          role: user.role || user.app_metadata?.role || 'user'
        },
        user_metadata: {
          full_name: user.full_name || user.user_metadata?.full_name
        }
      });
    }

    // Generate a magic link (without sending email) and verify to create a session
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email
    });

    if (linkError || !linkData) {
      console.error('Failed to generate magic link:', linkError);
      return NextResponse.redirect(new URL('/error?message=session_creation_failed', req.url));
    }

    const emailOtp = (linkData as any).properties?.email_otp || (linkData as any).email_otp;

    if (!emailOtp) {
      console.error('Missing email OTP from magic link response:', linkData);
      return NextResponse.redirect(new URL('/error?message=session_creation_failed', req.url));
    }

    const { data: verifyData, error: verifyError } = await supabaseAnon.auth.verifyOtp({
      email: user.email,
      token: emailOtp,
      type: 'magiclink'
    });

    if (verifyError || !verifyData?.session) {
      console.error('Failed to verify OTP for session:', verifyError);
      return NextResponse.redirect(new URL('/error?message=session_creation_failed', req.url));
    }
    
    // Create local session with both Core token and Supabase token
    const session = {
      userId: userId,
      email: user.email,
      tenantId,
      tenantSlug: user.tenant_slug,
      role: user.role || user.app_metadata?.role,
      fullName: user.full_name || user.user_metadata?.full_name,
      coreToken,
      supabaseToken: verifyData.session.access_token,
      refreshToken: verifyData.session.refresh_token,
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days from now
    };
    
    console.log('Session created for tenant:', session.tenantId);
    
    // Store in HTTP-only cookie
    const cookieStore = await cookies();
    cookieStore.set('inventory_session', JSON.stringify(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    });
    
    // Redirect to dashboard
    return NextResponse.redirect(new URL('/dashboard', req.url));
  } catch (error) {
    console.error('SSO callback error:', error);
    return NextResponse.redirect(new URL('/error?message=invalid_token', req.url));
  }
}
