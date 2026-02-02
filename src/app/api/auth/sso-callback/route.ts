/**
 * SSO Callback Route
 * Receives ticket from Core and establishes session
 */

import { NextRequest, NextResponse } from 'next/server';
import { handleSSOCallback } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const response = await handleSSOCallback(request);

  // If successful, redirect to dashboard or desired page
  if (response.status === 200) {
    const targetService = new URL(request.url).searchParams.get('target_service') || 'dashboard';
    const redirectUrl = new URL(`/${targetService}`, request.url).toString();
    
    const redirectResponse = NextResponse.redirect(redirectUrl);
    
    // Copy the session cookie to redirect response
    const setCookieHeaders = response.headers.getSetCookie();
    setCookieHeaders.forEach(cookieHeader => {
      redirectResponse.headers.append('Set-Cookie', cookieHeader);
    });
    
    return redirectResponse;
  }

  return response;
}
