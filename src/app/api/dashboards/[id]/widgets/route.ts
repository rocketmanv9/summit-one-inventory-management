/**
 * Dashboard Widgets API
 * GET /api/dashboards/[id]/widgets - List widgets for a dashboard
 * POST /api/dashboards/[id]/widgets - Add widget to dashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';
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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionData();
  
  if (!session || !session.tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const { id: dashboardId } = await params;
    const supabase = createClient();
    
    const { data: widgets, error } = await supabase
      .from('dashboard_widgets')
      .select('*')
      .eq('dashboard_id', dashboardId)
      .eq('tenant_id', session.tenantId)
      .order('created_at');
    
    if (error) {
      console.error('Error fetching widgets:', error);
      return NextResponse.json(
        { error: 'Failed to fetch widgets' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ data: widgets });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionData();
  
  if (!session || !session.tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const { id: dashboardId } = await params;
    const body = await request.json();
    const { widget_key, title, layout, config, refresh_seconds } = body;
    
    if (!widget_key) {
      return NextResponse.json(
        { error: 'widget_key is required' },
        { status: 400 }
      );
    }
    
    const supabase = createClient();
    
    // If no layout provided, calculate next available position
    let widgetLayout = layout;
    if (!widgetLayout) {
      // Get existing widgets to find next available position
      const { data: existingWidgets } = await supabase
        .from('dashboard_widgets')
        .select('layout')
        .eq('dashboard_id', dashboardId)
        .eq('tenant_id', session.tenantId);
      
      // Calculate next position (stack vertically)
      const maxY = existingWidgets?.reduce((max, w) => {
        const y = w.layout?.y || 0;
        const h = w.layout?.h || 4;
        return Math.max(max, y + h);
      }, 0) || 0;
      
      widgetLayout = { x: 0, y: maxY, w: 4, h: 4 };
    }
    
    const { data: widget, error } = await supabase
      .from('dashboard_widgets')
      .insert({
        tenant_id: session.tenantId,
        dashboard_id: dashboardId,
        widget_key,
        title: title || null,
        layout: widgetLayout,
        config: config || {},
        refresh_seconds: refresh_seconds || 300,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating widget:', error);
      return NextResponse.json(
        { error: 'Failed to create widget' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ data: widget });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
