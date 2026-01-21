/**
 * Audit/Ledger API
 * GET /api/inventory/audit - Search stock movements and events
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') || 'movements'; // movements, events, or both
    const catalogItemId = searchParams.get('catalog_item_id');
    const locationId = searchParams.get('location_id');
    const movementType = searchParams.get('movement_type');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');

    const result: any = { movements: null, events: null };

    // Fetch stock movements
    if (type === 'movements' || type === 'both') {
      let movementQuery = supabase
        .from('stock_movements')
        .select(`
          *,
          catalog_items(id, name, sku),
          locations(id, name)
        `)
        .eq('tenant_id', tenantId);

      if (catalogItemId) {
        movementQuery = movementQuery.eq('catalog_item_id', catalogItemId);
      }
      if (locationId) {
        movementQuery = movementQuery.eq('location_id', locationId);
      }
      if (movementType) {
        movementQuery = movementQuery.eq('movement_type', movementType);
      }
      if (startDate) {
        movementQuery = movementQuery.gte('created_at', startDate);
      }
      if (endDate) {
        movementQuery = movementQuery.lte('created_at', endDate);
      }

      const { data: movements, error: movementsError } = await movementQuery
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (movementsError) {
        console.error('Error fetching movements:', movementsError);
      } else {
        result.movements = movements;
      }
    }

    // Fetch inventory events
    if (type === 'events' || type === 'both') {
      let eventsQuery = supabase
        .from('inventory_events')
        .select('*')
        .eq('tenant_id', tenantId);

      if (catalogItemId) {
        eventsQuery = eventsQuery.eq('catalog_item_id', catalogItemId);
      }
      if (locationId) {
        eventsQuery = eventsQuery.eq('location_id', locationId);
      }
      if (startDate) {
        eventsQuery = eventsQuery.gte('occurred_at', startDate);
      }
      if (endDate) {
        eventsQuery = eventsQuery.lte('occurred_at', endDate);
      }

      const { data: events, error: eventsError } = await eventsQuery
        .order('occurred_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (eventsError) {
        console.error('Error fetching events:', eventsError);
      } else {
        result.events = events;
      }
    }

    return NextResponse.json({
      data: result,
      meta: {
        tenantId,
        movementCount: result.movements?.length || 0,
        eventCount: result.events?.length || 0,
        limit,
        offset
      }
    });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
