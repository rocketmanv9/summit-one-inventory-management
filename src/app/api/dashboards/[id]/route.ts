/**
 * Dashboard Detail API
 * GET /api/dashboards/[id] - Get single dashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
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
    const { id } = await params;
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    const { data: dashboard, error } = await supabase
      .from('dashboards')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', session.tenantId)
      .single();
    
    if (error) {
      console.error('Error fetching dashboard:', error);
      return NextResponse.json(
        { error: 'Dashboard not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ data: dashboard });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PATCH(
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
    const { id } = await params;
    const body = await request.json();
    const { description } = body;
    
    if (description === undefined) {
      return NextResponse.json(
        { error: 'Description is required' },
        { status: 400 }
      );
    }
    
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    
    const { data: dashboard, error } = await supabase
      .from('dashboards')
      .update({ description })
      .eq('id', id)
      .eq('tenant_id', session.tenantId)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating dashboard:', error);
      return NextResponse.json(
        { error: 'Failed to update dashboard' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ data: dashboard });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
