import { NextRequest, NextResponse } from 'next/server';
import { createUnscopedClient, getIdempotencyKey } from '@/lib/db-middleware';
import { cookies } from 'next/headers';

export async function PATCH(request: NextRequest) {
  try {
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string | null;
    try {
      idempotencyKey = await getIdempotencyKey(request, 'PATCH');
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for PATCH operations' },
        { status: 400 }
      );
    }
    
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('inventory_session');
    
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let session;
    try {
      session = JSON.parse(sessionCookie.value);
    } catch {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    if (!session.tenantId) {
      return NextResponse.json({ error: 'No tenant in session' }, { status: 401 });
    }

    const body = await request.json();
    const { dashboardId, widgets } = body;

    if (!dashboardId) {
      return NextResponse.json({ error: 'Dashboard ID is required' }, { status: 400 });
    }

    if (!Array.isArray(widgets)) {
      return NextResponse.json({ error: 'Invalid request - widgets must be an array' }, { status: 400 });
    }

    const supabase = createUnscopedClient();

    // Update each widget's layout individually
    for (const widget of widgets) {
      const { error } = await supabase
        .schema('public')
        .from('dashboard_widgets')
        .update({
          layout: widget.layout,
          updated_at: new Date().toISOString(),
        })
        .eq('id', widget.id)
        .eq('tenant_id', session.tenantId)
        .eq('dashboard_id', dashboardId);

      if (error) {
        console.error('Error saving widget layout:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in save layout API:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}


