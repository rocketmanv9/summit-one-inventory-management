/**
 * Tenant Settings API - Admin Only
 * GET /api/settings/tenant - Get tenant settings
 * PUT /api/settings/tenant - Update tenant settings (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createUserClient } from '@/lib/db-middleware';
import { cookies } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const { supabase, tenantId } = await createUserClient(request);

    // Use the function to get or create default settings
    const { data: settings, error } = await supabase
      .schema('supply_chain')
      .rpc('get_or_create_tenant_settings', { p_tenant_id: tenantId });

    if (error) {
      console.error('Error fetching tenant settings:', error);
      return NextResponse.json(
        { error: 'Failed to fetch settings', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: settings });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { supabase, tenantId, userId } = await createUserClient(request);

    // Check if user is admin via cookie session
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get('inventory_session');

    if (!sessionCookie) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let userRole = 'user';
    try {
      const session = JSON.parse(sessionCookie.value);
      userRole = session.role || 'user';
    } catch (error) {
      console.error('Failed to parse session:', error);
    }

    if (userRole !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden', message: 'Admin access required to update settings' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const {
      po_number_format,
      po_number_prefix,
      cycle_count_number_format,
      cycle_count_number_prefix,
      auto_approve_enabled,
      auto_approve_limit,
      vendor_auto_approve_limits
    } = body;

    // Validate po_number_format
    const validFormats = ['sequential-year', 'sequential', 'timestamp', 'custom'];
    if (po_number_format && !validFormats.includes(po_number_format)) {
      return NextResponse.json(
        { error: `Invalid po_number_format. Must be one of: ${validFormats.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate cycle_count_number_format
    const validCycleCountFormats = ['date-sequential', 'sequential-year', 'sequential'];
    if (cycle_count_number_format && !validCycleCountFormats.includes(cycle_count_number_format)) {
      return NextResponse.json(
        { error: `Invalid cycle_count_number_format. Must be one of: ${validCycleCountFormats.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate auto_approve_limit
    if (auto_approve_limit !== null && auto_approve_limit !== undefined && auto_approve_limit !== '') {
      const limit = parseFloat(auto_approve_limit);
      if (isNaN(limit) || limit < 0) {
        return NextResponse.json(
          { error: 'auto_approve_limit must be a positive number or null' },
          { status: 400 }
        );
      }
    }


    // First ensure settings exist (get or create)
    await supabase
      .schema('supply_chain')
      .rpc('get_or_create_tenant_settings', { p_tenant_id: tenantId });

    // Build update object
    const updateData: any = {
      updated_at: new Date().toISOString(),
      updated_by: userId,
    };

    if (po_number_format !== undefined) {
      updateData.po_number_format = po_number_format || 'sequential-year';
    }
    if (po_number_prefix !== undefined) {
      updateData.po_number_prefix = po_number_prefix || null;
    }
    if (cycle_count_number_format !== undefined) {
      updateData.cycle_count_number_format = cycle_count_number_format || 'date-sequential';
    }
    if (cycle_count_number_prefix !== undefined) {
      updateData.cycle_count_number_prefix = cycle_count_number_prefix || null;
    }
    if (auto_approve_enabled !== undefined) {
      updateData.auto_approve_enabled = auto_approve_enabled ?? false;
    }
    if (auto_approve_limit !== undefined) {
      updateData.auto_approve_limit = auto_approve_limit ? parseFloat(auto_approve_limit) : null;
    }
    if (vendor_auto_approve_limits !== undefined) {
      updateData.vendor_auto_approve_limits = vendor_auto_approve_limits || {};
    }

    // Update settings
    const { data: updatedSettings, error } = await supabase
      .schema('supply_chain')
      .from('tenant_settings')
      .update(updateData)
      .eq('tenant_id', tenantId)
      .select();

    if (error) {
      console.error('Error updating tenant settings:', error);
      return NextResponse.json(
        { error: 'Failed to update settings', details: error },
        { status: 500 }
      );
    }

    if (!updatedSettings || updatedSettings.length === 0) {
      return NextResponse.json(
        { error: 'Settings not found after update' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      data: updatedSettings[0],
      message: 'Settings updated successfully'
    });

    if (error) {
      console.error('Error updating tenant settings:', error);
      return NextResponse.json(
        { error: 'Failed to update settings', details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({
      data: updatedSettings,
      message: 'Settings updated successfully'
    });
  } catch (error: any) {
    console.error('Unexpected error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

