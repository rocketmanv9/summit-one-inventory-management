import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

/**
 * GET /api/inventory/rfid/tags
 * List all RFID tags for the tenant
 */
export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const asset_id = searchParams.get('asset_id');

    const supabase = createClient();

    let query = supabase
      .from('rfid_tags')
      .select(`
        *,
        asset:assets(id, asset_number, catalog_item_id, catalog_items(name))
      `)
      .eq('tenant_id', tenantId);

    if (status) {
      query = query.eq('status', status);
    }

    if (asset_id) {
      query = query.eq('asset_id', asset_id);
    }

    query = query.order('created_at', { ascending: false });

    const { data: tags, error } = await query;

    if (error) {
      console.error('Error fetching RFID tags:', error);
      return NextResponse.json(
        { error: 'Failed to fetch RFID tags', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: tags || [],
      meta: { count: tags?.length || 0 }
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
