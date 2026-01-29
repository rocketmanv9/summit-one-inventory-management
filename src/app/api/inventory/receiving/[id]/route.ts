/**
 * API: Receipt Detail
 * GET /api/inventory/receiving/[id]
 * Get detailed receipt information
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient, createClient } from '@/lib/db-middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase, tenantId } = await createUserClient(request);
    const { id } = await Promise.resolve(params);

    const { data, error } = await supabase
      .schema('supply_chain')
      .rpc('rpc_get_receipt_detail', {
        p_tenant_id: tenantId,
        p_receipt_id: id
      });

    if (error) {
      console.error('Error fetching receipt detail:', error);
      return NextResponse.json(
        { error: 'Failed to fetch receipt detail', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Error in receipt detail endpoint:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
