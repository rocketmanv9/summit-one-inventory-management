import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';

export async function GET(request: NextRequest) {
  try {
    const supabase = createClient();
    const { searchParams } = new URL(request.url);

    // Authentication check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Build query
    let query = supabase
      .from('stock_movements')
      .select(`
        *,
        catalog_items:catalog_item_id (id, sku, name),
        locations:location_id (id, code, name)
      `)
      .order('created_at', { ascending: false })
      .limit(200);

    // Apply filters
    const catalogItemId = searchParams.get('catalog_item_id');
    if (catalogItemId) {
      query = query.eq('catalog_item_id', catalogItemId);
    }

    const locationId = searchParams.get('location_id');
    if (locationId) {
      query = query.eq('location_id', locationId);
    }

    const movementType = searchParams.get('movement_type');
    if (movementType) {
      query = query.eq('movement_type', movementType);
    }

    const movementState = searchParams.get('movement_state');
    if (movementState) {
      query = query.eq('movement_state', movementState);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching movements:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
