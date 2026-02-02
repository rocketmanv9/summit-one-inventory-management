/**
 * Ticket-to-Session Exchange Endpoint
 * 
 * THE TRANSLATOR: Converts SSO Ticket → Supabase Session (JWT)
 * 
 * This is the ONLY API route needed for authentication.
 * Everything else is deleted and uses Supabase client directly on frontend.
 * 
 * WHY ONE ROUTE?
 * - Ticket is from Core SSO
 * - Frontend needs Supabase Session to talk to DB
 * - This endpoint translates between them
 * - Then frontend uses Supabase client directly (no API routes needed)
 * 
 * SECURITY:
 * - Validates ticket exists (mock for now, real validation when Core ready)
 * - Mints JWT with user_id and tenant_id in app_metadata
 * - JWT is signed with SUPABASE_JWT_SECRET
 * - RLS policies use tenant_id from JWT automatically
 */

import { NextRequest, NextResponse } from 'next/server';

interface ExchangeRequest {
  ticket: string;
}

interface ExchangeResponse {
  access_token: string;
  refresh_token: string;
  user?: {
    id: string;
    email?: string;
  };
}

/**
 * POST /api/auth/exchange
 * 
 * Exchange SSO ticket for Supabase session token
 * 
 * Request:
 * {
 *   "ticket": "ticket_dev_test_00000000"
 * }
 * 
 * Response (success):
 * {
 *   "access_token": "eyJhbGciOiJIUzI1NiIs...",
 *   "refresh_token": "dummy-refresh-token",
 *   "user": {
 *     "id": "00000000-0000-0000-0000-000000000000",
 *     "email": "user@example.com"
 *   }
 * }
 * 
 * Response (failure):
 * {
 *   "error": "Invalid ticket"
 * }
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // 1. Parse request
    const body = await request.json() as Partial<ExchangeRequest>;
    const { ticket } = body;

    if (!ticket) {
      return NextResponse.json(
        { error: 'Missing ticket' },
        { status: 400 }
      );
    }

    // 2. Validate ticket (mock for now, replace with Core API call)
    const ticketPayload = await validateTicketWithCore(ticket);

    if (!ticketPayload) {
      return NextResponse.json(
        { error: 'Invalid ticket' },
        { status: 401 }
      );
    }

    // 3. Extract user info from ticket
    const userId = ticketPayload.user_id;
    const tenantId = ticketPayload.tenant_id;
    const email = ticketPayload.email;
    const role = ticketPayload.role || 'authenticated';

    if (!userId || !tenantId) {
      return NextResponse.json(
        { error: 'Invalid ticket payload' },
        { status: 401 }
      );
    }

    // 4. Mint Supabase JWT (signed with SUPABASE_JWT_SECRET)
    const accessToken = mintSupabaseJWT(userId, tenantId, role);

    // 5. Return session to frontend
    const response: ExchangeResponse = {
      access_token: accessToken,
      refresh_token: 'dummy-refresh-token', // Supabase doesn't actually use this for JWT auth
      user: {
        id: userId,
        email
      }
    };

    console.log('[Exchange] Successfully exchanged ticket for session', {
      userId,
      tenantId,
      email
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Exchange] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Validate ticket with Core API
 * 
 * For now: Mock validation (any ticket starting with "ticket_" is valid)
 * When Core is ready: Call Core's /api/auth/validate-sso-ticket endpoint
 */
async function validateTicketWithCore(ticket: string): Promise<{
  user_id: string;
  tenant_id: string;
  email?: string;
  role?: string;
} | null> {
  // MOCK: In development, accept any ticket starting with "ticket_"
  if (!ticket.startsWith('ticket_')) {
    console.warn('[Exchange] Invalid ticket format:', ticket);
    return null;
  }

  // MOCK: Generate consistent test data
  // In production, this would query Core's database
  const mockUserId = '00000000-0000-0000-0000-000000000000';
  const mockTenantId = '11111111-1111-1111-1111-111111111111';
  const mockEmail = 'user@summit-one.app';
  const mockRole = 'authenticated';

  console.log('[Exchange] Using mock ticket validation:', {
    ticket,
    userId: mockUserId,
    tenantId: mockTenantId
  });

  return {
    user_id: mockUserId,
    tenant_id: mockTenantId,
    email: mockEmail,
    role: mockRole
  };

  // PRODUCTION: Uncomment this when Core API is ready
  /*
  const validatorUrl = `${process.env.NEXT_PUBLIC_CORE_URL}/api/auth/validate-sso-ticket`;
  
  try {
    const response = await fetch(`${validatorUrl}?ticket=${encodeURIComponent(ticket)}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
      console.error('[Exchange] Ticket validation failed:', response.statusText);
      return null;
    }

    const payload = await response.json();
    return payload;
  } catch (error) {
    console.error('[Exchange] Ticket validation error:', error);
    return null;
  }
  */
}

/**
 * Mint Supabase JWT
 * 
 * This is the key: Frontend uses this JWT to talk directly to Supabase.
 * Supabase RLS policies read tenant_id from app_metadata.
 * 
 * JWT Payload:
 * {
 *   "sub": "user_id",
 *   "role": "authenticated",
 *   "aud": "authenticated",
 *   "app_metadata": { "tenant_id": "tenant_id" },
 *   "iat": 1234567890,
 *   "exp": 1234571490
 * }
 */
function mintSupabaseJWT(
  userId: string,
  tenantId: string,
  role: string = 'authenticated'
): string {
  // Try using jsonwebtoken first (more common)
  try {
    const jwt = require('jsonwebtoken');

    if (!process.env.SUPABASE_JWT_SECRET) {
      throw new Error('SUPABASE_JWT_SECRET not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600; // 1 hour

    const token = jwt.sign(
      {
        sub: userId,
        role,
        aud: 'authenticated',
        app_metadata: {
          tenant_id: tenantId
        },
        iat: now,
        exp: now + expiresIn
      },
      process.env.SUPABASE_JWT_SECRET,
      {
        algorithm: 'HS256'
      }
    );

    console.debug('[Exchange] Minted JWT for user:', {
      userId,
      tenantId,
      expiresIn
    });

    return token;
  } catch (jwtError) {
    // Fall back to jose if jsonwebtoken not available
    console.debug('[Exchange] jsonwebtoken not available, trying jose');

    try {
      const joseModule = require('jose');

      if (!process.env.SUPABASE_JWT_SECRET) {
        throw new Error('SUPABASE_JWT_SECRET not configured');
      }

      const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = 3600; // 1 hour

      // Try newer jose API
      if (typeof joseModule.SignJWT === 'function') {
        // This is async and needs to be awaited, but we're in a sync function
        // For now, return synchronous implementation using jwtSign
        throw new Error('Use jsonwebtoken for sync JWT signing');
      }

      // Fallback to synchronous jwtSign
      const token = joseModule.jwtSign(
        {
          sub: userId,
          role,
          aud: 'authenticated',
          app_metadata: {
            tenant_id: tenantId
          },
          iat: now,
          exp: now + expiresIn
        },
        secret,
        {
          algorithm: 'HS256'
        }
      );

      console.debug('[Exchange] Minted JWT for user:', {
        userId,
        tenantId,
        expiresIn
      });

      return token;
    } catch (joseError) {
      console.error('[Exchange] Failed to mint JWT:', joseError);
      throw new Error('Failed to mint authentication token');
    }
  }
}
