import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = createClient();
    const { id } = await params;
    const { status, dispute_reason } = await request.json();

    // Authentication check
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Update expense status
    const updateData: any = {
      status,
      updated_at: new Date().toISOString()
    };

    if (dispute_reason) {
      updateData.description = dispute_reason; // Store dispute reason in description
    }

    const { data, error } = await supabase
      .from('accounting_expenses')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Error updating expense:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data, success: true });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
