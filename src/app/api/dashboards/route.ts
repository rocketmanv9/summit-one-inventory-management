/**
 * Dashboards API
 * GET /api/dashboards - List dashboards for authenticated tenant
 * POST /api/dashboards - Create new dashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  try {
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { client: supabase, context } = auth;

    console.log('[DASHBOARDS API] Fetching for tenant:', context.tenantId);

    const { data: dashboards, error } = await supabase
      .schema('public')
      .from('dashboards')
      .select('*')
      .eq('tenant_id', context.tenantId)
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
    
    console.log('[DASHBOARDS API] Found dashboards:', dashboards?.map((d: any) => ({ id: d.id, name: d.name, tenant: d.tenant_id })));
    
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
  try {
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { client: supabase, context } = auth;

    const body = await request.json();
    const { name, description, is_default } = body;
    
    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Dashboard name is required' },
        { status: 400 }
      );
    }
    
    const { data: dashboard, error } = await supabase
      .schema('public')
      .from('dashboards')
      .insert({
        tenant_id: context.tenantId,
        name: name.trim(),
        description: description?.trim() || null,
        is_default: is_default || false,
        scope: 'user',
        owner_user_id: context.userId,
        created_by: context.userId,
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


