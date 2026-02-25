import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { createAuthenticatedClient } from '@/supabase/client';
import { cookies } from 'next/headers';

/**
 * GET /api/search?q=...&limit=5
 *
 * Global cross-entity search. Tenant-scoped via RLS + JWT.
 * Returns grouped results: items, assets, locations, vendors, purchase_orders, reservations.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthContext();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const q = request.nextUrl.searchParams.get('q')?.trim();
    const limit = Math.min(Math.max(parseInt(request.nextUrl.searchParams.get('limit') || '5', 10) || 5, 1), 20);

    if (!q || q.length === 0) {
      return NextResponse.json({
        items: [], assets: [], locations: [], vendors: [], purchase_orders: [], reservations: [],
      });
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token')?.value;
    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    const supabase = createAuthenticatedClient(accessToken).schema('inventory' as any);
    const { data, error } = await (supabase as any).rpc('rpc_global_search', {
      p_query: q,
      p_limit: limit,
    });

    if (error) {
      console.error('[Search] RPC error:', error);
      return NextResponse.json({ error: 'Search failed' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[Search] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
