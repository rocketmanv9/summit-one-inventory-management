/**
 * Check if a valid dev session exists
 */

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

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

