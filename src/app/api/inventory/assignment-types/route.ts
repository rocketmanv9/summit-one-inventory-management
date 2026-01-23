import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/db-middleware';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';

// GET /api/inventory/assignment-types - List assignment types
export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const supabase = createClient();

    const { data: types, error } = await supabase
      .schema('inventory')
      .from('assignment_types')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('sort_order')
      .order('display_name');

    if (error) {
      console.error('Error fetching assignment types:', error);
      return NextResponse.json(
        { error: 'Failed to fetch assignment types' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: types });
  } catch (error) {
    console.error('Error in GET /api/inventory/assignment-types:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/inventory/assignment-types - Create new assignment type
export async function POST(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);

  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }

  try {
    const body = await request.json();
    const { type_key, display_name, icon, description, sort_order, requires_id } = body;

    if (!type_key || !display_name) {
      return NextResponse.json(
        { error: 'type_key and display_name are required' },
        { status: 400 }
      );
    }

    // Validate type_key format (lowercase, alphanumeric + underscore/hyphen only)
    if (!/^[a-z0-9_-]+$/.test(type_key)) {
      return NextResponse.json(
        { error: 'type_key must be lowercase alphanumeric with underscores or hyphens only' },
        { status: 400 }
      );
    }

    const supabase = createClient();

    const { data: newType, error } = await supabase
      .schema('inventory')
      .from('assignment_types')
      .insert({
        tenant_id: tenantId,
        type_key,
        display_name,
        icon: icon || null,
        description: description || null,
        sort_order: sort_order || 100,
        requires_id: requires_id !== false, // Default to true
        is_system: false, // User-created types are never system types
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      // Handle unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'An assignment type with this key already exists' },
          { status: 409 }
        );
      }
      
      console.error('Error creating assignment type:', error);
      return NextResponse.json(
        { error: 'Failed to create assignment type' },
        { status: 500 }
      );
    }

    return NextResponse.json({ data: newType }, { status: 201 });
  } catch (error) {
    console.error('Error in POST /api/inventory/assignment-types:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
