/**
 * Database middleware for setting tenant context
 * Sets session variables for RLS policies
 */

import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Create a Supabase client configured for inventory schema
 */
export function createClient() {
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

export interface SessionContext {
  tenantId: string;
  userId: string;
  role: string;
}

/**
 * Set tenant context for RLS policies
 * Call this before making any database queries
 */
export async function setTenantContext(context: SessionContext) {
  const supabase = createClient();
  
  try {
    const { error } = await supabase.rpc('set_session_context', {
      p_tenant_id: context.tenantId,
      p_user_id: context.userId,
      p_role: context.role,
    });
    
    if (error) {
      console.error('Failed to set tenant context:', error);
      throw error;
    }
  } catch (error) {
    console.error('Error setting tenant context:', error);
    throw error;
  }
}

/**
 * Create a Supabase client with tenant context already set
 */
export async function createTenantClient(context: SessionContext) {
  const client = createClient();
  
  // Set context
  await setTenantContext(context);
  
  return client;
}

/**
 * Get session from cookie (for API routes)
 */
export function getSessionFromCookie(cookieValue: string): SessionContext | null {
  try {
    const session = JSON.parse(cookieValue);
    return {
      tenantId: session.tenantId,
      userId: session.userId,
      role: session.role,
    };
  } catch (error) {
    console.error('Failed to parse session cookie:', error);
    return null;
  }
}

/**
 * Get tenant ID from request headers (set by middleware)
 * Use this in API routes to get tenant context
 */
export function getTenantIdFromHeaders(headers: Headers): string | null {
  return headers.get('x-tenant-id');
}

/**
 * Get user ID from request headers (set by middleware)
 */
export function getUserIdFromHeaders(headers: Headers): string | null {
  return headers.get('x-user-id');
}
