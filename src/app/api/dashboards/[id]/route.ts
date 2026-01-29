/**
 * Dashboard Detail API
 * GET /api/dashboards/[id] - Get single dashboard
 */

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
    const supabase = createUnscopedClient();
    
    const { data: dashboard, error } = await supabase
      .from('dashboards')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', session.tenantId)
      .is('deleted_at', null)
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
    
    const { id } = await params;
    const body = await request.json();
    const { description, is_default } = body;
    
    // Build update object with only provided fields
    const updates: any = {};
    if (description !== undefined) updates.description = description;
    if (is_default !== undefined) updates.is_default = is_default;
    
    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }
    
    const supabase = createUnscopedClient();
    
    // If setting as default, unset all other defaults for this tenant first
    if (is_default === true) {
      await supabase
        .from('dashboards')
        .update({ is_default: false })
        .eq('tenant_id', session.tenantId)
        .neq('id', id);
    }
    
    const { data: dashboard, error } = await supabase
      .from('dashboards')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', session.tenantId)
      .is('deleted_at', null)
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

export async function DELETE(
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
    // ENFORCE IDEMPOTENCY
    let idempotencyKey: string | null;
    try {
      idempotencyKey = await getIdempotencyKey(request, 'DELETE');
    } catch (error: any) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: 'Idempotency-Key header required for DELETE operations' },
        { status: 400 }
      );
    }
    
    const { id } = await params;
    const supabase = createUnscopedClient();
    
    // Soft delete the dashboard by setting deleted_at timestamp
    const { error } = await supabase
      .from('dashboards')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', session.tenantId)
      .is('deleted_at', null);
    
    if (error) {
      console.error('Error deleting dashboard:', error);
      return NextResponse.json(
        { error: 'Failed to delete dashboard' },
        { status: 500 }
      );
    }
    
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
