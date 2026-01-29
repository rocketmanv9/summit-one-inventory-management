import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

/**
 * GET /api/inventory/cycle-counts/[id]/lines
 * Get all count lines for a cycle count
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await createUserClient(request);
    const { id: cycleCountId } = await params;

    const { data: lines, error } = await supabase
      .schema('inventory')
      .from('cycle_count_lines')
      .select(`
        *,
        catalog_item:catalog_items(id, name, sku, unit_of_measure, tracking_mode)
      `)
      .eq('cycle_count_id', cycleCountId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching count lines:', error);
      return NextResponse.json(
        { error: 'Failed to fetch count lines', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: lines || [],
      meta: { count: lines?.length || 0 }
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
