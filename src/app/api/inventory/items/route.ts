/**
 * Inventory Items API - Refactored with withAuth Wrapper
 * 
 * BEFORE: ~50 lines of manual auth setup per route × ~80 routes = maintenance nightmare
 * AFTER: Centralized auth in withAuth() - one place to fix security issues
 * 
 * GET /api/inventory/items - List items for authenticated tenant (RLS enforced)
 * POST /api/inventory/items - Create new item (RLS enforced, idempotent)
 * 
 * SECURITY BENEFITS:
 * - Auth logic is in ONE file (src/lib/api-wrapper.ts)
 * - RLS + JWT (no service role)
 * - Ticket-based SSO support
 * - Centralized error handling
 * - Consistent response formats
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth, AuthContext } from '@/lib/api-wrapper';
import { requireIdempotencyKey } from '@/lib/db-middleware';

/**
 * GET /api/inventory/items
 * 
 * List all catalog items for the authenticated tenant.
 * RLS policies automatically filter to tenant_id from JWT.
 * NO manual tenant filtering needed.
 */
export const GET = withAuth(async (req: NextRequest, { supabase, tenantId }: AuthContext) => {
  const { data: items, error } = await supabase
    .schema('inventory')
    .from('catalog_items')
    .select(`
      *,
      item_categories:item_categories(name)
    `)
    .is('deleted_at', null)
    .order('name');

  if (error) {
    console.error('[Items] Error fetching items:', error);
    throw new Error(`Failed to fetch items: ${error.message}`);
  }

  console.log(`[Items] Fetched ${items?.length || 0} items for tenant ${tenantId}`);

  return NextResponse.json({
    data: items,
    meta: {
      tenantId,
      count: items?.length || 0
    }
  });
});

/**
 * POST /api/inventory/items
 * 
 * Create a new catalog item.
 * 
 * IDEMPOTENCY: Requires Idempotency-Key header
 * - If same key is used twice, returns the same item (no duplicate)
 * - Prevents accidental duplicate items from network retries
 * 
 * RLS ensures the item is created in the authenticated tenant's schema.
 */
export const POST = withAuth(async (req: NextRequest, { supabase, tenantId, user }: AuthContext) => {
  // IDEMPOTENCY: Get or require idempotency key
  let idempotencyKey: string;
  try {
    idempotencyKey = await requireIdempotencyKey(req);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Idempotency-Key header required' },
      { status: 400 }
    );
  }

  // Parse request body
  const body = await req.json();
  const {
    name,
    sku,
    description,
    category_id,
    unit_of_measure,
    tracking_mode,
    reorder_point,
    min_stock_level,
    max_stock_level
  } = body;

  // Validate required fields
  if (!name || !sku) {
    return NextResponse.json(
      { error: 'Missing required fields: name, sku' },
      { status: 400 }
    );
  }

  // Insert item
  // RLS policy automatically sets tenant_id to user's tenant
  // No manual tenant_id injection needed
  const { data: item, error } = await supabase
    .schema('inventory')
    .from('catalog_items')
    .insert({
      name,
      sku,
      description,
      category_id,
      unit_of_measure: unit_of_measure || 'EA',
      tracking_mode: tracking_mode || 'stock',
      reorder_point,
      min_stock_level,
      max_stock_level,
      created_by: user.id,
      updated_by: user.id,
      last_event_id: idempotencyKey
    })
    .select()
    .single();

  // Handle duplicate idempotency key (item already created)
  if (error?.code === '23505') {
    console.log('[Items] Duplicate idempotency key, returning existing item');
    
    const { data: existingItem } = await supabase
      .schema('inventory')
      .from('catalog_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('last_event_id', idempotencyKey)
      .single();

    if (existingItem) {
      return NextResponse.json({ data: existingItem }, { status: 200 });
    }
  }

  if (error) {
    console.error('[Items] Error creating item:', error);
    throw new Error(`Failed to create item: ${error.message}`);
  }

  return NextResponse.json({ data: item }, { status: 201 });
});


