/**
 * Asset Assignment History API
 * GET /api/inventory/assets/[id]/history - Get assignment history for an asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/lib/db-middleware';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: assetId } = await params;
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const supabase = createClient();

    const { data: history, error } = await supabase
      .schema('inventory')
      .from('asset_assignments')
      .select('*')
      .eq('asset_id', assetId)
      .order('assigned_at', { ascending: false });

    if (error) {
      console.error('Error fetching history:', error);
      return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
    }

    return NextResponse.json({ data: history || [] });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
