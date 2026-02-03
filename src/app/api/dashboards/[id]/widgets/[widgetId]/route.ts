import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; widgetId: string }> }
) {
  try {
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { client: supabase, context } = auth;
    const { id: dashboardId, widgetId } = await params;
    
    // Verify dashboard exists and is not deleted
    const { data: dashboard } = await supabase
      .from('dashboards')
      .select('id')
      .eq('id', dashboardId)
      .eq('tenant_id', context.tenantId)
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
      .eq('tenant_id', context.tenantId);
    
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
