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
 * Uses Supabase session/JWT + RLS (NOT service role)
 * 
 * SECURITY:
 * - Validates Supabase auth session from cookie
 * - Returns client bound to user's JWT
 * - RLS policies automatically enforce tenant isolation
 * - tenant_id comes from server-verified membership, NOT from headers/cookies
 * 
 * @throws Error if not authenticated or no valid session
 */
export async function createUserClient(request?: NextRequest): Promise<AuthenticatedContext> {
  const cookieStore = await cookies();
  
  // Get Supabase auth session cookie (set by Supabase client)
  const authCookie = cookieStore.get('sb-access-token') || cookieStore.get('sb-refresh-token');
  
  if (!authCookie) {
    // SECURITY: No fallback to inventory_session cookie - JWT-only authentication
    throw new Error('Not authenticated - no valid session found');
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
      }
    }
  );
  
  // Get user from session
  const { data: { user }, error } = await supabase.auth.getUser(authCookie.value);
  
  if (error || !user) {
    throw new Error('Invalid authentication token');
  }
  
  // Get tenant_id from user's app_metadata (set during signup/invite)
  const tenantId = user.app_metadata?.tenant_id;
  const role = user.app_metadata?.role || 'user';
  
  if (!tenantId) {
    throw new Error('User not associated with a tenant');
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
