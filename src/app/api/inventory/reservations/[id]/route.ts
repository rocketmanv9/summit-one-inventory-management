import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id } = await Promise.resolve(params);
    const supabase = createClient();

    // Check if reservation exists and is in a deletable state
    const { data: reservation, error: fetchError } = await supabase
      .schema('inventory')
      .from('reservations')
      .select('status, qty, reservation_type, catalog_item_id, location_id, asset_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
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
          .eq('tenant_id', tenantId)
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
          .eq('tenant_id', tenantId)
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
          .eq('id', reservation.asset_id)
          .eq('tenant_id', tenantId);
      }
    }

    // Delete the reservation
    const { error: deleteError } = await supabase
      .schema('inventory')
      .from('reservations')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId);

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
