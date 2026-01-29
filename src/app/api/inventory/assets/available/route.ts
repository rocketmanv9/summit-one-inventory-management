/**
 * Available Assets API
 * GET /api/inventory/assets/available - Get available assets for reservation
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    const { searchParams } = new URL(request.url);
    const catalogItemId = searchParams.get('catalog_item_id');
    const locationId = searchParams.get('location_id');
    const reservedFrom = searchParams.get('reserved_from');
    const reservedUntil = searchParams.get('reserved_until');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (!catalogItemId) {
      return NextResponse.json(
        { error: 'catalog_item_id is required' },
        { status: 400 }
      );
    }

    // Use the RPC function to find available assets
    const { data: assets, error } = await supabase.rpc('rpc_inv_find_available_assets', {
      p_tenant_id: tenantId,
      p_catalog_item_id: catalogItemId,
      p_location_id: locationId,
      p_reserved_from: reservedFrom,
      p_reserved_until: reservedUntil,
      p_limit: limit
    });

    if (error) {
      console.error('Error finding available assets:', error);
      return NextResponse.json(
        { error: 'Failed to fetch available assets' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: assets || [],
      meta: { tenantId, count: assets?.length || 0 }
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

