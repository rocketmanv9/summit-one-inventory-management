/**
 * Session Manager
 * Handles server-side session storage and retrieval
 * Uses in-memory store for development; can be swapped for Redis
 */

import { SSOUser } from './ticket-validator';

export interface Session {
  id: string;
  user: SSOUser;
  createdAt: number;
  expiresAt: number;
}

// In-memory session store (suitable for dev, use Redis in production)
const sessionStore = new Map<string, Session>();

const SESSION_DURATION = 3600 * 1000; // 1 hour in milliseconds

/**
 * Create a new session from authenticated user data
 */
export function createSession(user: SSOUser): Session {
  const sessionId = generateSessionId();
  const now = Date.now();
  
  const session: Session = {
    id: sessionId,
    user,
    createdAt: now,
    expiresAt: now + SESSION_DURATION
  };

  sessionStore.set(sessionId, session);

  // Schedule cleanup on expiry
  setTimeout(() => {
    sessionStore.delete(sessionId);
  }, SESSION_DURATION);

  return session;
}

/**
 * Retrieve session by ID
 */
export function getSession(sessionId: string): Session | null {
  const session = sessionStore.get(sessionId);

  if (!session) {
    return null;
  }

  // Check expiry
  if (session.expiresAt < Date.now()) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session;
}

/**
 * Extend session expiry (called on each request)
 */
export function extendSession(sessionId: string): boolean {
  const session = sessionStore.get(sessionId);

  if (!session) {
    return false;
  }

  // Check if already expired
  if (session.expiresAt < Date.now()) {
    sessionStore.delete(sessionId);
    return false;
  }

  // Extend expiry by sliding window
  session.expiresAt = Date.now() + SESSION_DURATION;
  return true;
}

/**
 * Invalidate session (logout)
 */
export function invalidateSession(sessionId: string): boolean {
  return sessionStore.delete(sessionId);
}

/**
 * Invalidate all sessions for a user (revocation across all devices)
 */
export function invalidateUserSessions(userId: string): number {
  let count = 0;

  for (const [sessionId, session] of sessionStore.entries()) {
    if (session.user.id === userId) {
      sessionStore.delete(sessionId);
      count++;
    }
  }

  return count;
}

/**
 * Get session count for monitoring
 */
export function getSessionCount(): number {
  return sessionStore.size;
}

/**
 * Generate a secure session ID
 */
function generateSessionId(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}
