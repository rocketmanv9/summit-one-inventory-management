import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('inventory_session');
    
    if (!sessionCookie) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }
    
    try {
      const session = JSON.parse(sessionCookie.value);
      
      // Check if session is expired
      if (session.expiresAt && session.expiresAt < Date.now()) {
        // Delete expired cookie
        cookieStore.delete('inventory_session');
        return NextResponse.json(
          { error: 'Session expired' },
          { status: 401 }
        );
      }

      if (!session.coreToken) {
        return NextResponse.json(
          { error: 'Session missing core token' },
          { status: 401 }
        );
      }
      
      return NextResponse.json(session);
    } catch (error) {
      console.error('Failed to parse session:', error);
      return NextResponse.json(
        { error: 'Invalid session' },
        { status: 401 }
      );
    }
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    const cookieStore = await cookies();
    cookieStore.delete('inventory_session');
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

