import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';

export async function GET(request: NextRequest) {
  try {
    const tenantId = getTenantIdFromHeaders(request.headers);
    if (!tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createClient();
    
    const { data, error } = await supabase
      .from('widget_registry')
      .select('*')
      .eq('is_enabled', true)
      .order('domain')
      .order('name');

    if (error) {
      console.error('Error fetching widget registry:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in widget registry API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
