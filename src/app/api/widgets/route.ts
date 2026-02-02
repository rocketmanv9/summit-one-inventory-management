import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    // SECURITY: Use JWT + RLS instead of service role
    // Validates JWT signature and extracts tenant_id from app_metadata
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;
    
    const { client: supabase } = auth;
    
    // Query widget_registry with authenticated client
    // RLS will enforce tenant isolation if widget_registry has tenant_id column
    const { data, error } = await supabase
      .schema('public')
      .from('widget_registry')
      .select('*')
      .eq('is_enabled', true)
      .order('domain')
      .order('name');

    if (error) {
      console.error('[/api/widgets] Error fetching widget registry:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log('[/api/widgets] Fetched widgets count:', data?.length || 0);
    if (data && data.length > 0) {
      console.log('[/api/widgets] Sample widget:', data[0]);
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Error in widget registry API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

