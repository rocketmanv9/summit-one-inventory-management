import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

// Force dynamic
export const dynamic = 'force-dynamic';

/**
 * GET /api/events/catalog
 * Returns event definitions catalog
 * 
 * SECURITY: Admin-only endpoint, production-gated
 * - Requires JWT authentication via createAuthenticatedClientOrThrow()
 * - Requires admin role from verified JWT claims
 * - Disabled in production (returns 404)
 */
export async function GET(request: NextRequest) {
  // PRODUCTION GATE: This endpoint should not exist in production
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEBUG_ROUTES !== 'true') {
    return NextResponse.json(
      { error: 'Not found' },
      { status: 404 }
    );
  }

  try {
    // SECURITY: Require JWT authentication
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { client: supabase, context } = auth;
    
    // SECURITY: Require admin role from verified JWT claims
    if (context.role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden - admin access required' },
        { status: 403 }
      );
    }

    // Get event definitions (using JWT-authenticated client with RLS)
    const { data: events, error } = await supabase
      .schema('public')
      .from('event_definitions')
      .select('*')
      .order('event_name', { ascending: true });

    if (error) {
      console.error('Error fetching event definitions:', error);
      return NextResponse.json(
        { error: error.message, details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      count: events?.length || 0,
      events: events || []
    });
  } catch (error) {
    console.error('Exception in event catalog route:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

