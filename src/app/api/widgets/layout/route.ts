import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function PATCH(request: NextRequest) {
  try {
    // ENFORCE IDEMPOTENCY (STRICT)
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for PATCH operations' },
        { status: 400 }
      );
    }
    
    // SECURITY: Use JWT + RLS instead of service role
    // Validates JWT signature and extracts tenant_id from app_metadata
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { client: supabase, context } = auth;
    const tenantId = context.tenantId;

    const body = await request.json();
    const { dashboardId, widgets } = body;

    if (!dashboardId) {
      return NextResponse.json({ error: 'Dashboard ID is required' }, { status: 400 });
    }

    if (!Array.isArray(widgets)) {
      return NextResponse.json({ error: 'Invalid request - widgets must be an array' }, { status: 400 });
    }

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
        .eq('tenant_id', tenantId)
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


