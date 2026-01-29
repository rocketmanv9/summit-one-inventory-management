import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

/**
 * GET /api/inventory/cycle-counts/[id]/lines/[line_id]/assets
 * Get expected and counted assets for a serialized item line
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; line_id: string }> }
) {
  try {
    const { supabase } = await createUserClient(request);
    const { id: cycleCountId, line_id: lineId } = await params;

    // Get the cycle count line to verify it's for a serialized item
    const { data: line, error: lineError } = await supabase
      .schema('inventory')
      .from('cycle_count_lines')
      .select('catalog_item_id, location_id, catalog_item:catalog_items(tracking_mode)')
      .eq('id', lineId)
      .eq('cycle_count_id', cycleCountId)
      .single();

    if (lineError || !line) {
      return NextResponse.json({ error: 'Cycle count line not found' }, { status: 404 });
    }

    // Get counted assets
    const { data: countedAssets, error: countedError } = await supabase
      .schema('inventory')
      .from('cycle_count_assets')
      .select(`
        id,
        asset_id,
        was_expected,
        was_found,
        asset:assets(id, asset_tag, serial_number, status)
      `)
      .eq('cycle_count_line_id', lineId);

    if (countedError) {
      console.error('Error fetching counted assets:', countedError);
      return NextResponse.json({ error: countedError.message }, { status: 500 });
    }

    // Get all assets that should be at this location (expected)
    const { data: expectedAssets, error: expectedError } = await supabase
      .schema('inventory')
      .from('assets')
      .select('id, asset_tag, serial_number, status')
      .eq('catalog_item_id', line.catalog_item_id)
      .eq('location_id', line.location_id)
      .in('status', ['available', 'assigned']);

    if (expectedError) {
      console.error('Error fetching expected assets:', expectedError);
      return NextResponse.json({ error: expectedError.message }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        expected_assets: expectedAssets || [],
        counted_assets: countedAssets || []
      }
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * POST /api/inventory/cycle-counts/[id]/lines/[line_id]/assets
 * Record which assets were found during the count
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; line_id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    const { id: cycleCountId, line_id: lineId } = await params;
    const body = await request.json();
    const { asset_ids } = body; // Array of asset IDs that were found

    if (!Array.isArray(asset_ids)) {
      return NextResponse.json({ error: 'asset_ids must be an array' }, { status: 400 });
    }

    // Get the cycle count line
    const { data: line, error: lineError } = await supabase
      .schema('inventory')
      .from('cycle_count_lines')
      .select('catalog_item_id, location_id')
      .eq('id', lineId)
      .eq('cycle_count_id', cycleCountId)
      .single();

    if (lineError || !line) {
      return NextResponse.json({ error: 'Cycle count line not found' }, { status: 404 });
    }

    // Get expected assets at this location
    const { data: expectedAssets } = await supabase
      .schema('inventory')
      .from('assets')
      .select('id')
      .eq('catalog_item_id', line.catalog_item_id)
      .eq('location_id', line.location_id)
      .in('status', ['available', 'assigned', 'in_use']);

    const expectedAssetIds = new Set(expectedAssets?.map((a: any) => a.id) || []);

    // Delete existing counted assets for this line
    await supabase
      .schema('inventory')
      .from('cycle_count_assets')
      .delete()
      .eq('cycle_count_line_id', lineId);

    // Insert new counted assets
    if (asset_ids.length > 0) {
      const countedAssets = asset_ids.map(assetId => ({
        cycle_count_line_id: lineId,
        asset_id: assetId,
        was_expected: expectedAssetIds.has(assetId),
        was_found: true
      }));

      const { error: insertError } = await supabase
        .schema('inventory')
        .from('cycle_count_assets')
        .insert(countedAssets);

      if (insertError) {
        console.error('Error inserting counted assets:', insertError);
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }

    // Update the cycle count line qty_counted to match number of assets found
    const { error: updateError } = await supabase
      .schema('inventory')
      .from('cycle_count_lines')
      .update({
        qty_counted: asset_ids.length,
        updated_at: new Date().toISOString()
      })
      .eq('id', lineId)
      .eq('tenant_id', tenantId);

    if (updateError) {
      console.error('Error updating cycle count line:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        success: true,
        counted: asset_ids.length,
        expected: expectedAssetIds.size
      }
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
