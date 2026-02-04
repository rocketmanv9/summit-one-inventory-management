/**
 * API Error Handler Utility
 * Provides consistent error handling across all API routes
 */

import { NextResponse } from 'next/server';

export function handleApiError(error: any): NextResponse {
  // Generic error handling
  const message = error?.message || String(error);
  console.error('[API Error]', message);
  
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
}

