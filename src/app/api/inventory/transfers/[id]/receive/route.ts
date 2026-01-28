import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db-middleware';
import { getTenantIdFromHeaders, getUserIdFromHeaders } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  const userId = getUserIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { line_quantities } = body; // Expected: object like { "line_id_1": 5, "line_id_2": 3 }
    
    const supabase = createClient();

    // If partial quantities specified, use partial receive RPC
    if (line_quantities && typeof line_quantities === 'object' && Object.keys(line_quantities).length > 0) {
      // First, fetch the transfer to get line numbers for each line ID
      const { data: transfer, error: fetchError } = await supabase
        .from('transfers')
        .select('*, transfer_lines!inner(*)')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .single();

      if (fetchError || !transfer) {
        return NextResponse.json(
          { error: 'Transfer not found' },
          { status: 404 }
        );
      }

      // Convert line_quantities object { line_id: qty } to array format expected by RPC
      const lineQuantitiesArray = Object.entries(line_quantities)
        .map(([lineId, qty]) => {
          const line = transfer.transfer_lines.find((l: any) => l.id === lineId);
          if (!line) return null;
          return {
            line_number: line.line_number,
            qty_received: qty
          };
        })
        .filter(Boolean);

      if (lineQuantitiesArray.length === 0) {
        return NextResponse.json(
          { error: 'No valid line quantities provided' },
          { status: 400 }
        );
      }

      const { data, error } = await supabase.rpc('rpc_inv_transfer_receive_partial', {
        p_tenant_id: tenantId,
        p_transfer_id: id,
        p_received_by_user_id: userId,
        p_line_quantities: lineQuantitiesArray,
        p_last_event_id: `transfer-receive-partial-${id}-${Date.now()}`
      });

      if (error) {
        console.error('Error receiving transfer (partial):', error);
        return NextResponse.json(
          { error: error.message || 'Failed to receive transfer' },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, partial: true, data });
    }

    // Otherwise, full receive using original RPC
    const { data, error } = await supabase.rpc('rpc_inv_transfer_execute', {
      p_tenant_id: tenantId,
      p_transfer_id: id,
      p_received_by_user_id: userId,
      p_last_event_id: `transfer-receive-${id}-${Date.now()}`
    });

    if (error) {
      console.error('Error receiving transfer:', error);
      return NextResponse.json(
        { error: error.message || 'Failed to receive transfer' },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Transfer not found or not in valid status' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
