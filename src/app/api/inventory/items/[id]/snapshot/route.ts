import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth';
import { createAuthenticatedClient } from '@/supabase/client';
import { cookies } from 'next/headers';

/**
 * GET /api/inventory/items/:id/snapshot
 *
 * Returns stock snapshot for a catalog item:
 * on_hand, reserved, available, inbound, per-location breakdown.
 * Tenant-scoped via RLS + JWT.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await getAuthContext();
    if (!auth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Item ID required' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token')?.value;
    if (!accessToken) {
      return NextResponse.json({ error: 'No access token' }, { status: 401 });
    }

    const supabase = createAuthenticatedClient(accessToken).schema('inventory' as any);
    const { data, error } = await (supabase as any).rpc('rpc_item_stock_snapshot', {
      p_catalog_item_id: id,
    });

    if (error) {
      console.error('[ItemSnapshot] RPC error:', error);
      if (error.message?.includes('not found')) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }
      return NextResponse.json({ error: 'Snapshot failed' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[ItemSnapshot] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
