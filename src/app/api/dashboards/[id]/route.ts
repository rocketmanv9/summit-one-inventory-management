/**
 * Dashboard Detail API
 * GET /api/dashboards/[id] - Get single dashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { client: supabase, context } = auth;
    const { id } = await params;
    
    const { data: dashboard, error } = await supabase
      .from('dashboards')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', context.tenantId)
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
  try {
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { client: supabase, context } = auth;
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
    
    // If setting as default, unset all other defaults for this tenant first
    if (is_default === true) {
      await supabase
        .from('dashboards')
        .update({ is_default: false })
        .eq('tenant_id', context.tenantId)
        .neq('id', id);
    }
    
    const { data: dashboard, error } = await supabase
      .from('dashboards')
      .update(updates)
      .eq('id', id)
      .eq('tenant_id', context.tenantId)
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
  try {
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { client: supabase, context } = auth;
    const { id } = await params;
    
    // Soft delete the dashboard by setting deleted_at timestamp
    const { error } = await supabase
      .from('dashboards')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', context.tenantId)
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
