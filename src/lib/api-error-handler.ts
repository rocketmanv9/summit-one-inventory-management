/**
 * API Error Handler Utility
 * Provides consistent error handling across all API routes
 * Converts authentication errors to 401 instead of generic 500s
 */

import { NextResponse } from 'next/server';
import { AuthenticationError, AuthorizationError } from './auth-errors';

export function handleApiError(error: any): NextResponse {
  // Handle authentication errors (401)
  if (error instanceof AuthenticationError) {
    console.warn('[API Auth] Authentication error:', error.message);
    return NextResponse.json(
      { error: 'Unauthorized - Please log in' },
      { status: 401 }
    );
  }
  
  // Handle authorization errors (403)
  if (error instanceof AuthorizationError) {
    console.warn('[API Auth] Authorization error:', error.message);
    return NextResponse.json(
      { error: 'Forbidden - Insufficient permissions' },
      { status: 403 }
    );
  }
  
  // Generic error handling
  const message = error?.message || String(error);
  console.error('[API Error]', message);
  
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
}

