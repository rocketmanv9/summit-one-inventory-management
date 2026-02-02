/**
 * Check if a valid dev session exists
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('inventory_session');
    
    if (!sessionCookie) {
      return NextResponse.json({ authenticated: false });
    }

    const session = JSON.parse(sessionCookie.value);
    
    // Check if session is expired
    if (session.expiresAt && Date.now() > session.expiresAt) {
      return NextResponse.json({ authenticated: false, reason: 'expired' });
    }

    if (!session.coreToken) {
      return NextResponse.json({ authenticated: false, reason: 'missing_core_token' });
    }

    if (!session.supabaseToken) {
      try {
        const coreApiUrl =
          process.env.CORE_API_URL_DEV ||
          process.env.NEXT_PUBLIC_CORE_URL ||
          'http://localhost:3000';

        const validateResponse = await fetch(`${coreApiUrl}/api/auth/validate-sso-token`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.coreToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ token: session.coreToken, env: 'dev' })
        });

        if (!validateResponse.ok) {
          return NextResponse.json({ authenticated: false, reason: 'core_token_invalid' });
        }

        const validatePayload = await validateResponse.json();
        const user = validatePayload.user || validatePayload;
        const userId = user.user_id || user.id || session.userId;
        const email = user.email || session.email;
        const tenantId =
          user?.tenant_id ||
          user?.tenantId ||
          user?.app_metadata?.active_tenant_id ||
          user?.app_metadata?.tenant_id ||
          session.tenantId;

        if (!email || !userId || !tenantId) {
          return NextResponse.json({ authenticated: false, reason: 'missing_user_data' });
        }

        const supabaseAdmin = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } }
        );

        const supabaseAnon = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          { auth: { autoRefreshToken: false, persistSession: false } }
        );

        const { data: existingUser } = await supabaseAdmin.auth.admin.getUserById(userId);

        if (!existingUser.user) {
          const { error: createError } = await supabaseAdmin.auth.admin.createUser({
            id: userId,
            email,
            email_confirm: true,
            app_metadata: {
              tenant_id: tenantId,
              role: user.role || user.app_metadata?.role || session.role || 'user'
            },
            user_metadata: {
              full_name: user.full_name || user.user_metadata?.full_name || session.fullName
            }
          });

          if (createError) {
            console.error('Failed to create Supabase user:', createError);
            return NextResponse.json({ authenticated: false, reason: 'user_creation_failed' });
          }
        } else {
          await supabaseAdmin.auth.admin.updateUserById(userId, {
            app_metadata: {
              tenant_id: tenantId,
              role: user.role || user.app_metadata?.role || session.role || 'user'
            },
            user_metadata: {
              full_name: user.full_name || user.user_metadata?.full_name || session.fullName
            }
          });
        }

        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: 'magiclink',
          email
        });

        if (linkError || !linkData) {
          console.error('Failed to generate magic link:', linkError);
          return NextResponse.json({ authenticated: false, reason: 'session_creation_failed' });
        }

        const emailOtp = (linkData as any).properties?.email_otp || (linkData as any).email_otp;
        if (!emailOtp) {
          return NextResponse.json({ authenticated: false, reason: 'session_creation_failed' });
        }

        const { data: verifyData, error: verifyError } = await supabaseAnon.auth.verifyOtp({
          email,
          token: emailOtp,
          type: 'magiclink'
        });

        if (verifyError || !verifyData?.session) {
          console.error('Failed to verify OTP for session:', verifyError);
          return NextResponse.json({ authenticated: false, reason: 'session_creation_failed' });
        }

        const refreshedSession = {
          ...session,
          userId,
          email,
          tenantId,
          role: user.role || user.app_metadata?.role || session.role || 'user',
          fullName: user.full_name || user.user_metadata?.full_name || session.fullName,
          supabaseToken: verifyData.session.access_token,
          refreshToken: verifyData.session.refresh_token,
          expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000)
        };

        cookieStore.set('inventory_session', JSON.stringify(refreshedSession), {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 7,
          path: '/'
        });

        return NextResponse.json({
          authenticated: true,
          session: {
            userId: refreshedSession.userId,
            email: refreshedSession.email,
            tenantId: refreshedSession.tenantId,
            role: refreshedSession.role,
            fullName: refreshedSession.fullName
          }
        });
      } catch (error) {
        console.error('Session upgrade error:', error);
        return NextResponse.json({ authenticated: false, reason: 'session_upgrade_failed' });
      }
    }

    return NextResponse.json({ 
      authenticated: true,
      session: {
        userId: session.userId,
        email: session.email,
        tenantId: session.tenantId,
        role: session.role,
        fullName: session.fullName
      }
    });
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json({ authenticated: false, reason: 'error' });
  }
}

