/**
 * Auth Utilities
 * High-level auth functions for use in API routes and middleware
 */

import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { 
  validateTicket, 
  extractTicket, 
  SSOUser 
} from './ticket-validator';
import { 
  createSession, 
  getSession, 
  extendSession, 
  invalidateSession 
} from './session';

const SESSION_COOKIE_NAME = 'inventory_session_id';
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 3600 // 1 hour
};

/**
 * Handle SSO ticket exchange and session creation
 * Call this in your SSO callback route (/api/auth/callback or similar)
 */
export async function handleSSOCallback(request: NextRequest): Promise<NextResponse> {
  const ticket = extractTicket(request);

  if (!ticket) {
    return NextResponse.json(
      { error: 'No SSO ticket provided' },
      { status: 400 }
    );
  }

  // Validate ticket with Core
  const validation = await validateTicket(ticket);

  if ('error' in validation) {
    return NextResponse.json(
      { error: validation.error.message },
      { status: 401 }
    );
  }

  // Create session
  const session = createSession(validation.user);

  // Set session cookie
  const response = NextResponse.json(
    { 
      success: true, 
      user: validation.user,
      sessionId: session.id 
    },
    { status: 200 }
  );

  response.cookies.set(SESSION_COOKIE_NAME, session.id, SESSION_COOKIE_OPTIONS);

  return response;
}

/**
 * Get authenticated user from session
 * Call this in API routes to get current user
 */
export async function getAuthUser(request: NextRequest): Promise<SSOUser | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!sessionId) {
    return null;
  }

  const session = getSession(sessionId);

  if (!session) {
    return null;
  }

  // Extend session on each request (sliding window)
  extendSession(sessionId);

  return session.user;
}

/**
 * Middleware: Protect routes that require authentication
 * Use in your middleware.ts or route handlers
 */
export async function requireAuth(request: NextRequest): Promise<NextResponse | null> {
  const user = await getAuthUser(request);

  if (!user) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    );
  }

  return null; // Authorization successful
}

/**
 * Logout: Invalidate session
 */
export async function handleLogout(request: NextRequest): Promise<NextResponse> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (sessionId) {
    invalidateSession(sessionId);
  }

  const response = NextResponse.json({ success: true }, { status: 200 });
  response.cookies.delete(SESSION_COOKIE_NAME);

  return response;
}

/**
 * Get session info (for debugging/admin)
 */
export async function getSessionInfo(request: NextRequest) {
  const user = await getAuthUser(request);

  if (!user) {
    return null;
  }

  return {
    user,
    authenticated: true
  };
}
