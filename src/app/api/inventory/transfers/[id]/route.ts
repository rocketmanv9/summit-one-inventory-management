import { NextRequest, NextResponse } from 'next/server';
import { createUserClient, getIdempotencyKey } from '@/lib/db-middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await createUserClient(request);
    const { id } = await params;

    const { data: transfer, error } = await supabase
      .schema('inventory')
      .from('transfers')
      .select(`
        *,
        from_location:from_location_id (id, name, location_type),
        to_location:to_location_id (id, name, location_type),
        transfer_lines (
          *,
          catalog_items (id, name, sku)
        )
      `)
      .eq('id', id)
      .single();

    if (error || !transfer) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    return NextResponse.json({ data: transfer });
  } catch (error: any) {
    console.error('Error fetching transfer:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    const { id } = await params;
    
    // ENFORCE IDEMPOTENCY: Require Idempotency-Key header for transfer edits
    let idempotencyKey: string | null;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for transfer edits' },
        { status: 400 }
      );
    }

    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for transfer edits' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { from_location_id, to_location_id, notes, lines } = body;

    // Validate the transfer exists, belongs to this tenant, and is in draft status
    const { data: existingTransfer, error: fetchError } = await supabase
      .schema('inventory')
      .from('transfers')
      .select('id, status')
      .eq('id', id)
      .single();

    if (fetchError || !existingTransfer) {
      console.error('Transfer not found:', { id, tenantId, fetchError });
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    if (existingTransfer.status !== 'draft') {
      return NextResponse.json(
        { error: 'Only draft transfers can be edited' },
        { status: 400 }
      );
    }

    // Validate availability for all lines BEFORE updating
    if (lines && lines.length > 0) {
      for (const line of lines) {
        // First, get the tracking mode of the item
        const { data: item, error: itemError } = await supabase
          .schema('inventory')
          .from('catalog_items')
          .select('name, tracking_mode')
          .eq('id', line.catalog_item_id)
          .single();

        if (itemError || !item) {
          return NextResponse.json(
            { error: 'Catalog item not found' },
            { status: 400 }
          );
        }

        // Get location name for error messages
        const { data: location } = await supabase
          .schema('inventory')
          .from('locations')
          .select('name')
          .eq('id', from_location_id)
          .single();

        // Handle based on tracking mode
        if (item.tracking_mode === 'serialized') {
          // For serialized items: check assets
          const { data: assets, error: assetsError } = await supabase
            .schema('inventory')
            .from('assets')
            .select('id')
            .eq('catalog_item_id', line.catalog_item_id)
            .eq('location_id', from_location_id)
            .in('status', ['available', 'assigned']);

          if (assetsError || !assets || assets.length < line.qty) {
            return NextResponse.json(
              { 
                error: `Insufficient assets for item "${item.name}" at location "${location?.name || 'Unknown'}". Available: ${assets?.length || 0}, Requested: ${line.qty}` 
              },
              { status: 400 }
            );
          }
        } else {
          // For fungible/stock items: check stock balances
          const { data: stockBalance, error: stockError } = await supabase
            .schema('inventory')
            .from('stock_balances')
            .select('qty_on_hand')
            .eq('catalog_item_id', line.catalog_item_id)
            .eq('location_id', from_location_id)
            .single();

          if (stockError || !stockBalance) {
            return NextResponse.json(
              { 
                error: `Item "${item.name}" has no inventory at location "${location?.name || 'Unknown'}". Cannot transfer items that don't exist at the source location.` 
              },
              { status: 400 }
            );
          }

          if (stockBalance.qty_on_hand < line.qty) {
            return NextResponse.json(
              { 
                error: `Insufficient stock for item "${item.name}" at location "${location?.name || 'Unknown'}". Available: ${stockBalance.qty_on_hand}, Requested: ${line.qty}` 
              },
              { status: 400 }
            );
          }
        }
      }
    }

    // Update the transfer header
    const { error: updateError } = await supabase
      .schema('inventory')
      .from('transfers')
      .update({
        from_location_id,
        to_location_id,
        notes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (updateError) {
      console.error('Error updating transfer:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Delete existing lines
    const { error: deleteError } = await supabase
      .schema('inventory')
      .from('transfer_lines')
      .delete()
      .eq('transfer_id', id);

    if (deleteError) {
      console.error('Error deleting transfer lines:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    // Insert new lines
    if (lines && lines.length > 0) {
      const lineData = lines.map((line: any, index: number) => ({
        tenant_id: tenantId,
        transfer_id: id,
        catalog_item_id: line.catalog_item_id,
        qty: line.qty,
        line_number: index + 1,
        last_event_id: `${idempotencyKey}-line-${index + 1}`,
      }));

      const { error: linesError } = await supabase
        .schema('inventory')
        .from('transfer_lines')
        .insert(lineData);

      if (linesError) {
        console.error('Error creating transfer lines:', linesError);
        return NextResponse.json({ error: linesError.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating transfer:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
