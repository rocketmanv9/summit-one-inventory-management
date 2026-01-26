import { NextRequest, NextResponse } from 'next/server';
import { createUnscopedClient } from '@/lib/db-middleware';
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
    const { id: dashboardId, widgetId } = await params;
    const supabase = createUnscopedClient();
    
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
