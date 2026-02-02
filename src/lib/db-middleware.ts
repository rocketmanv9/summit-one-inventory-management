/**
 * SECURE Database Middleware - Post Security Audit
 * 
 * CRITICAL SECURITY RULES:
 * - USER routes MUST use createUserClient() → JWT + RLS (NO service role)
 * - SERVICE role ONLY for: verified webhooks, pollers, machine endpoints after auth
 * - NEVER trust x-tenant-id/cookie for authorization in user routes
 * - Tenant context MUST come from server-verified JWT or membership lookup
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { AuthenticationError, AuthorizationError } from './auth-errors';

/**
 * @deprecated DELETED - DO NOT USE
 * This function has been removed for security reasons.
 * Use createUserClient() for USER routes or createServiceClientVerified() for webhooks.
 */
export function createClient(): never {
  throw new Error(
    '[SECURITY] createClient() has been removed. Use createUserClient() for user routes or createServiceClientVerified() for verified webhooks/machines.'
  );
}

// ============================================================================
// USER ROUTE AUTHENTICATION (JWT + RLS)
// ============================================================================

export interface AuthenticatedContext {
  userId: string;
  tenantId: string;
  role: string;
  email?: string;
  supabase: any;
}

/**
 * Create authenticated client for USER routes
 * 
 * TICKET-BASED FLOW (NEW - SSO):
 * 1. Extract SSO ticket from header or cookie
 * 2. Validate ticket with Core API (or mock)
 * 3. Mint a scoped JWT on the fly
 * 4. Initialize Supabase client with JWT
 * 
 * SESSION-BASED FLOW (LEGACY - for backward compatibility):
 * 1. Extract inventory_session cookie
 * 2. Use supabaseToken from session
 * 3. Return user context
 * 
 * SECURITY:
 * - Validates authentication via ticket or session
 * - Returns client bound to user's JWT
 * - RLS policies automatically enforce tenant isolation
 * - tenant_id comes from verified ticket or session
 * 
 * @throws Error if not authenticated or no valid session/ticket
 */
export async function createUserClient(request?: NextRequest): Promise<AuthenticatedContext> {
  // Try ticket-based auth first (NEW - SSO)
  if (request) {
    try {
      return await createUserClientFromTicket(request);
    } catch (ticketError) {
      console.debug('[createUserClient] Ticket auth failed, trying session auth', {
        error: ticketError instanceof Error ? ticketError.message : String(ticketError)
      });
      // Fall through to session-based auth
    }
  }

  // Fall back to session-based auth (LEGACY)
  return await createUserClientFromSession(request);
}

/**
 * Create authenticated client from SSO ticket (NEW)
 * 
 * Ticket sources (in order of precedence):
 * 1. x-sso-ticket header
 * 2. inventory_ticket cookie
 * 3. ticket query parameter
 */
async function createUserClientFromTicket(request: NextRequest): Promise<AuthenticatedContext> {
  // Extract ticket from various sources
  let ticket: string | null = null;

  // Priority 1: x-sso-ticket header
  ticket = request.headers.get('x-sso-ticket');

  // Priority 2: inventory_ticket cookie
  if (!ticket) {
    const ticketCookie = request.cookies.get('inventory_ticket');
    if (ticketCookie) {
      ticket = ticketCookie.value;
    }
  }

  // Priority 3: query parameter (mostly for testing)
  if (!ticket) {
    const { searchParams } = new URL(request.url);
    ticket = searchParams.get('ticket');
  }

  if (!ticket) {
    throw new AuthenticationError('No SSO ticket provided');
  }

  // Validate ticket with Core API (or mock)
  const ticketPayload = await validateTicketWithCore(ticket);

  const userId = ticketPayload.user_id;
  const tenantId = ticketPayload.tenant_id;
  const email = ticketPayload.email;
  const role = ticketPayload.role || 'authenticated';

  if (!userId || !tenantId) {
    throw new AuthenticationError('Invalid ticket: missing user_id or tenant_id');
  }

  // Mint a scoped JWT for Supabase RLS
  const jwt = await mintScopedJWT(userId, tenantId, role);

  // Initialize Supabase client with JWT
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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

  return {
    userId,
    tenantId,
    role,
    email,
    supabase
  };
}

/**
 * Create authenticated client from existing session (LEGACY)
 * 
 * This maintains backward compatibility with the old inventory_session cookie format.
 * New implementations should use ticket-based auth via createUserClientFromTicket.
 */
async function createUserClientFromSession(request?: NextRequest): Promise<AuthenticatedContext> {
  let token: string | null = null;
  let sessionFromCookie: {
    userId?: string;
    tenantId?: string;
    role?: string;
    email?: string;
    expiresAt?: number;
    coreToken?: string;
    supabaseToken?: string;
  } | null = null;
  
  // Try Authorization header first (Bearer token)
  if (request) {
    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }
  
  // Fall back to session cookie if no Authorization header
  if (!token) {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('inventory_session');

    if (!sessionCookie) {
      throw new AuthenticationError('Not authenticated - no valid session found');
    }

    try {
      sessionFromCookie = JSON.parse(sessionCookie.value);
    } catch (error) {
      throw new AuthenticationError('Invalid session cookie');
    }

    if (!sessionFromCookie) {
      throw new AuthenticationError('Invalid session cookie');
    }

    if (sessionFromCookie.expiresAt && sessionFromCookie.expiresAt < Date.now()) {
      throw new AuthenticationError('Session expired');
    }

    if (!sessionFromCookie.coreToken) {
      throw new AuthenticationError('Not authenticated - missing core token');
    }

    // Use Supabase token for database queries (not Core token)
    if (!sessionFromCookie.supabaseToken) {
      throw new AuthenticationError('Not authenticated - missing supabase token');
    }

    token = sessionFromCookie.supabaseToken;
  }
  
  // Create anon client to validate JWT
  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      db: { schema: 'inventory' },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );
  
  if (sessionFromCookie) {
    return {
      userId: sessionFromCookie.userId || '',
      tenantId: sessionFromCookie.tenantId || '',
      role: sessionFromCookie.role || 'user',
      email: sessionFromCookie.email,
      supabase
    };
  }

  // Get user from session when Authorization header is used
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    console.error('[Auth] Failed to validate token:', error);
    throw new AuthenticationError('Invalid authentication token');
  }

  // Get tenant_id from user's app_metadata (set during signup/invite)
  const tenantId = user.app_metadata?.tenant_id;
  const role = user.app_metadata?.role || 'user';

  if (!tenantId) {
    throw new AuthorizationError('User not associated with a tenant');
  }

  return {
    userId: user.id,
    tenantId,
    role,
    email: user.email,
    supabase
  };
}

/**
 * Validate SSO ticket with Core API
 * 
 * In production: GET https://core.summit-one.app/api/auth/validate-sso-ticket?ticket={ticket}
 * In development: GET http://localhost:3000/api/mock/sso/validate?ticket={ticket}
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

  console.log('[createUserClient] Validating ticket via:', validatorUrl);

  try {
    const response = await fetch(`${validatorUrl}?ticket=${encodeURIComponent(ticket)}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error('[createUserClient] Ticket validation failed:', {
        status: response.status,
        body: text
      });
      throw new AuthenticationError(`Ticket validation failed: ${response.statusText}`);
    }

    const payload = await response.json();

    if (!payload.user_id || !payload.tenant_id) {
      throw new AuthenticationError('Invalid ticket payload');
    }

    return payload;
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    throw new AuthenticationError(`Ticket validation error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Mint a scoped JWT for Supabase RLS
 * 
 * JWT is signed with SUPABASE_JWT_SECRET and includes:
 * - sub: user_id
 * - role: authenticated
 * - app_metadata: { tenant_id }
 * 
 * This allows Supabase RLS policies to work without service role.
 */
async function mintScopedJWT(userId: string, tenantId: string, role: string = 'authenticated'): Promise<string> {
  // Try using jose (recommended)
  try {
    // Dynamic import to avoid build-time errors if not installed
    const joseModule = require('jose');
    
    if (!process.env.SUPABASE_JWT_SECRET) {
      throw new Error('SUPABASE_JWT_SECRET not configured');
    }

    const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = 3600; // 1 hour

    // Try newer jose API first
    if (typeof joseModule.SignJWT === 'function') {
      try {
        const signedToken = await new joseModule.SignJWT({
          sub: userId,
          role,
          app_metadata: {
            tenant_id: tenantId
          }
        })
          .setProtectedHeader({ alg: 'HS256' })
          .setIssuedAt(now)
          .setExpirationTime(now + expiresIn)
          .sign(secret);

        console.debug('[Mint JWT] Minted JWT for user:', {
          userId,
          tenantId,
          expiresIn
        });

        return signedToken;
      } catch (signError) {
        console.debug('[Mint JWT] SignJWT failed, trying jwtSign:', signError);
        // Fall through to jwtSign
      }
    }

    // Fallback to older jose API
    if (typeof joseModule.jwtSign === 'function') {
      const jwt = joseModule.jwtSign(
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

      console.debug('[Mint JWT] Minted JWT for user:', {
        userId,
        tenantId,
        expiresIn
      });

      return jwt;
    }

    throw new Error('jose module does not have expected API');
  } catch (joseError) {
    // Fall back to jsonwebtoken
    console.debug('[Mint JWT] jose not available, trying jsonwebtoken');

    try {
      const jwtModule = require('jsonwebtoken');

      if (!process.env.SUPABASE_JWT_SECRET) {
        throw new Error('SUPABASE_JWT_SECRET not configured');
      }

      const now = Math.floor(Date.now() / 1000);
      const expiresIn = 3600; // 1 hour

      const token = jwtModule.sign(
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

      console.debug('[Mint JWT] Minted JWT for user:', {
        userId,
        tenantId,
        expiresIn
      });

      return token;
    } catch (jwtError) {
      console.error('[Mint JWT] Failed to mint JWT:', jwtError);
      throw new Error('Failed to mint authentication token');
    }
  }
}

/**
 * Extract idempotency key from request (STRICT - required for writes)
 * Supports both header and body formats
 * 
 * @throws Error if idempotency key is missing for write operations
 */
export async function getIdempotencyKey(request: NextRequest, method: string): Promise<string | null> {
  // Read-only operations don't need idempotency
  if (method === 'GET' || method === 'HEAD') {
    return null;
  }
  
  // Check for Idempotency-Key header (preferred)
  const headerKey = request.headers.get('idempotency-key');
  if (headerKey) {
    return headerKey;
  }
  
  // Check for last_event_id in request body (legacy support)
  try {
    const clonedRequest = request.clone();
    const body = await clonedRequest.json();
    if (body.last_event_id) {
      return body.last_event_id;
    }
  } catch {
    // Body may not be JSON or already consumed
  }
  
  // Write operations REQUIRE idempotency key
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    throw new Error('Idempotency-Key header or last_event_id in body required for write operations');
  }
  
  return null;
}

/**
 * Strict version of getIdempotencyKey that always throws for write operations
 * Use this for all write routes to enforce idempotency
 */
export async function requireIdempotencyKey(request: NextRequest): Promise<string> {
  const method = request.method;
  
  // Check for Idempotency-Key header (preferred)
  const headerKey = request.headers.get('idempotency-key');
  if (headerKey) {
    // Validate it's a valid UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(headerKey)) {
      return headerKey;
    }
    // Allow non-UUID format for backward compatibility (but warn)
    if (process.env.NODE_ENV === 'development') {
      console.warn('[Idempotency] Non-UUID idempotency key detected:', headerKey);
    }
    return headerKey;
  }
  
  // Check for last_event_id in request body (legacy support)
  try {
    const clonedRequest = request.clone();
    const body = await clonedRequest.json();
    if (body.last_event_id) {
      return body.last_event_id;
    }
  } catch {
    // Body may not be JSON
  }
  
  // Write operations REQUIRE idempotency key
  throw new Error('Idempotency-Key header or last_event_id in body required for write operations');
}

// ============================================================================
// SERVICE ROLE (Webhooks, Pollers, Machine Endpoints ONLY)
// ============================================================================

/**
 * Create service role client for VERIFIED webhook/poller/machine routes ONLY
 * 
 * SECURITY:
 * - ONLY use after verifying webhook signature, device credentials, or job identity
 * - tenant_id MUST be derived from verified source, NEVER from request headers
 * - Bypasses RLS - use with extreme caution
 * 
 * @param verifiedTenantId - Tenant ID from VERIFIED source (webhook payload, device record)
 */
export function createServiceClientVerified(verifiedTenantId: string) {
  if (!verifiedTenantId) {
    throw new Error('[SECURITY] verifiedTenantId required for service role client');
  }
  
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      db: { schema: 'inventory' },
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}

/**
 * Create an unscoped service role client (no default schema)
 * Use for cross-schema queries in webhooks/pollers ONLY
 */
export function createUnscopedServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  );
}

// ============================================================================
// DEPRECATED FUNCTIONS REMOVED FOR SECURITY
// ============================================================================
// The following functions have been removed:
// - getTenantIdFromHeaders() - Headers are not a secure auth source
// - getUserIdFromHeaders() - Headers are not a secure auth source  
// - getUserEmailFromHeaders() - Headers are not a secure auth source
// - getSessionFromCookie() - Use JWT-based createUserClient() instead
// - setDbTenantContext() - Replaced by JWT context from createUserClient()
// - setTenantContext() - Replaced by JWT context from createUserClient()
// - createTenantClient() - Replaced by createUserClient()
// - trackUserActivity() - Use database triggers instead
//
// All routes must use createUserClient() for user authentication.
// Machine/webhook routes must use createServiceClientVerified() with verified tenant_id.

/**
 * @deprecated Use createUnscopedServiceClient() instead
 */
export function createUnscopedClient() {
  return createUnscopedServiceClient();
}
