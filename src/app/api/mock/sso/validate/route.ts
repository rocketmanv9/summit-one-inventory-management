/**
 * Mock SSO Ticket Validator
 * 
 * DEVELOPMENT ONLY - Simulates the Core SSO validation endpoint
 * Used to unblock development until Core exposes the real ticket validation API
 * 
 * In production, this will be replaced by calls to the actual Core API:
 * GET https://core.summit-one.app/api/auth/validate-sso-ticket?ticket={ticket}
 */

import { NextRequest, NextResponse } from 'next/server';

interface SSOTicketPayload {
  user_id: string;
  tenant_id: string;
  email?: string;
  role: 'authenticated' | 'admin';
}

/**
 * Mock validator: Accept any ticket string and return valid test data
 * 
 * In production, this will validate against Core's database.
 * The real Core endpoint will:
 * 1. Look up the ticket in its database
 * 2. Verify it hasn't expired
 * 3. Return the associated user/tenant info
 * 4. Mark the ticket as used (single-use)
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const ticket = searchParams.get('ticket');

    if (!ticket) {
      return NextResponse.json(
        { error: 'Missing ticket parameter' },
        { status: 400 }
      );
    }

    // MOCK: In development, accept any ticket
    // In production, validate against Core's ticket registry
    if (!ticket.startsWith('ticket_')) {
      console.warn(`[Mock SSO] Invalid ticket format: ${ticket}`);
      return NextResponse.json(
        { error: 'Invalid ticket format' },
        { status: 401 }
      );
    }

    // MOCK: Generate consistent test data
    // Extract tenant from ticket if present (format: ticket_tenant_<id>)
    // Otherwise use a default test tenant
    let tenantId = '11111111-1111-1111-1111-111111111111'; // Default test tenant
    let userId = '00000000-0000-0000-0000-000000000000'; // Default test user
    let email = 'test@summit-one.app';
    let role: 'authenticated' | 'admin' = 'authenticated';

    // Allow overrides via ticket query param for testing
    // Format: ticket_user=<uuid>&tenant=<uuid>&email=test@example.com&role=admin
    if (ticket.includes('admin')) {
      role = 'admin';
    }

    // Check if ticket contains encoded parameters
    if (ticket.includes('_')) {
      const parts = ticket.split('_');
      // ticket_<randomnoise>_<tenant?> format
      if (parts.length >= 3 && parts[2].length === 36) {
        try {
          tenantId = parts[2]; // Assume 3rd part is tenant UUID
        } catch {
          // Use default
        }
      }
    }

    // Return valid SSO payload
    const payload: SSOTicketPayload = {
      user_id: userId,
      tenant_id: tenantId,
      email,
      role
    };

    console.log('[Mock SSO] Validated ticket:', { ticket, payload });

    return NextResponse.json(payload);
  } catch (error) {
    console.error('[Mock SSO] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
