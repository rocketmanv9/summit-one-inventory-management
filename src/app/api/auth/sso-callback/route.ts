/**
 * SSO Callback Route (Ticket-only)
 * Receives ticket from Core and redirects to client auth gate.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get('ticket');
  const targetService = url.searchParams.get('target_service') || 'dashboard';
  const targetOrg = url.searchParams.get('target_org');

  if (!ticket) {
    return NextResponse.json({ error: 'Missing ticket' }, { status: 400 });
  }

  const redirectUrl = new URL('/auth-gate', request.url);
  redirectUrl.searchParams.set('ticket', ticket);
  redirectUrl.searchParams.set('target_service', targetService);
  if (targetOrg) {
    redirectUrl.searchParams.set('target_org', targetOrg);
  }

  return NextResponse.redirect(redirectUrl);
}
