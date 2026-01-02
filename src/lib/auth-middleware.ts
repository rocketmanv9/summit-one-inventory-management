/**
 * Auth middleware for Next.js API routes
 * Validates Supabase JWT and extracts claims
 */

import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export interface AuthContext {
  userId: string;          // sub from JWT
  tenantId: string;        // tenant_id from app_metadata
  role: string;            // role from app_metadata
  modules: string[];       // modules from app_metadata
  email?: string;
}

/**
 * Extract and validate JWT from request
 */
export async function validateJWT(request: NextRequest): Promise<AuthContext | null> {
  const authHeader = request.headers.get('authorization');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      console.error('JWT validation failed:', error);
      return null;
    }

    // Extract claims from user metadata
    const tenantId = user.app_metadata?.tenant_id;
    const role = user.app_metadata?.role || 'user';
    const modules = user.app_metadata?.modules || [];

    if (!tenantId) {
      console.error('JWT missing tenant_id in app_metadata');
      return null;
    }

    return {
      userId: user.id,
      tenantId,
      role,
      modules,
      email: user.email
    };
  } catch (error) {
    console.error('JWT validation error:', error);
    return null;
  }
}

/**
 * Middleware wrapper for API routes requiring authentication
 */
export function withAuth<T = any>(
  handler: (req: NextRequest, context: AuthContext) => Promise<NextResponse>
) {
  return async (req: NextRequest): Promise<NextResponse> => {
    const authContext = await validateJWT(req);

    if (!authContext) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Valid authentication required' },
        { status: 401 }
      );
    }

    return handler(req, authContext);
  };
}

/**
 * Middleware wrapper requiring specific role
 */
export function withRole<T = any>(
  requiredRole: string | string[],
  handler: (req: NextRequest, context: AuthContext) => Promise<NextResponse>
) {
  return withAuth(async (req, context) => {
    const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    
    if (!roles.includes(context.role)) {
      return NextResponse.json(
        { error: 'Forbidden', message: `Required role: ${roles.join(' or ')}` },
        { status: 403 }
      );
    }

    return handler(req, context);
  });
}

/**
 * Middleware wrapper requiring specific module access
 */
export function withModule<T = any>(
  requiredModule: string,
  handler: (req: NextRequest, context: AuthContext) => Promise<NextResponse>
) {
  return withAuth(async (req, context) => {
    if (!context.modules.includes(requiredModule) && context.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden', message: `Module access required: ${requiredModule}` },
        { status: 403 }
      );
    }

    return handler(req, context);
  });
}

/**
 * Create Supabase client with user's JWT for RLS
 */
export function createAuthenticatedClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  );
}

/**
 * Service-to-service JWT validation
 * For internal microservice calls
 */
export interface ServiceAuthContext {
  serviceId: string;
  tenantId?: string;
  scope: 'global' | 'tenant';
}

export async function validateServiceJWT(
  request: NextRequest
): Promise<ServiceAuthContext | null> {
  const authHeader = request.headers.get('x-service-auth');
  
  if (!authHeader) {
    return null;
  }

  // TODO: Implement service-to-service JWT validation
  // This would use a different secret (HS256) and validate service identity
  
  return null;
}
