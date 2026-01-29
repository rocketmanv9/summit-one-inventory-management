import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { supabase } = await createUserClient(request);
    const { id } = await params;
    const { po_id } = await request.json();

    // Call the RPC function to match expense to PO
    const { data, error } = await supabase.rpc('rpc_match_expense_to_po', {
      p_expense_id: id,
      p_po_id: po_id
    });

    if (error) {
      console.error('Error matching expense:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, success: true });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
