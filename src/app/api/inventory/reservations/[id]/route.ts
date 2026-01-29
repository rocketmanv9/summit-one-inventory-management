import { NextRequest, NextResponse } from 'next/server';
import { createUserClient, getIdempotencyKey } from '@/lib/db-middleware';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string | null;
    try {
      idempotencyKey = await getIdempotencyKey(request, 'DELETE');
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for DELETE operations' },
        { status: 400 }
      );
    }
    
    const { id } = await Promise.resolve(params);

    // Check if reservation exists and is in a deletable state
    const { data: reservation, error: fetchError } = await supabase
      .schema('inventory')
      .from('reservations')
      .select('status, qty, reservation_type, catalog_item_id, location_id, asset_id')
      .eq('id', id)
      .single();

    if (fetchError || !reservation) {
      return NextResponse.json({ error: 'Reservation not found' }, { status: 404 });
    }

    // Only allow deleting active reservations (not fulfilled ones)
    if (reservation.status === 'fulfilled') {
      return NextResponse.json(
        { error: 'Cannot delete fulfilled reservations' },
        { status: 400 }
      );
    }

    // If reservation is active, need to release the qty_reserved first
    if (reservation.status === 'active') {
      // For fungible reservations, update stock balance
      if (reservation.reservation_type === 'fungible' && reservation.catalog_item_id && reservation.location_id) {
        // Fetch current stock balance
        const { data: stockBalance, error: stockError } = await supabase
          .schema('inventory')
          .from('stock_balances')
          .select('qty_reserved')
          .eq('catalog_item_id', reservation.catalog_item_id)
          .eq('location_id', reservation.location_id)
          .single();

        if (stockError || !stockBalance) {
          return NextResponse.json(
            { error: 'Stock balance not found' },
            { status: 404 }
          );
        }

        // Update with calculated value
        await supabase
          .schema('inventory')
          .from('stock_balances')
          .update({
            qty_reserved: Math.max(0, stockBalance.qty_reserved - reservation.qty),
            updated_at: new Date().toISOString(),
          })
          .eq('catalog_item_id', reservation.catalog_item_id)
          .eq('location_id', reservation.location_id);
      }
      
      // For serialized reservations, update asset status back to available
      if (reservation.reservation_type === 'serialized' && reservation.asset_id) {
        await supabase
          .schema('inventory')
          .from('assets')
          .update({
            status: 'available',
            updated_at: new Date().toISOString(),
          })
          .eq('id', reservation.asset_id);
      }
    }

    // Delete the reservation
    const { error: deleteError } = await supabase
      .schema('inventory')
      .from('reservations')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting reservation:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting reservation:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
