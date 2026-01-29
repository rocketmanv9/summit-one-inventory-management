import { NextRequest, NextResponse } from 'next/server';
import { createUnscopedClient } from '@/lib/db-middleware';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('inventory_session');
    
    console.log('[/api/widgets] Session cookie exists:', !!sessionCookie);
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized - No session cookie' }, { status: 401 });
    }

    let session;
    try {
      session = JSON.parse(sessionCookie.value);
      console.log('[/api/widgets] Session parsed:', { tenantId: session.tenantId, userId: session.userId });
    } catch (e) {
      console.error('[/api/widgets] Failed to parse session:', e);
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    if (!session.tenantId) {
      console.error('[/api/widgets] No tenantId in session');
      return NextResponse.json({ error: 'No tenant in session' }, { status: 401 });
    }

    // Use service role to access widget_registry
    const supabase = createUnscopedClient();
    
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

