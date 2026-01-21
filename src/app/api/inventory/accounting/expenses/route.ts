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
      .from('accounting_expenses')
      .select(`
        *,
        vendors:vendor_id (id, name, code),
        purchase_orders:po_id (id, po_number, status)
      `)
      .order('expense_date', { ascending: false });

    // Apply filters
    const status = searchParams.get('status');
    if (status) {
      query = query.eq('status', status);
    }

    const vendorId = searchParams.get('vendor_id');
    if (vendorId) {
      query = query.eq('vendor_id', vendorId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching expenses:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
