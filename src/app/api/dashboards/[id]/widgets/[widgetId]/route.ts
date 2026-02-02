import { NextRequest, NextResponse } from 'next/server';
import { createUnscopedClient, getIdempotencyKey } from '@/lib/db-middleware';
import { cookies } from 'next/headers';

async function getSessionData() {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get('inventory_session');
  
  if (!sessionCookie) {
    return null;
  }
  
  try {
    const session = JSON.parse(sessionCookie.value);
    if (session.expiresAt && session.expiresAt < Date.now()) {
      return null;
    }
    return session;
  } catch (error) {
    return null;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; widgetId: string }> }
) {
  const session = await getSessionData();
  
  if (!session || !session.tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    // ENFORCE IDEMPOTENCY (STRICT)
    let idempotencyKey: string;
    try {
      const { requireIdempotencyKey } = await import('@/lib/db-middleware');
      idempotencyKey = await requireIdempotencyKey(request);
    } catch (error: any) {
      return NextResponse.json(
        { error: error.message || 'Idempotency-Key header required for DELETE operations' },
        { status: 400 }
      );
    }
    
    const { id: dashboardId, widgetId } = await params;
    const supabase = createUnscopedClient();
    
    // Verify dashboard exists and is not deleted
    const { data: dashboard } = await supabase
      .from('dashboards')
      .select('id')
      .eq('id', dashboardId)
      .eq('tenant_id', session.tenantId)
      .is('deleted_at', null)
      .single();
    
    if (!dashboard) {
      return NextResponse.json(
        { error: 'Dashboard not found' },
        { status: 404 }
      );
    }
    
    const { error } = await supabase
      .from('dashboard_widgets')
      .delete()
      .eq('id', widgetId)
      .eq('dashboard_id', dashboardId)
      .eq('tenant_id', session.tenantId);
    
    if (error) {
      console.error('Error deleting widget:', error);
      return NextResponse.json(
        { error: 'Failed to delete widget' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
