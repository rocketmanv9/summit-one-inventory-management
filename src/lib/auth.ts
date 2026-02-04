import { cookies, headers } from 'next/headers';

export interface AuthContext {
  userId: string;
  tenantId: string;
  userEmail?: string;
}

/**
 * Get the authentication context from cookies or headers
 * Returns null if not authenticated
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const headersList = await headers();
  const cookieStore = await cookies();

  const userId = headersList.get('x-user-id') || cookieStore.get('user_id')?.value;
  const tenantId = headersList.get('x-tenant-id') || cookieStore.get('tenant_id')?.value;
  const userEmail = cookieStore.get('user_email')?.value;

  if (!userId || !tenantId) {
    return null;
  }

  return { userId, tenantId, userEmail };
}

/**
 * Require authentication - throws error if not authenticated
 * Use this in API routes and server components
 */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuthContext();
  if (!auth) {
    throw new Error('Authentication required');
  }
  return auth;
}

/**
 * Get the current tenant ID - throws error if not authenticated
 * Use this when you only need the tenant ID
 */
export async function getCurrentTenantId(): Promise<string> {
  const auth = await requireAuth();
  return auth.tenantId;
}

/**
 * Get the current user ID - throws error if not authenticated
 * Use this when you only need the user ID
 */
export async function getCurrentUserId(): Promise<string> {
  const auth = await requireAuth();
  return auth.userId;
}

/**
 * Clear authentication cookies (for logout)
 */
export async function clearAuth(): Promise<void> {
  const cookieStore = await cookies();
  
  cookieStore.delete('user_id');
  cookieStore.delete('tenant_id');
  cookieStore.delete('user_email');
}
