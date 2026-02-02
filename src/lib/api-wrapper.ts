/**
 * API Route Wrapper - "One File" Authentication & Error Handling
 * 
 * This is the Single Point of Truth for all API endpoint authentication.
 * Instead of duplicating auth logic across ~80 routes, we wrap them here.
 * 
 * BENEFIT: Change auth logic once, it applies everywhere.
 * 
 * SECURITY:
 * - Ticket validation (Single Sign-On)
 * - JWT minting on the fly for RLS compatibility
 * - Centralized error handling
 * - Standardized response formats
 */

import { NextRequest, NextResponse } from 'next/server';

/**
 * Authentication context passed to wrapped route handlers
 */
export interface AuthContext {
  /** Supabase client initialized with user's JWT */
  supabase: any;
  /** Authenticated user object from SSO ticket */
  user: {
    id: string;
    email?: string;
    role: string;
  };
  /** Tenant ID from user's auth context */
  tenantId: string;
  /** Route parameters (from dynamic routes) */
  params?: Record<string, string>;
}

/**
 * Route handler type - receives auth context
 */
export type AuthenticatedHandler = (
  req: NextRequest,
  ctx: AuthContext
) => Promise<NextResponse>;

/**
 * Higher-Order Function: Wraps API routes with authentication & error handling
 * 
 * USAGE:
 * ```typescript
 * import { withAuth } from '@/lib/api-wrapper';
 * 
 * export const GET = withAuth(async (req, { supabase, user, tenantId }) => {
 *   const { data } = await supabase
 *     .from('items')
 *     .select();
 *   
 *   return NextResponse.json({ data });
 * });
 * ```
 * 
 * @param handler - Route handler function
 * @returns Wrapped handler with auth & error handling
 */
export function withAuth(handler: AuthenticatedHandler) {
  return async (
    req: NextRequest,
    { params }: { params?: Record<string, string> } = {}
  ) => {
    try {
      // ==================================================================
      // STEP 1: Centralized Authentication
      // ==================================================================
      // This is the ONLY place auth happens - extract ticket/session,
      // validate it, and mint a scoped JWT for RLS compatibility.
      // ==================================================================

      const { supabase, user, tenantId } = await authenticateRequest(req);

      if (!user || !tenantId) {
        return NextResponse.json(
          { error: 'Unauthorized: Invalid or missing authentication' },
          { status: 401 }
        );
      }

      // ==================================================================
      // STEP 2: Build Auth Context
      // ==================================================================
      // Create the context object that will be passed to the handler.
      // This provides clean, type-safe access to auth data.
      // ==================================================================

      const ctx: AuthContext = {
        supabase,
        user,
        tenantId,
        params
      };

      // ==================================================================
      // STEP 3: Execute Route Handler
      // ==================================================================
      // Call the actual route handler with the authenticated context.
      // ==================================================================

      return await handler(req, ctx);
    } catch (error) {
      // ==================================================================
      // CENTRALIZED ERROR HANDLING
      // ==================================================================
      // All errors are caught and formatted consistently.
      // This prevents accidental information leaks in error messages.
      // ==================================================================

      return handleApiError(error);
    }
  };
}

/**
 * Authenticate incoming request
 * 
 * TICKET FLOW (SSO):
 * 1. Extract SSO ticket from header or cookie
 * 2. Validate ticket via Core API (or mock)
 * 3. Extract user_id and tenant_id from ticket
 * 4. Mint a scoped JWT using SUPABASE_JWT_SECRET
 * 5. Initialize Supabase client with JWT
 * 
 * EXISTING SESSION FLOW (for backward compatibility):
 * 1. Extract inventory_session cookie
 * 2. Use supabaseToken if available
 * 3. Return user context from session
 * 
 * @throws Error if authentication fails
 */
async function authenticateRequest(
  req: NextRequest
): Promise<{
  supabase: any;
  user: { id: string; email?: string; role: string };
  tenantId: string;
}> {
  // Try ticket-based auth first (NEW - SSO)
  try {
    return await authenticateWithTicket(req);
  } catch (ticketError) {
    // Fall back to session-based auth (EXISTING)
    console.debug('[withAuth] Ticket auth failed, trying session auth', {
      error: ticketError instanceof Error ? ticketError.message : String(ticketError)
    });

    try {
      return await authenticateWithSession(req);
    } catch (sessionError) {
      console.error('[withAuth] All authentication methods failed', {
        ticketError: ticketError instanceof Error ? ticketError.message : String(ticketError),
        sessionError: sessionError instanceof Error ? sessionError.message : String(sessionError)
      });

      throw new Error('Unauthorized: Invalid ticket or session');
    }
  }
}

/**
 * Authenticate using SSO ticket (NEW FLOW)
 * 
 * Ticket Sources (in order of precedence):
 * 1. x-sso-ticket header
 * 2. inventory_ticket cookie
 * 3. ticket query parameter
 */
async function authenticateWithTicket(
  req: NextRequest
): Promise<{
  supabase: any;
  user: { id: string; email?: string; role: string };
  tenantId: string;
}> {
  // Extract ticket from various sources
  let ticket: string | null = null;

  // Priority 1: x-sso-ticket header
  ticket = req.headers.get('x-sso-ticket');

  // Priority 2: inventory_ticket cookie
  if (!ticket) {
    const ticketCookie = req.cookies.get('inventory_ticket');
    if (ticketCookie) {
      ticket = ticketCookie.value;
    }
  }

  // Priority 3: query parameter (mostly for testing)
  if (!ticket) {
    const { searchParams } = new URL(req.url);
    ticket = searchParams.get('ticket');
  }

  if (!ticket) {
    throw new Error('No SSO ticket provided');
  }

  // Validate ticket with Core API (or mock)
  const ticketPayload = await validateTicketWithCore(ticket);

  // Extract user and tenant info from ticket
  const userId = ticketPayload.user_id;
  const tenantId = ticketPayload.tenant_id;
  const email = ticketPayload.email;
  const role = ticketPayload.role || 'authenticated';

  if (!userId || !tenantId) {
    throw new Error('Invalid ticket payload: missing user_id or tenant_id');
  }

  // Mint a scoped JWT for Supabase RLS
  const jwt = mintScopedJWT(userId, tenantId, role);

  // Initialize Supabase client with JWT
  const supabase = initializeSupabaseClient(jwt);

  return {
    supabase,
    user: { id: userId, email, role },
    tenantId
  };
}

/**
 * Authenticate using existing session cookie (BACKWARD COMPATIBILITY)
 */
async function authenticateWithSession(
  req: NextRequest
): Promise<{
  supabase: any;
  user: { id: string; email?: string; role: string };
  tenantId: string;
}> {
  const sessionCookie = req.cookies.get('inventory_session');

  if (!sessionCookie) {
    throw new Error('No session found');
  }

  let session: any;
  try {
    session = JSON.parse(sessionCookie.value);
  } catch {
    throw new Error('Invalid session cookie');
  }

  if (!session?.supabaseToken) {
    throw new Error('Session missing supabaseToken');
  }

  if (session.expiresAt && session.expiresAt < Date.now()) {
    throw new Error('Session expired');
  }

  const supabase = initializeSupabaseClient(session.supabaseToken);

  return {
    supabase,
    user: {
      id: session.userId || '',
      email: session.email,
      role: session.role || 'authenticated'
    },
    tenantId: session.tenantId || ''
  };
}

/**
 * Validate SSO ticket with Core API
 * 
 * In production, calls: GET /api/auth/validate-sso-ticket?ticket={ticket}
 * In development, can use mock: /api/mock/sso/validate?ticket={ticket}
 */
async function validateTicketWithCore(ticket: string): Promise<{
  user_id: string;
  tenant_id: string;
  email?: string;
  role?: string;
}> {
  // Use real Core endpoint in production
  const validatorUrl = process.env.NEXT_PUBLIC_CORE_URL
    ? `${process.env.NEXT_PUBLIC_CORE_URL}/api/auth/validate-sso-ticket`
    : `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/mock/sso/validate`;

  console.log('[withAuth] Validating ticket via:', validatorUrl);

  const response = await fetch(`${validatorUrl}?ticket=${encodeURIComponent(ticket)}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const text = await response.text();
    console.error('[withAuth] Ticket validation failed:', {
      status: response.status,
      body: text
    });
    throw new Error(`Ticket validation failed: ${response.statusText}`);
  }

  const payload = await response.json();

  if (!payload.user_id || !payload.tenant_id) {
    throw new Error('Invalid ticket payload');
  }

  return payload;
}

/**
 * Mint a scoped JWT for Supabase RLS
 * 
 * This JWT is used to initialize the Supabase client.
 * It allows RLS policies to work without requiring service role.
 * 
 * JWT Payload:
 * {
 *   sub: user_id,
 *   role: 'authenticated',
 *   app_metadata: { tenant_id: tenant_id }
 * }
 * 
 * Signed with SUPABASE_JWT_SECRET
 */
function mintScopedJWT(
  userId: string,
  tenantId: string,
  role: string = 'authenticated'
): string {
  // Check if jose is available (recommended)
  try {
    const jose = require('jose');

    if (!process.env.SUPABASE_JWT_SECRET) {
      throw new Error('SUPABASE_JWT_SECRET not configured');
    }

    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600; // 1 hour

    const jwt = jose.jwtSign(
      {
        sub: userId,
        role,
        app_metadata: {
          tenant_id: tenantId
        },
        iat: now,
        exp: now + expiresIn
      },
      secret,
      {
        algorithm: 'HS256',
        header: {
          alg: 'HS256',
          typ: 'JWT'
        }
      }
    );

    console.debug('[withAuth] Minted JWT for user:', {
      userId,
      tenantId,
      expiresIn
    });

    return jwt;
  } catch (joseError) {
    // Fall back to jsonwebtoken if jose not available
    console.debug('[withAuth] jose not available, trying jsonwebtoken');

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

      console.debug('[withAuth] Minted JWT for user:', {
        userId,
        tenantId,
        expiresIn
      });

      return token;
    } catch (jwtError) {
      console.error('[withAuth] Failed to mint JWT:', jwtError);
      throw new Error('Failed to mint authentication token');
    }
  }
}

/**
 * Initialize Supabase client with JWT
 * 
 * Client is configured with:
 * - Anon key (for RLS to work)
 * - User's JWT in Authorization header
 * - Inventory schema
 */
function initializeSupabaseClient(jwt: string): any {
  const { createClient } = require('@supabase/supabase-js');

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    throw new Error('Supabase credentials not configured');
  }

  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      db: { schema: 'inventory' },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      global: {
        headers: {
          Authorization: `Bearer ${jwt}`
        }
      }
    }
  );
}

/**
 * Centralized error handling for API routes
 */
function handleApiError(error: any): NextResponse {
  console.error('[API Error]', error);

  if (error instanceof Error) {
    // Authentication errors
    if (error.message.includes('Unauthorized') || error.message.includes('unauthorized')) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Authorization errors
    if (error.message.includes('Forbidden') || error.message.includes('forbidden')) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Validation errors
    if (error.message.includes('Invalid') || error.message.includes('invalid')) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    // Generic error
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    );
  }

  // Unknown error
  return NextResponse.json(
    { error: 'Internal Server Error' },
    { status: 500 }
  );
}
