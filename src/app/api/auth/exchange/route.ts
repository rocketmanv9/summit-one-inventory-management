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
 * Calls Core's ticket validation RPC to consume and validate the ticket
 */
async function validateTicketWithCore(ticket: string): Promise<{
  user_id: string;
  tenant_id: string;
  email?: string;
  role?: string;
} | null> {
  try {
    // Hash the ticket with the shared secret
    const ticketHash = await hashTicket(ticket);
    
    // Call Core's ticket validation endpoint
    const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
    const validationUrl = `${coreUrl}/api/auth/validate-ticket`;
    
    console.log('[Exchange] Validating ticket with Core:', {
      coreUrl,
      ticketPrefix: ticket.substring(0, 8) + '...'
    });

    const response = await fetch(validationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ticket_code: ticket,
        ticket_hash: ticketHash,
        target_service: 'inventory',
        ip: '127.0.0.1', // Get from request headers in production
        user_agent: 'inventory-service'
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[Exchange] Ticket validation failed:', {
        status: response.status,
        error: errorData
      });
      return null;
    }

    const data = await response.json();
    
    if (!data.user_id || !data.tenant_id) {
      console.error('[Exchange] Invalid response from Core:', data);
      return null;
    }

    console.log('[Exchange] Ticket validated successfully:', {
      userId: data.user_id,
      tenantId: data.tenant_id
    });

    return {
      user_id: data.user_id,
      tenant_id: data.tenant_id,
      email: data.email,
      role: data.role || 'authenticated'
    };
  } catch (error) {
    console.error('[Exchange] Ticket validation error:', error);
    return null;
  }
}

/**
 * Hash ticket using the shared SSO secret
 * Must match Core's hashing implementation
 */
async function hashTicket(code: string): Promise<string> {
  const secret = process.env.CORE_SSO_SECRET || 'gL5eMvCMU@9C9YpH';
  
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(code)
  );
  
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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
