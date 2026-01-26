/**
 * Dashboards API
 * GET /api/dashboards - List dashboards for authenticated tenant
 * POST /api/dashboards - Create new dashboard
 */

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

export async function GET(request: NextRequest) {
  const session = await getSessionData();
  
  if (!session || !session.tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const supabase = createUnscopedClient();
    
    console.log('[DASHBOARDS API] Fetching for tenant:', session.tenantId);
    
    const { data: dashboards, error } = await supabase
      .schema('public')
      .from('dashboards')
      .select('*')
      .eq('tenant_id', session.tenantId)
      .is('deleted_at', null)
      .order('is_default', { ascending: false })
      .order('name');
    
    if (error) {
      console.error('Error fetching dashboards:', error);
      return NextResponse.json(
        { error: 'Failed to fetch dashboards' },
        { status: 500 }
      );
    }
    
    console.log('[DASHBOARDS API] Found dashboards:', dashboards?.map(d => ({ id: d.id, name: d.name, tenant: d.tenant_id })));
    
    return NextResponse.json({ data: dashboards });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await getSessionData();
  
  if (!session || !session.tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const body = await request.json();
    const { name, description, is_default } = body;
    
    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Dashboard name is required' },
        { status: 400 }
      );
    }
    
    const supabase = createUnscopedClient();
    
    const { data: dashboard, error } = await supabase
      .schema('public')
      .from('dashboards')
      .insert({
        tenant_id: session.tenantId,
        name: name.trim(),
        description: description?.trim() || null,
        is_default: is_default || false,
        scope: 'user',
        owner_user_id: session.userId,
        created_by: session.userId,
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating dashboard:', error);
      return NextResponse.json(
        { error: 'Failed to create dashboard' },
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

