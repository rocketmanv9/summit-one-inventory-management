/**
 * Inventory RPC Service Layer
 * Bounded Context: Inventory Management (Stock, Movements, Assets)
 * Schema: inventory
 */

import { createBrowserAuthedClient } from '@/supabase/client';
import { getStoredAccessToken, getTenantIdFromToken, getUserIdFromToken } from '@/lib/auth-token';
import { AppError } from '@rocketmanv9/chassis/errors';
import type { Database } from 'types/supabase';

type CatalogItemRow = Database['inventory']['Tables']['catalog_items']['Row'];
type CatalogItemInsert = Database['inventory']['Tables']['catalog_items']['Insert'];
type CatalogItemUpdate = Database['inventory']['Tables']['catalog_items']['Update'];
type ItemCategoryRow = Database['inventory']['Tables']['item_categories']['Row'];
type ItemCategoryInsert = Database['inventory']['Tables']['item_categories']['Insert'];
type ItemCategoryUpdate = Database['inventory']['Tables']['item_categories']['Update'];
type InventoryLevelRow = Database['inventory']['Tables']['inventory_levels']['Row'];
type InventoryLevelInsert = Database['inventory']['Tables']['inventory_levels']['Insert'];
type LocationRow = Database['inventory']['Tables']['locations']['Row'];
type LocationInsert = Database['inventory']['Tables']['locations']['Insert'];
type LocationUpdate = Database['inventory']['Tables']['locations']['Update'];
type LocationTypeRow = Database['inventory']['Tables']['location_types']['Row'];
type LocationTypeInsert = Database['inventory']['Tables']['location_types']['Insert'];
type LocationTypeUpdate = Database['inventory']['Tables']['location_types']['Update'];
type SkuSettingsRow = Database['inventory']['Tables']['sku_settings']['Row'];
type SkuSettingsInsert = Database['inventory']['Tables']['sku_settings']['Insert'];
type AssignmentTypeRow = {
  id: string;
  type_key: string;
  display_name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
  last_event_id: string;
};
type AssetRow = Database['inventory']['Tables']['assets']['Row'];
type AssetInsert = Database['inventory']['Tables']['assets']['Insert'];
type AssetUpdate = Database['inventory']['Tables']['assets']['Update'];
type AssetStateRow = Database['inventory']['Tables']['asset_state']['Row'];
type ReservationRow = Database['inventory']['Tables']['reservations']['Row'];
type TransferRow = Database['inventory']['Tables']['transfers']['Row'];
type TransferLineRow = Database['inventory']['Tables']['transfer_lines']['Row'];
type StockMovementRow = Database['inventory']['Tables']['stock_movements']['Row'];

type ReservationTypeRow = {
  id: string;
  tenant_id: string | null;
  type_key: string;
  display_name: string;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  description?: string | null;
  last_event_id: string;
  created_at: string;
  updated_at: string;
};

type CatalogItemWithCategory = {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  category_id: string | null;
  uom_term_id: string;
  tracking_mode: string;
  reorder_point: number | null;
  min_stock_level: number | null;
  max_stock_level: number | null;
  active: boolean | null;
  base_sku: string | null;
  last_event_id: string | null;
  item_categories?: Pick<ItemCategoryRow, 'name'> | null;
};
type CatalogItemInsertPayload = Omit<CatalogItemInsert, 'tenant_id'> & { tenant_id?: string };
type CatalogItemUpdatePayload = Omit<CatalogItemUpdate, 'tenant_id'> & { tenant_id?: string };
type InventoryLevelInsertPayload = Omit<InventoryLevelInsert, 'tenant_id'> & { tenant_id?: string };
type ItemCategoryInsertPayload = Omit<ItemCategoryInsert, 'tenant_id'> & { tenant_id?: string };
type ItemCategoryUpdatePayload = Omit<ItemCategoryUpdate, 'tenant_id'> & { tenant_id?: string };
type LocationInsertPayload = Omit<LocationInsert, 'tenant_id'> & { tenant_id?: string };
type LocationUpdatePayload = Omit<LocationUpdate, 'tenant_id'> & { tenant_id?: string };
type LocationTypeInsertPayload = Omit<LocationTypeInsert, 'tenant_id'> & { tenant_id?: string };
type LocationTypeUpdatePayload = Omit<LocationTypeUpdate, 'tenant_id'> & { tenant_id?: string };
type SkuSettingsInsertPayload = Omit<SkuSettingsInsert, 'tenant_id'> & { tenant_id?: string };
type LocationWithType = LocationRow & { location_type?: Pick<LocationTypeRow, 'name'> | null };
type AssetInsertPayload = Omit<AssetInsert, 'tenant_id'> & { tenant_id?: string };
type AssetUpdatePayload = Omit<AssetUpdate, 'tenant_id'> & { tenant_id?: string };
type TransferUpdatePayload = {
  from_location_id: string;
  to_location_id: string;
  notes: string | null;
  lines: Array<{
    id?: string;
    catalog_item_id: string;
    qty: number;
    last_event_id?: string;
  }>;
};

type AssetWithRelations = {
  id: string;
  asset_tag: string;
  serial_number: string | null;
  catalog_item_id: string | null;
  location_id: string | null;
  status: string | null;
  purchase_date: string | null;
  purchase_cost: number | null;
  warranty_expires: string | null;
  last_event_id: string | null;
  catalog_item?: Pick<CatalogItemRow, 'id' | 'name' | 'sku'> | null;
  location?: (LocationWithType & { location_type?: { id?: string; name?: string } | null }) | null;
  asset_state?: Pick<AssetStateRow, 'current_status' | 'current_location_id'> | null;
};

type ReservationWithRelations = {
  id: string;
  catalog_item_id: string;
  location_id: string | null;
  destination_location_id: string | null;
  qty: number;
  reservation_type: string | null;
  asset_id: string | null;
  allocation_type: string | null;
  status: string | null;
  job_ref: Record<string, unknown> | string | null;
  external_order_ref: string | null;
  needed_by: string | null;
  expiration_date: string | null;
  reserved_from: string | null;
  reserved_until: string | null;
  notes: string | null;
  created_at: string;
  last_event_id: string | null;
  catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'tracking_mode'> | null;
  locations?: Pick<LocationRow, 'id' | 'name'> | null;
  destination_locations?: Pick<LocationRow, 'id' | 'name'> | null;
  assets?: Pick<AssetRow, 'id' | 'asset_tag' | 'serial_number' | 'vin'> | null;
};

type TransferWithRelations = {
  id: string;
  status: string | null;
  notes: string | null;
  created_at: string;
  initiated_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  last_event_id: string | null;
  from_location?: Pick<LocationRow, 'id' | 'name'> & { location_type?: { name?: string } | null } | null;
  to_location?: Pick<LocationRow, 'id' | 'name'> & { location_type?: { name?: string } | null } | null;
  transfer_lines?: Array<{
    id: string;
    catalog_item_id: string;
    qty: number | null;
    qty_shipped: number | null;
    qty_received: number | null;
    line_number: number | null;
    last_event_id: string | null;
    catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'tracking_mode'> | null;
  }>;
};

type StockMovementWithRelations = {
  id: string;
  catalog_item_id: string;
  location_id: string | null;
  quantity_delta: number;
  movement_type: string;
  posting_status: string | null;
  reason: string | null;
  source_ref_type: string | null;
  source_ref_id: string | null;
  reversal_ref_id: string | null;
  occurred_at: string | null;
  created_at: string;
  last_event_id: string | null;
  catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku'> | null;
  locations?: Pick<LocationRow, 'id' | 'name'> | null;
};

function getAuthContext() {
  const token = getStoredAccessToken();
  if (!token) {
    throw AppError.unauthorized('Authentication required');
  }

  const tenantId = getTenantIdFromToken(token);
  if (!tenantId) {
    throw AppError.unauthorized('Missing tenant context');
  }

  return {
    tenantId,
    userId: getUserIdFromToken(token),
  };
}

function requireUserId(userId: string | null): string {
  if (!userId) {
    throw AppError.unauthorized('Missing user identity');
  }
  return userId;
}

export interface IssueInventoryParams {
  location_id: string;
  items: Array<{
    catalog_item_id: string;
    qty_issued: number;
  }>;
  issued_to_type: 'job' | 'truck' | 'person' | 'other';
  issued_to_ref: string;
  reason: string;
  notes?: string;
}

export interface IssueInventoryResult {
  success: boolean;
  issued_count: number;
  location_id: string;
  issued_to: string;
}

export interface AdjustInventoryParams {
  location_id: string;
  catalog_item_id: string;
  new_qty: number;
  reason: 'count_variance' | 'damage' | 'theft' | 'expiration' | 'other';
  notes: string;
  override_reason?: string;
}

export interface GuardrailError {
  code: 'NEGATIVE_INVENTORY_BLOCKED' | 'OVER_RECEIPT_BLOCKED' | 'OVERRIDE_REASON_REQUIRED' | 'UOM_MISMATCH_BLOCKED';
  message: string;
  details?: Record<string, any>;
  action?: string;
}

export interface AdjustInventoryResult {
  success: boolean;
  error?: GuardrailError;
  current_qty?: number;
  old_qty?: number;
  new_qty?: number;
  delta?: number;
  reason?: string;
  override_logged?: boolean;
}

export const InventoryRPC = {
  /**
   * Issue inventory (release from location)
   * RPC: inventory.rpc_issue_inventory
   */
  async issueInventory(
    params: IssueInventoryParams
  ): Promise<IssueInventoryResult> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_issue_inventory', {
      p_location_id: params.location_id,
      p_items: params.items,
      p_issued_to_type: params.issued_to_type,
      p_issued_to_ref: params.issued_to_ref,
      p_reason: params.reason,
      p_notes: params.notes,
    });

    if (error) {
      throw AppError.internal(`Failed to issue inventory: ${error.message}`);
    }

    return data;
  },

  /**
   * Adjust inventory (manual correction)
   * RPC: inventory.rpc_adjust_inventory
   */
  async adjustInventory(
    params: AdjustInventoryParams
  ): Promise<AdjustInventoryResult> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_adjust_inventory', {
      p_location_id: params.location_id,
      p_catalog_item_id: params.catalog_item_id,
      p_new_qty: params.new_qty,
      p_reason: params.reason,
      p_notes: params.notes,
      p_override_reason: params.override_reason ?? null,
    });

    if (error) {
      throw AppError.internal(`Failed to adjust inventory: ${error.message}`);
    }

    return data;
  },

  /**
   * Get catalog items
   * Table: inventory.catalog_items
   */
  async getCatalogItems(filters?: {
    active?: boolean;
    category_id?: string;
    tracking_mode?: string;
    search?: string;
    exclude_variants?: boolean;
    parent_item_id?: string;
  }): Promise<CatalogItemWithCategory[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('catalog_items')
      .select(
        'id, name, sku, description, category_id, uom_term_id, tracking_mode, reorder_point, min_stock_level, max_stock_level, active, base_sku, last_event_id, is_parent, parent_item_id, variant_attributes, variant_dimensions, variant_options, item_categories(name)'
      )
      .order('name');

    if (filters?.active !== undefined) {
      query = query.eq('active', filters.active);
    }
    if (filters?.category_id) {
      query = query.eq('category_id', filters.category_id);
    }
    if (filters?.tracking_mode) {
      query = query.eq('tracking_mode', filters.tracking_mode);
    }
    if (filters?.search) {
      query = query.or(`name.ilike.%${filters.search}%,sku.ilike.%${filters.search}%`);
    }
    // By default, hide variant children (show parents + standalone items)
    if (filters?.exclude_variants !== false) {
      query = query.is('parent_item_id', null);
    }
    // Filter to a specific parent's variants
    if (filters?.parent_item_id) {
      query = query.eq('parent_item_id', filters.parent_item_id);
    }

    const { data, error } = await query;

    if (error) {
      throw AppError.internal(`Failed to fetch catalog items: ${error.message}`);
    }

    const normalized = (data || []).map((item: any) => ({
      ...item,
      item_categories: Array.isArray(item.item_categories)
        ? item.item_categories[0] ?? null
        : item.item_categories ?? null,
    }));

    return normalized as CatalogItemWithCategory[];
  },

  /**
   * Count catalog items by category
   * Table: inventory.catalog_items
   */
  async countCatalogItemsByCategory(categoryId: string): Promise<number> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { count, error } = await supabase
      .from('catalog_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', categoryId);

    if (error) {
      throw AppError.internal(`Failed to count category items: ${error.message}`);
    }

    return count ?? 0;
  },

  /**
   * Reassign catalog items to a different category.
   * Updates each item individually to preserve OCC via last_event_id.
   * The trigger_catalog_item_events trigger handles outbox emission on UPDATE.
   */
  async reassignCatalogItemsCategory(oldCategoryId: string, newCategoryId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');

    // Fetch items to get their last_event_id for OCC
    const { data: items, error: fetchError } = await supabase
      .from('catalog_items')
      .select('id, last_event_id')
      .eq('category_id', oldCategoryId);

    if (fetchError) {
      throw AppError.internal(`Failed to fetch category items for reassignment: ${fetchError.message}`);
    }

    if (!items || items.length === 0) return;

    for (const item of items) {
      const { data: updated, error } = await supabase
        .from('catalog_items')
        .update({ category_id: newCategoryId })
        .eq('id', item.id)
        .eq('last_event_id', item.last_event_id)
        .select('id')
        .maybeSingle();

      if (error) {
        throw AppError.internal(`Failed to reassign catalog item ${item.id}: ${error.message}`);
      }
      if (!updated) {
        throw AppError.conflict(`Concurrent modification detected on catalog item ${item.id} (OCC conflict)`);
      }
    }
  },

  /**
   * Get item categories
   * Table: inventory.item_categories
   */
  async getItemCategories(): Promise<ItemCategoryRow[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('item_categories')
      .select('id, name, sku_prefix, sku_mode, parent_category_id, last_event_id, created_at, updated_at, gv_category_term_id')
      .order('name');

    if (error) {
      throw AppError.internal(`Failed to fetch item categories: ${error.message}`);
    }

    // Cast via unknown — gv_category_term_id not yet in generated types (added by migration)
    return (data || []) as unknown as ItemCategoryRow[];
  },

  /**
   * Create an item category
   * Table: inventory.item_categories
   */
  async createItemCategory(payload: ItemCategoryInsertPayload) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const insertPayload: ItemCategoryInsertPayload = {
      ...payload,
      last_event_id: payload.last_event_id ?? crypto.randomUUID(),
    };

    const { data, error } = await supabase
      .from('item_categories')
      .insert(insertPayload)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to create category: ${error.message}`);
    }

    return data as Pick<ItemCategoryRow, 'id' | 'last_event_id'>;
  },

  /**
   * Update an item category with optimistic concurrency control
   */
  async updateItemCategory(id: string, updates: ItemCategoryUpdatePayload, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { id: _id, created_at, tenant_id, last_event_id, ...safeUpdates } = updates as ItemCategoryUpdatePayload & {
      id?: string;
      created_at?: string;
      tenant_id?: string;
      last_event_id?: string;
    };

    const { data, error } = await supabase
      .from('item_categories')
      .update({ ...safeUpdates })
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to update category: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Category was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<ItemCategoryRow, 'id' | 'last_event_id'>;
  },

  /**
   * Delete an item category with optimistic concurrency control
   */
  async deleteItemCategory(id: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');

    const { error: skuError } = await supabase
      .from('sku_settings')
      .delete()
      .eq('category_id', id);

    if (skuError) {
      throw AppError.internal(`Failed to delete category SKU settings: ${skuError.message}`);
    }

    const { data, error } = await supabase
      .from('item_categories')
      .delete()
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to delete category: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Category was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<ItemCategoryRow, 'id'>;
  },

  /**
   * Get location types
   * Table: inventory.location_types
   */
  async getLocationTypes(): Promise<LocationTypeRow[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('location_types')
      .select('id, name, description, code, last_event_id')
      .order('name');

    if (error) {
      throw AppError.internal(`Failed to fetch location types: ${error.message}`);
    }

    return (data || []) as LocationTypeRow[];
  },

  /**
   * Create a location type
   * Table: inventory.location_types
   */
  async createLocationType(payload: LocationTypeInsertPayload) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const insertPayload: LocationTypeInsertPayload = {
      ...payload,
      last_event_id: payload.last_event_id ?? crypto.randomUUID(),
    };

    const { data, error } = await supabase
      .from('location_types')
      .insert(insertPayload)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to create location type: ${error.message}`);
    }

    return data as Pick<LocationTypeRow, 'id' | 'last_event_id'>;
  },

  /**
   * Delete a location type with optimistic concurrency control
   */
  async deleteLocationType(id: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('location_types')
      .delete()
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to delete location type: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Location type was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<LocationTypeRow, 'id'>;
  },

  /**
   * Update a location type with optimistic concurrency control
   */
  async updateLocationType(id: string, updates: LocationTypeUpdatePayload, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { id: _id, created_at, tenant_id, last_event_id, ...safeUpdates } = updates as LocationTypeUpdatePayload & {
      id?: string;
      created_at?: string;
      tenant_id?: string;
      last_event_id?: string;
    };

    const { data, error } = await supabase
      .from('location_types')
      .update({ ...safeUpdates })
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to update location type: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Location type was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<LocationTypeRow, 'id' | 'last_event_id'>;
  },

  /**
   * Get SKU settings for a category
   * Table: inventory.sku_settings
   */
  async getSkuSettings(categoryId: string): Promise<Pick<SkuSettingsRow, 'separator' | 'next_sequence'> | null> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_get_sku_settings', {
      p_category_id: categoryId,
    });

    if (error) {
      throw AppError.internal(`Failed to fetch SKU settings: ${error.message}`);
    }

    if (!data || data.length === 0) return null;
    return data[0] as Pick<SkuSettingsRow, 'separator' | 'next_sequence'>;
  },

  /**
   * Upsert SKU settings for a category
   * Table: inventory.sku_settings
   */
  async upsertSkuSettings(payload: SkuSettingsInsertPayload) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { error } = await supabase
      .from('sku_settings')
      .upsert(payload, { onConflict: 'category_id' });

    if (error) {
      throw AppError.internal(`Failed to update SKU settings: ${error.message}`);
    }
  },

  /**
   * Create a catalog item
   * Table: inventory.catalog_items
   */
  async createCatalogItem(payload: CatalogItemInsertPayload) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_create_catalog_item', {
      p_name: payload.name,
      p_description: payload.description ?? null,
      p_category_id: payload.category_id ?? null,
      p_uom_term_id: payload.uom_term_id ?? null,
      p_tracking_mode: payload.tracking_mode ?? null,
      p_reorder_point: payload.reorder_point ?? null,
      p_base_sku: payload.base_sku ?? null,
      p_sku: payload.sku ?? null,
      p_last_event_id: payload.last_event_id ?? crypto.randomUUID(),
    });

    if (error) {
      throw AppError.internal(`Failed to create catalog item: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw AppError.internal('Failed to create catalog item: no data returned');
    }

    return data[0] as Pick<CatalogItemRow, 'id' | 'last_event_id'>;
  },

  /**
   * Update a catalog item with optimistic concurrency control
   */
  async updateCatalogItem(id: string, updates: CatalogItemUpdatePayload, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { id: _id, created_at, tenant_id, last_event_id, ...safeUpdates } = updates as CatalogItemUpdatePayload & {
      id?: string;
      created_at?: string;
      tenant_id?: string;
      last_event_id?: string;
    };

    const { data, error } = await supabase
      .from('catalog_items')
      .update({ ...safeUpdates, last_event_id: lastEventId })
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to update catalog item: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Catalog item was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<CatalogItemRow, 'id' | 'last_event_id'>;
  },

  /**
   * Delete a catalog item with optimistic concurrency control
   */
  async deleteCatalogItem(id: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('catalog_items')
      .delete()
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to delete catalog item: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Catalog item was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<CatalogItemRow, 'id'>;
  },

  /**
   * Get inventory levels for a catalog item
   * Table: inventory.inventory_levels
   */
  async getInventoryLevelsForItem(catalogItemId: string): Promise<InventoryLevelRow[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('inventory_levels')
      .select('id, location_id, current_stock, reorder_point, target_stock')
      .eq('catalog_item_id', catalogItemId);

    if (error) {
      throw AppError.internal(`Failed to fetch inventory levels: ${error.message}`);
    }

    return (data || []) as InventoryLevelRow[];
  },

  /**
   * Upsert inventory levels
   * Table: inventory.inventory_levels
   */
  async upsertInventoryLevels(payload: InventoryLevelInsertPayload[]) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { error } = await supabase
      .from('inventory_levels')
      .upsert(payload, { onConflict: 'catalog_item_id,location_id' });

    if (error) {
      throw AppError.internal(`Failed to save inventory levels: ${error.message}`);
    }
  },

  /**
   * Get assignment types
   * Table: inventory.assignment_types
   */
  async getAssignmentTypes(): Promise<AssignmentTypeRow[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('assignment_types')
      .select('id, type_key, display_name, description, is_active, sort_order, last_event_id')
      .order('sort_order');

    if (error) {
      throw AppError.internal(`Failed to fetch assignment types: ${error.message}`);
    }

    return (data || []) as AssignmentTypeRow[];
  },

  /**
   * Create an assignment type
   * Table: inventory.assignment_types
   */
  async createAssignmentType(payload: {
    type_key: string;
    display_name: string;
    description?: string | null;
    icon?: string | null;
    sort_order?: number;
    requires_id?: boolean;
  }) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const insertPayload = {
      type_key: payload.type_key,
      display_name: payload.display_name,
      description: payload.description ?? null,
      icon: payload.icon ?? null,
      sort_order: payload.sort_order ?? 100,
      requires_id: payload.requires_id ?? true,
      last_event_id: crypto.randomUUID(),
    };

    const { data, error } = await supabase
      .from('assignment_types')
      .insert(insertPayload)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to create assignment type: ${error.message}`);
    }

    return data as Pick<AssignmentTypeRow, 'id' | 'last_event_id'>;
  },

  /**
   * Update an assignment type with optimistic concurrency control
   */
  async updateAssignmentType(id: string, updates: {
    display_name?: string;
    description?: string | null;
    icon?: string | null;
    sort_order?: number;
    requires_id?: boolean;
    is_active?: boolean;
  }, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('assignment_types')
      .update({ ...updates, last_event_id: crypto.randomUUID() })
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to update assignment type: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Assignment type was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<AssignmentTypeRow, 'id' | 'last_event_id'>;
  },

  /**
   * Delete an assignment type with optimistic concurrency control
   */
  async deleteAssignmentType(id: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('assignment_types')
      .delete()
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to delete assignment type: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Assignment type was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<AssignmentTypeRow, 'id'>;
  },

  /**
   * Get assets with related catalog and location data
   */
  async getAssets(filters?: { status?: string; assigned?: boolean }): Promise<AssetWithRelations[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('assets')
      .select(
        'id, asset_tag, serial_number, catalog_item_id, location_id, status, purchase_date, purchase_cost, warranty_expires, last_event_id, catalog_item:catalog_item_id(id, name, sku), location:location_id(id, name, location_type_id, location_type:location_type_id(id, name)), asset_state:asset_state!asset_state_asset_id_fkey(current_status, current_location_id)'
      )
      .order('asset_tag');

    if (filters?.status) {
      query = query.eq('status', filters.status);
    } else {
      query = query.neq('status', 'retired');
    }
    if (filters?.assigned) {
      query = query.eq('status', 'assigned');
    }

    const { data, error } = await query;
    if (error) {
      throw AppError.internal(`Failed to fetch assets: ${error.message}`);
    }

    const normalized = (data || []).map((item: any) => ({
      ...item,
      catalog_item: Array.isArray(item.catalog_item)
        ? item.catalog_item[0] ?? null
        : item.catalog_item ?? null,
      location: Array.isArray(item.location)
        ? item.location[0] ?? null
        : item.location ?? null,
      asset_state: Array.isArray(item.asset_state)
        ? item.asset_state[0] ?? null
        : item.asset_state ?? null,
    }));

    return normalized as AssetWithRelations[];
  },

  /**
   * Create asset
   */
  async createAsset(payload: AssetInsertPayload) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const insertPayload: AssetInsertPayload = {
      ...payload,
      last_event_id: payload.last_event_id ?? crypto.randomUUID(),
    };

    const { data: existingAsset, error: existingError } = await supabase
      .from('assets')
      .select('id, last_event_id, status')
      .eq('asset_tag', insertPayload.asset_tag)
      .maybeSingle();

    if (existingError) {
      throw AppError.internal(`Failed to check existing asset: ${existingError.message}`);
    }

    if (existingAsset && existingAsset.status !== 'retired') {
      throw AppError.conflict('An asset with this tag already exists. Edit the existing asset or choose a different tag.');
    }

    if (existingAsset && existingAsset.status === 'retired') {
      const nextEventId = crypto.randomUUID();
      const updatePayload: AssetUpdatePayload = {
        ...insertPayload,
        status: insertPayload.status ?? 'available',
        last_event_id: nextEventId,
      };
      delete (updatePayload as AssetUpdatePayload & { tenant_id?: string }).tenant_id;

      let updateQuery = supabase
        .from('assets')
        .update(updatePayload)
        .eq('id', existingAsset.id);

      if (existingAsset.last_event_id) {
        updateQuery = updateQuery.eq('last_event_id', existingAsset.last_event_id);
      }

      const { data: restored, error: restoreError } = await updateQuery
        .select('id, last_event_id')
        .single();

      if (restoreError) {
        throw AppError.internal(`Failed to restore asset: ${restoreError.message}`);
      }

      return restored as Pick<AssetRow, 'id' | 'last_event_id'>;
    }

    const { data, error } = await supabase
      .from('assets')
      .insert(insertPayload)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to create asset: ${error.message}`);
    }

    return data as Pick<AssetRow, 'id' | 'last_event_id'>;
  },

  /**
   * Update asset with optimistic concurrency control
   */
  async updateAsset(id: string, updates: AssetUpdatePayload, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { id: _id, created_at, tenant_id, last_event_id, ...safeUpdates } = updates as AssetUpdatePayload & {
      id?: string;
      created_at?: string;
      tenant_id?: string;
      last_event_id?: string;
    };

    const { data, error } = await supabase
      .from('assets')
      .update({ ...safeUpdates })
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to update asset: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Asset was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<AssetRow, 'id' | 'last_event_id'>;
  },

  /**
   * Delete asset with optimistic concurrency control
   */
  async deleteAsset(id: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const nextEventId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('assets')
      .update({ status: 'retired', last_event_id: nextEventId })
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to delete asset: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Asset was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<AssetRow, 'id' | 'last_event_id'>;
  },

  /**
   * Assign asset via RPC
   */
  async assignAsset(params: {
    asset_id: string;
    assigned_to_type: string;
    assigned_to_id: string;
    notes?: string;
    last_event_id: string;
  }) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_asset_assign', {
      p_tenant_id: tenantId,
      p_asset_id: params.asset_id,
      p_assigned_to_type: params.assigned_to_type,
      p_assigned_to_id: params.assigned_to_id,
      p_assigned_by_user_id: requireUserId(userId),
      p_notes: params.notes ?? null,
      p_last_event_id: params.last_event_id,
    });

    if (error) {
      throw AppError.internal(`Failed to assign asset: ${error.message}`);
    }

    return data as string;
  },

  /**
   * Return asset via RPC
   */
  async returnAsset(params: { asset_id: string; notes?: string; last_event_id: string }) {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_asset_return', {
      p_tenant_id: tenantId,
      p_asset_id: params.asset_id,
      p_notes: params.notes ?? null,
      p_last_event_id: params.last_event_id,
    });

    if (error) {
      throw AppError.internal(`Failed to return asset: ${error.message}`);
    }

    return data as boolean;
  },

  /**
   * Get reservations
   */
  async getReservations(filters?: { status?: string; allocation_type?: string }): Promise<ReservationWithRelations[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('reservations')
      .select(
        'id, catalog_item_id, location_id, destination_location_id, qty, reservation_type, asset_id, allocation_type, status, job_ref, external_order_ref, needed_by, expiration_date, reserved_from, reserved_until, notes, created_at, last_event_id, catalog_items:catalog_item_id(id, name, sku, tracking_mode), locations:location_id(id, name), destination_locations:destination_location_id(id, name), assets:asset_id(id, asset_tag, serial_number, vin, status)'
      )
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.allocation_type) {
      query = query.eq('allocation_type', filters.allocation_type);
    }

    const { data, error } = await query;
    if (error) {
      throw AppError.internal(`Failed to fetch reservations: ${error.message}`);
    }

    const normalized = (data || []).map((item: any) => ({
      ...item,
      catalog_items: Array.isArray(item.catalog_items)
        ? item.catalog_items[0] ?? null
        : item.catalog_items ?? null,
      locations: Array.isArray(item.locations)
        ? item.locations[0] ?? null
        : item.locations ?? null,
      destination_locations: Array.isArray(item.destination_locations)
        ? item.destination_locations[0] ?? null
        : item.destination_locations ?? null,
      assets: Array.isArray(item.assets)
        ? item.assets[0] ?? null
        : item.assets ?? null,
    }));

    return normalized as ReservationWithRelations[];
  },

  /**
   * Create fungible reservation via RPC
   */
  async reserveFungible(params: {
    catalog_item_id: string;
    location_id: string;
    qty: number;
    allocation_type?: string | null;
    job_ref?: Record<string, unknown> | string | null;
    external_order_ref?: string | null;
    needed_by?: string | null;
    expiration_date?: string | null;
    reserved_from?: string | null;
    reserved_until?: string | null;
    notes?: string | null;
    destination_location_id?: string | null;
    last_event_id: string;
  }) {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_reserve_fungible', {
      p_tenant_id: tenantId,
      p_catalog_item_id: params.catalog_item_id,
      p_location_id: params.location_id,
      p_qty: params.qty,
      p_allocation_type: params.allocation_type ?? null,
      p_job_ref: params.job_ref ?? null,
      p_external_order_ref: params.external_order_ref ?? null,
      p_needed_by: params.needed_by ?? null,
      p_expiration_date: params.expiration_date ?? null,
      p_reserved_from: params.reserved_from ?? null,
      p_reserved_until: params.reserved_until ?? null,
      p_notes: params.notes ?? null,
      p_destination_location_id: params.destination_location_id ?? null,
      p_last_event_id: params.last_event_id,
    });

    if (error) {
      throw AppError.internal(`Failed to create reservation: ${error.message}`);
    }

    return data as string;
  },

  /**
   * Create serialized reservation via RPC
   */
  async reserveAsset(params: {
    asset_id: string;
    allocation_type?: string | null;
    job_ref?: Record<string, unknown> | string | null;
    external_order_ref?: string | null;
    needed_by?: string | null;
    expiration_date?: string | null;
    reserved_from?: string | null;
    reserved_until?: string | null;
    notes?: string | null;
    destination_location_id?: string | null;
    last_event_id: string;
  }) {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_reserve_asset', {
      p_tenant_id: tenantId,
      p_asset_id: params.asset_id,
      p_allocation_type: params.allocation_type ?? null,
      p_job_ref: params.job_ref ?? null,
      p_external_order_ref: params.external_order_ref ?? null,
      p_needed_by: params.needed_by ?? null,
      p_expiration_date: params.expiration_date ?? null,
      p_reserved_from: params.reserved_from ?? null,
      p_reserved_until: params.reserved_until ?? null,
      p_notes: params.notes ?? null,
      p_destination_location_id: params.destination_location_id ?? null,
      p_last_event_id: params.last_event_id,
    });

    if (error) {
      throw AppError.internal(`Failed to create reservation: ${error.message}`);
    }

    return data as string;
  },

  /**
   * Find available assets for serialized reservation
   */
  async findAvailableAssets(params: {
    catalog_item_id: string;
    location_id?: string | null;
    reserved_from?: string | null;
    reserved_until?: string | null;
  }) {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_find_available_assets', {
      p_tenant_id: tenantId,
      p_catalog_item_id: params.catalog_item_id,
      p_location_id: params.location_id ?? null,
      p_reserved_from: params.reserved_from ?? null,
      p_reserved_until: params.reserved_until ?? null,
    });

    if (error) {
      throw AppError.internal(`Failed to fetch available assets: ${error.message}`);
    }

    return data as Array<{
      asset_id: string;
      asset_tag: string;
      serial_number: string | null;
      location_id: string | null;
      location_name: string | null;
      is_available: boolean;
    }>;
  },

  /**
   * Fulfill reservation via RPC
   */
  async fulfillReservation(reservationId: string, lastEventId: string) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_fulfill_reservation_issue', {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
      p_fulfilled_by_user_id: requireUserId(userId),
      p_last_event_id: lastEventId,
    });

    if (error) {
      throw AppError.internal(`Failed to fulfill reservation: ${error.message}`);
    }

    return data as string;
  },

  /**
   * Release reservation via RPC
   */
  async releaseReservation(reservationId: string, lastEventId: string) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_release_reservation', {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
      p_cancelled_by_user_id: requireUserId(userId),
      p_last_event_id: lastEventId,
    });

    if (error) {
      throw AppError.internal(`Failed to release reservation: ${error.message}`);
    }

    return data as boolean;
  },

  /**
   * Undo fulfill reservation via RPC
   */
  async undoFulfillReservation(reservationId: string, lastEventId: string) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_undo_fulfill_reservation', {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
      p_user_id: requireUserId(userId),
      p_last_event_id: lastEventId,
    });

    if (error) {
      throw AppError.internal(`Failed to undo fulfillment: ${error.message}`);
    }

    return data as boolean;
  },

  /**
   * Undo release reservation via RPC
   */
  async undoReleaseReservation(reservationId: string, lastEventId: string) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_undo_release_reservation', {
      p_tenant_id: tenantId,
      p_reservation_id: reservationId,
      p_user_id: requireUserId(userId),
      p_last_event_id: lastEventId,
    });

    if (error) {
      throw AppError.internal(`Failed to undo release: ${error.message}`);
    }

    return data as boolean;
  },

  /**
   * Get transfers with lines and locations
   */
  async getTransfers(filters?: { status?: string }): Promise<TransferWithRelations[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('transfers')
      .select(
        'id, status, notes, created_at, initiated_at, completed_at, cancelled_at, last_event_id, from_location:from_location_id(id, name, location_type:location_type_id(name)), to_location:to_location_id(id, name, location_type:location_type_id(name)), transfer_lines(id, catalog_item_id, qty, qty_shipped, qty_received, line_number, last_event_id, catalog_items:catalog_item_id(id, name, sku, tracking_mode))'
      )
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    const { data, error } = await query;
    if (error) {
      throw AppError.internal(`Failed to fetch transfers: ${error.message}`);
    }

    const normalized = (data || []).map((item: any) => ({
      ...item,
      from_location: Array.isArray(item.from_location)
        ? item.from_location[0] ?? null
        : item.from_location ?? null,
      to_location: Array.isArray(item.to_location)
        ? item.to_location[0] ?? null
        : item.to_location ?? null,
      transfer_lines: Array.isArray(item.transfer_lines)
        ? item.transfer_lines.map((line: any) => ({
            ...line,
            catalog_items: Array.isArray(line.catalog_items)
              ? line.catalog_items[0] ?? null
              : line.catalog_items ?? null,
          }))
        : [],
    }));

    return normalized as TransferWithRelations[];
  },

  /**
   * Get single transfer with lines
   */
  async getTransfer(transferId: string): Promise<TransferWithRelations | null> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('transfers')
      .select(
        'id, status, notes, created_at, initiated_at, completed_at, cancelled_at, last_event_id, from_location:from_location_id(id, name, location_type:location_type_id(name)), to_location:to_location_id(id, name, location_type:location_type_id(name)), transfer_lines(id, catalog_item_id, qty, qty_shipped, qty_received, line_number, last_event_id, catalog_items:catalog_item_id(id, name, sku, tracking_mode))'
      )
      .eq('id', transferId)
      .maybeSingle();

    if (error) {
      throw AppError.internal(`Failed to fetch transfer: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    const normalized = {
      ...data,
      from_location: Array.isArray((data as any).from_location)
        ? (data as any).from_location[0] ?? null
        : (data as any).from_location ?? null,
      to_location: Array.isArray((data as any).to_location)
        ? (data as any).to_location[0] ?? null
        : (data as any).to_location ?? null,
      transfer_lines: Array.isArray((data as any).transfer_lines)
        ? (data as any).transfer_lines.map((line: any) => ({
            ...line,
            catalog_items: Array.isArray(line.catalog_items)
              ? line.catalog_items[0] ?? null
              : line.catalog_items ?? null,
          }))
        : [],
    };

    return normalized as TransferWithRelations;
  },

  /**
   * Create transfer via RPC
   */
  async createTransfer(params: { from_location_id: string; to_location_id: string; notes?: string | null; lines: Array<{ catalog_item_id: string; qty: number; asset_ids?: string[] }> }) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_transfer_create', {
      p_tenant_id: tenantId,
      p_from_location_id: params.from_location_id,
      p_to_location_id: params.to_location_id,
      p_lines: params.lines,
      p_initiated_by_user_id: requireUserId(userId),
      p_notes: params.notes ?? null,
      p_last_event_id: crypto.randomUUID(),
    });

    if (error) {
      throw AppError.internal(`Failed to create transfer: ${error.message}`);
    }

    return data as string;
  },

  /**
   * Update transfer and lines with optimistic concurrency control
   */
  async updateTransfer(transferId: string, transferLastEventId: string, payload: TransferUpdatePayload) {
    const supabase = createBrowserAuthedClient().schema('inventory');

    const { data: header, error: headerError } = await supabase
      .from('transfers')
      .update({
        from_location_id: payload.from_location_id,
        to_location_id: payload.to_location_id,
        notes: payload.notes,
      })
      .eq('id', transferId)
      .eq('last_event_id', transferLastEventId)
      .select('id')
      .single();

    if (headerError) {
      throw AppError.internal(`Failed to update transfer: ${headerError.message}`);
    }
    if (!header) {
      throw AppError.conflict('Transfer was updated by someone else. Please refresh and try again.');
    }

    const { data: existingLines, error: existingError } = await supabase
      .from('transfer_lines')
      .select('id, last_event_id')
      .eq('transfer_id', transferId);

    if (existingError) {
      throw AppError.internal(`Failed to load transfer lines: ${existingError.message}`);
    }

    const existing = existingLines || [];
    const incomingIds = new Set(payload.lines.filter(line => line.id).map(line => line.id as string));

    for (const line of existing) {
      if (!incomingIds.has(line.id)) {
        const { error: deleteError } = await supabase
          .from('transfer_lines')
          .delete()
          .eq('id', line.id)
          .eq('last_event_id', line.last_event_id);

        if (deleteError) {
          throw AppError.internal(`Failed to delete transfer line: ${deleteError.message}`);
        }
      }
    }

    for (let index = 0; index < payload.lines.length; index += 1) {
      const line = payload.lines[index];
      const lineNumber = index + 1;

      if (line.id) {
        if (!line.last_event_id) {
          throw AppError.badRequest('Missing last_event_id for transfer line. Please refresh and try again.');
        }

        const { error: lineError } = await supabase
          .from('transfer_lines')
          .update({
            catalog_item_id: line.catalog_item_id,
            qty: line.qty,
            line_number: lineNumber,
          })
          .eq('id', line.id)
          .eq('last_event_id', line.last_event_id);

        if (lineError) {
          throw AppError.internal(`Failed to update transfer line: ${lineError.message}`);
        }
      } else {
        const { error: insertError } = await supabase
          .from('transfer_lines')
          .insert({
            transfer_id: transferId,
            catalog_item_id: line.catalog_item_id,
            qty: line.qty,
            line_number: lineNumber,
            last_event_id: crypto.randomUUID(),
          });

        if (insertError) {
          throw AppError.internal(`Failed to add transfer line: ${insertError.message}`);
        }
      }
    }
  },

  /**
   * Ship transfer (draft -> in_transit)
   */
  async shipTransfer(transferId: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');

    const { data: lines, error: lineError } = await supabase
      .from('transfer_lines')
      .select('id, qty, last_event_id')
      .eq('transfer_id', transferId);

    if (lineError) {
      throw AppError.internal(`Failed to load transfer lines: ${lineError.message}`);
    }

    if (!lines || lines.length === 0) {
      throw AppError.notFound('No transfer lines found. Please refresh and try again.');
    }

    for (const line of lines) {
      const { error: updateError } = await supabase
        .from('transfer_lines')
        .update({ qty_shipped: line.qty })
        .eq('id', line.id)
        .eq('last_event_id', line.last_event_id);

      if (updateError) {
        throw AppError.internal(`Failed to ship transfer line: ${updateError.message}`);
      }
    }

    const { data, error } = await supabase
      .from('transfers')
      .update({ status: 'in_transit', initiated_at: new Date().toISOString() })
      .eq('id', transferId)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to ship transfer: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Transfer was updated by someone else. Please refresh and try again.');
    }
  },

  /**
   * Receive transfer fully via RPC
   * Returns jsonb with guardrail support (success/error structure)
   */
  async receiveTransferFull(transferId: string, overrideReason?: string): Promise<{
    success: boolean;
    error?: GuardrailError;
    transfer_id?: string;
    transfer_number?: string;
    override_logged?: boolean;
  }> {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_transfer_execute', {
      p_tenant_id: tenantId,
      p_transfer_id: transferId,
      p_received_by_user_id: requireUserId(userId),
      p_last_event_id: crypto.randomUUID(),
      p_override_reason: overrideReason ?? null,
    });

    if (error) {
      throw AppError.internal(`Failed to receive transfer: ${error.message}`);
    }

    return data as any;
  },

  /**
   * Receive transfer partially via RPC
   */
  async receiveTransferPartial(transferId: string, lineQuantities: Array<{ line_number: number; qty_received: number }>) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_transfer_receive_partial', {
      p_tenant_id: tenantId,
      p_transfer_id: transferId,
      p_received_by_user_id: requireUserId(userId),
      p_line_quantities: lineQuantities,
      p_last_event_id: crypto.randomUUID(),
    });

    if (error) {
      throw AppError.internal(`Failed to receive transfer: ${error.message}`);
    }

    return data as boolean;
  },

  /**
   * Cancel transfer (draft -> cancelled)
   */
  async cancelTransfer(transferId: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('transfers')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', transferId)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to cancel transfer: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Transfer was updated by someone else. Please refresh and try again.');
    }
  },

  /**
   * Undo cancel transfer via RPC
   */
  async undoCancelTransfer(transferId: string) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_transfer_undo_cancel', {
      p_tenant_id: tenantId,
      p_transfer_id: transferId,
      p_user_id: requireUserId(userId),
      p_last_event_id: crypto.randomUUID(),
    });

    if (error) {
      throw AppError.internal(`Failed to undo cancellation: ${error.message}`);
    }

    return data as boolean;
  },

  /**
   * Create return transfer via RPC
   */
  async createTransferReversal(transferId: string, notes?: string | null) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_transfer_create_reversal', {
      p_tenant_id: tenantId,
      p_original_transfer_id: transferId,
      p_initiated_by_user_id: requireUserId(userId),
      p_notes: notes ?? null,
      p_last_event_id: crypto.randomUUID(),
    });

    if (error) {
      throw AppError.internal(`Failed to create return transfer: ${error.message}`);
    }

    return data as string;
  },

  /**
   * Undo shipment via RPC
   */
  async undoTransferShipment(transferId: string, reason: string, notes?: string | null) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_transfer_undo_shipment', {
      p_tenant_id: tenantId,
      p_transfer_id: transferId,
      p_undone_by_user_id: requireUserId(userId),
      p_reason: reason,
      p_notes: notes ?? null,
      p_last_event_id: crypto.randomUUID(),
    });

    if (error) {
      throw AppError.internal(`Failed to undo shipment: ${error.message}`);
    }

    return data as boolean;
  },

  /**
   * Reverse receipt via RPC
   */
  async reverseTransferReceipt(transferId: string, reason: string, notes?: string | null) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_transfer_reverse_receipt', {
      p_tenant_id: tenantId,
      p_transfer_id: transferId,
      p_reversed_by_user_id: requireUserId(userId),
      p_reason: reason,
      p_notes: notes ?? null,
      p_last_event_id: crypto.randomUUID(),
    });

    if (error) {
      throw AppError.internal(`Failed to reverse receipt: ${error.message}`);
    }

    return data as boolean;
  },

  /**
   * Get items with stock at location
   */
  async getItemsAtLocation(locationId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data: stockData, error: stockError } = await supabase
      .from('stock_balances')
      .select('catalog_item_id, qty_available, catalog_items:catalog_item_id(id, name, sku, uom_term_id, tracking_mode)')
      .eq('location_id', locationId)
      .gt('qty_available', 0)
      .order('name', { foreignTable: 'catalog_items' });

    if (stockError) {
      throw AppError.internal(`Failed to load location stock: ${stockError.message}`);
    }

    const { data: assetData, error: assetError } = await supabase
      .from('assets')
      .select('catalog_item_id, catalog_item:catalog_item_id(id, name, sku, uom_term_id, tracking_mode)')
      .eq('location_id', locationId)
      .in('status', ['available', 'assigned']);

    if (assetError) {
      throw AppError.internal(`Failed to load location assets: ${assetError.message}`);
    }

    const assetCounts = new Map<string, { count: number; catalog_item: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'uom_term_id' | 'tracking_mode'> | null }>();
    (assetData || []).forEach((row) => {
      const catalogItemId = row.catalog_item_id as string | null;
      if (!catalogItemId) return;
      const catalogItem = Array.isArray((row as any).catalog_item)
        ? (row as any).catalog_item[0] ?? null
        : (row as any).catalog_item ?? null;
      const existing = assetCounts.get(catalogItemId);
      assetCounts.set(catalogItemId, {
        count: (existing?.count || 0) + 1,
        catalog_item: (catalogItem || existing?.catalog_item || null) as Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'uom_term_id' | 'tracking_mode'> | null,
      });
    });

    const serializedRows = Array.from(assetCounts.entries()).map(([catalogItemId, data]) => ({
      catalog_item_id: catalogItemId,
      qty_available: data.count,
      asset_count: data.count,
      catalog_items: data.catalog_item,
    }));

    const merged = new Map<string, {
      catalog_item_id: string;
      qty_available: number | null;
      asset_count?: number | null;
      catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'uom_term_id' | 'tracking_mode'> | null;
    }>();

    (stockData || []).forEach((row) => {
      const catalogItems = Array.isArray((row as any).catalog_items)
        ? (row as any).catalog_items[0] ?? null
        : (row as any).catalog_items ?? null;
      merged.set(row.catalog_item_id, {
        catalog_item_id: row.catalog_item_id,
        qty_available: row.qty_available,
        asset_count: null,
        catalog_items: catalogItems as Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'uom_term_id' | 'tracking_mode'> | null,
      });
    });

    serializedRows.forEach((row) => {
      if (!row.catalog_item_id) {
        return;
      }
      const key = row.catalog_item_id;
      if (merged.has(key)) {
        const existing = merged.get(key);
        if (!existing) {
          merged.set(key, row as {
            catalog_item_id: string;
            qty_available: number | null;
            asset_count?: number | null;
            catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'uom_term_id' | 'tracking_mode'> | null;
          });
          return;
        }
        merged.set(key, {
          ...existing,
          catalog_item_id: key,
          asset_count: row.asset_count ?? existing?.asset_count ?? null,
        });
      } else {
        merged.set(key, row as {
          catalog_item_id: string;
          qty_available: number | null;
          asset_count?: number | null;
          catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'uom_term_id' | 'tracking_mode'> | null;
        });
      }
    });

    return Array.from(merged.values()).sort((a, b) =>
      (a.catalog_items?.name || '').localeCompare(b.catalog_items?.name || '')
    ) as Array<{
      catalog_item_id: string;
      qty_available: number | null;
      asset_count?: number | null;
      catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'uom_term_id' | 'tracking_mode'> | null;
    }>;
  },

  /**
   * Get assets at a location for transfer selection
   */
  async getAssetsForTransfer(params: { location_id: string; catalog_item_id: string }) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('assets')
      .select('id, asset_tag, serial_number, status, location_id')
      .eq('location_id', params.location_id)
      .eq('catalog_item_id', params.catalog_item_id)
      .in('status', ['available', 'assigned'])
      .order('asset_tag');

    if (error) {
      throw AppError.internal(`Failed to load assets for transfer: ${error.message}`);
    }

    return (data || []) as Array<{
      id: string;
      asset_tag: string;
      serial_number: string | null;
      status: string | null;
      location_id: string | null;
    }>;
  },

  /**
   * Get stock movements
   */
  async getStockMovements(filters?: { catalog_item_id?: string; location_id?: string; movement_type?: string; movement_state?: string }): Promise<StockMovementWithRelations[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('stock_movements')
      .select('id, catalog_item_id, location_id, quantity_delta, movement_type, posting_status, reason, source_ref_type, source_ref_id, reversal_ref_id, occurred_at, created_at, last_event_id, catalog_items:catalog_item_id(id, name, sku), locations:location_id(id, name)')
      .order('created_at', { ascending: false });

    if (filters?.catalog_item_id) {
      query = query.eq('catalog_item_id', filters.catalog_item_id);
    }
    if (filters?.location_id) {
      query = query.eq('location_id', filters.location_id);
    }
    if (filters?.movement_type) {
      query = query.eq('movement_type', filters.movement_type);
    }
    if (filters?.movement_state) {
      query = query.eq('posting_status', filters.movement_state);
    }

    const { data, error } = await query;
    if (error) {
      throw AppError.internal(`Failed to fetch stock movements: ${error.message}`);
    }

    const normalized = (data || []).map((item: any) => ({
      ...item,
      catalog_items: Array.isArray(item.catalog_items)
        ? item.catalog_items[0] ?? null
        : item.catalog_items ?? null,
      locations: Array.isArray(item.locations)
        ? item.locations[0] ?? null
        : item.locations ?? null,
    }));

    return normalized as StockMovementWithRelations[];
  },

  /**
   * Get inventory events
   * Table: inventory.inventory_events
   */
  async getInventoryEvents(filters?: {
    event_type?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<Array<{
    id: string;
    tenant_id: string;
    event_type: string;
    occurred_at: string;
    actor_user_id: string | null;
    source_system: string | null;
    payload: any;
    created_at: string;
  }>> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('inventory_events')
      .select('id, tenant_id, event_type, occurred_at, actor_user_id, source_system, payload, created_at')
      .order('occurred_at', { ascending: false })
      .limit(200);

    if (filters?.event_type) {
      query = query.eq('event_type', filters.event_type);
    }
    if (filters?.start_date) {
      query = query.gte('occurred_at', filters.start_date);
    }
    if (filters?.end_date) {
      query = query.lte('occurred_at', filters.end_date);
    }

    const { data, error } = await query;
    if (error) {
      throw AppError.internal(`Failed to fetch inventory events: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Reverse stock movement via RPC
   */
  async reverseStockMovement(movementId: string, reason: string) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_reverse_stock_movement', {
      p_tenant_id: tenantId,
      p_movement_id: movementId,
      p_reason: reason,
      p_user_id: userId,
      p_last_event_id: crypto.randomUUID(),
    });

    if (error) {
      throw AppError.internal(`Failed to reverse movement: ${error.message}`);
    }

    return data as string;
  },

  /**
   * Get locations
   * Table: inventory.locations
   */
  async getLocations(filters?: {
    type?: string;
    active?: boolean;
  }): Promise<LocationWithType[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('locations')
      .select('*, location_type:location_type_id(name), last_event_id')
      .order('name');

    if (filters?.type) {
      query = query.eq('location_type_id', filters.type);
    }
    if (filters?.active !== undefined) {
      query = query.eq('active', filters.active);
    }

    const { data, error } = await query;

    if (error) {
      throw AppError.internal(`Failed to fetch locations: ${error.message}`);
    }

    return (data || []) as LocationWithType[];
  },

  /**
   * Create a location
   * Table: inventory.locations
   */
  async createLocation(
    payload: LocationInsertPayload
  ) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const insertPayload: LocationInsertPayload = {
      ...payload,
      last_event_id: payload.last_event_id ?? crypto.randomUUID(),
    };

    const { data, error } = await supabase
      .from('locations')
      .insert(insertPayload)
      .select('*, location_type:location_type_id(name), last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to create location: ${error.message}`);
    }

    return data;
  },

  /**
   * Update a location with optimistic concurrency control
   */
  async updateLocation(id: string, updates: LocationUpdatePayload, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { id: _id, created_at, tenant_id, last_event_id, location_type, ...restUpdates } = updates as LocationUpdatePayload & {
      id?: string;
      created_at?: string;
      tenant_id?: string;
      last_event_id?: string;
      location_type?: unknown;
    };
    const safeUpdates =
      typeof location_type === 'string'
        ? { ...restUpdates, location_type }
        : { ...restUpdates };

    const { data, error } = await supabase
      .from('locations')
      .update({ ...safeUpdates })
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('*, location_type:location_type_id(name), last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to update location: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Location was updated by someone else. Please refresh and try again.');
    }

    return data;
  },

  /**
   * Delete a location with optimistic concurrency control
   */
  async deleteLocation(id: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('locations')
      .delete()
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to delete location: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Location was updated by someone else. Please refresh and try again.');
    }

    return data;
  },

  /**
   * Get stock balances
   * Table: inventory.stock_balances (read model)
   */
  async getStockBalances(filters?: {
    location_id?: string;
    catalog_item_id?: string;
    min_available?: number;
  }) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('stock_balances')
      .select(`
        *,
        catalog_items:catalog_item_id(name, sku, uom_term_id, reorder_point),
        locations:location_id(name)
      `)
      .order('catalog_items(name)');

    if (filters?.location_id) {
      query = query.eq('location_id', filters.location_id);
    }
    if (filters?.catalog_item_id) {
      query = query.eq('catalog_item_id', filters.catalog_item_id);
    }
    if (filters?.min_available !== undefined) {
      query = query.gte('qty_available', filters.min_available);
    }

    const { data, error } = await query;

    if (error) {
      throw AppError.internal(`Failed to fetch stock balances: ${error.message}`);
    }

    return data;
  },

  /**
   * Get low stock items
   * View: inventory.mv_low_stock_summary (materialized view)
   */
  async getLowStockItems() {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('mv_low_stock_summary')
      .select('*')
      .order('total_available');

    if (error) {
      throw AppError.internal(`Failed to fetch low stock items: ${error.message}`);
    }

    return data;
  },

  /**
   * Get inventory summary
   * View: inventory.mv_inventory_summary (materialized view)
   */
  async getInventorySummary() {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('mv_inventory_summary')
      .select('*')
      .single();

    if (error) {
      throw AppError.internal(`Failed to fetch inventory summary: ${error.message}`);
    }

    return data;
  },

  /**
   * Get reservation types (global + tenant)
   */
  async getReservationTypes(options?: { includeInactive?: boolean }) {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('reservation_types')
      .select('id, tenant_id, type_key, display_name, is_system, is_active, sort_order, description, last_event_id, created_at, updated_at')
      .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
      .order('sort_order')
      .order('display_name');

    if (!options?.includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) {
      throw AppError.internal(`Failed to fetch reservation types: ${error.message}`);
    }

    return (data || []) as ReservationTypeRow[];
  },

  /**
   * Create reservation type
   */
  async createReservationType(payload: {
    type_key: string;
    display_name: string;
    description?: string | null;
    sort_order?: number;
    is_active?: boolean;
  }) {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const insertPayload = {
      tenant_id: tenantId,
      type_key: payload.type_key,
      display_name: payload.display_name,
      description: payload.description ?? null,
      sort_order: payload.sort_order ?? 0,
      is_active: payload.is_active ?? true,
      last_event_id: crypto.randomUUID(),
    };

    const { data, error } = await supabase
      .from('reservation_types')
      .insert(insertPayload)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to create reservation type: ${error.message}`);
    }

    return data as Pick<ReservationTypeRow, 'id' | 'last_event_id'>;
  },

  /**
   * Update reservation type
   */
  async updateReservationType(id: string, updates: {
    display_name?: string;
    description?: string | null;
    sort_order?: number;
    is_active?: boolean;
  }) {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const updatePayload = {
      ...updates,
      last_event_id: crypto.randomUUID(),
    };

    const { data, error } = await supabase
      .from('reservation_types')
      .update(updatePayload)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to update reservation type: ${error.message}`);
    }

    return data as Pick<ReservationTypeRow, 'id' | 'last_event_id'>;
  },

  /**
   * Delete reservation type
   */
  async deleteReservationType(id: string) {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('reservation_types')
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to delete reservation type: ${error.message}`);
    }

    return data as Pick<ReservationTypeRow, 'id'>;
  },

  // ==========================================================================
  // Feature Expansion: New RPC Methods
  // ==========================================================================

  /**
   * Get UOM conversions
   * Table: inventory.uom_conversions
   */
  async getUomConversions(): Promise<Array<{
    id: string;
    from_uom_term_id: string;
    to_uom_term_id: string;
    conversion_factor: number;
    is_bidirectional: boolean;
    last_event_id: string;
    created_at: string;
  }>> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('uom_conversions')
      .select('id, from_uom_term_id, to_uom_term_id, conversion_factor, is_bidirectional, last_event_id, created_at')
      .order('from_uom_term_id');

    if (error) {
      throw AppError.internal(`Failed to fetch UOM conversions: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Create a UOM conversion
   * Table: inventory.uom_conversions
   */
  async createUomConversion(payload: {
    from_uom_term_id: string;
    to_uom_term_id: string;
    conversion_factor: number;
    is_bidirectional?: boolean;
  }) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const insertPayload = {
      from_uom_term_id: payload.from_uom_term_id,
      to_uom_term_id: payload.to_uom_term_id,
      conversion_factor: payload.conversion_factor,
      is_bidirectional: payload.is_bidirectional ?? true,
      last_event_id: crypto.randomUUID(),
    };

    const { data, error } = await supabase
      .from('uom_conversions')
      .insert(insertPayload)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to create UOM conversion: ${error.message}`);
    }

    return data as { id: string; last_event_id: string };
  },

  /**
   * Delete a UOM conversion with OCC
   */
  async deleteUomConversion(id: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('uom_conversions')
      .delete()
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to delete UOM conversion: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('UOM conversion was updated by someone else. Please refresh and try again.');
    }

    return data as { id: string };
  },

  /**
   * Convert UOM quantity via RPC
   */
  async convertUom(qty: number, fromUom: string, toUom: string): Promise<number> {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('convert_uom', {
      p_tenant_id: tenantId,
      p_qty: qty,
      p_from_uom_term_id: fromUom,
      p_to_uom_term_id: toUom,
    });

    if (error) {
      throw AppError.internal(`Failed to convert UOM: ${error.message}`);
    }

    return data as number;
  },

  /**
   * Get dead stock report
   * View: inventory.v_dead_stock_report
   */
  async getDeadStockReport(options?: { minDays?: number; agingStatus?: string }): Promise<Array<{
    catalog_item_id: string;
    sku: string;
    item_name: string;
    location_id: string;
    location_name: string;
    qty_on_hand: number;
    capital_locked: number;
    last_movement_at: string | null;
    days_since_movement: number;
    aging_status: string;
  }>> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('v_dead_stock_report')
      .select('*')
      .order('days_since_movement', { ascending: false });

    if (options?.minDays) {
      query = query.gte('days_since_movement', options.minDays);
    }
    if (options?.agingStatus) {
      query = query.eq('aging_status', options.agingStatus);
    }

    const { data, error } = await query;

    if (error) {
      throw AppError.internal(`Failed to fetch dead stock report: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Get item velocity data
   * Materialized view: inventory.mv_item_velocity
   */
  async getItemVelocity(catalogItemId?: string): Promise<Array<{
    catalog_item_id: string;
    location_id: string;
    usage_30d: number;
    usage_60d: number;
    usage_90d: number;
    daily_rate_30d: number;
    days_of_stock: number | null;
    qty_available: number;
    refreshed_at: string;
  }>> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('mv_item_velocity')
      .select('*')
      .order('daily_rate_30d', { ascending: false });

    if (catalogItemId) {
      query = query.eq('catalog_item_id', catalogItemId);
    }

    const { data, error } = await query;

    if (error) {
      throw AppError.internal(`Failed to fetch item velocity: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Get replenishment suggestions
   * RPC: inventory.get_replenishment_suggestions
   */
  async getReplenishmentSuggestions(): Promise<Array<{
    catalog_item_id: string;
    sku: string;
    item_name: string;
    location_id: string;
    location_name: string;
    qty_available: number;
    daily_rate: number;
    days_of_stock: number | null;
    lead_time_days: number | null;
    reorder_point: number | null;
    suggested_order_qty: number;
    urgency: string;
    preferred_vendor_id: string | null;
    preferred_vendor_name: string | null;
  }>> {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('get_replenishment_suggestions', {
      p_tenant_id: tenantId,
    });

    if (error) {
      throw AppError.internal(`Failed to fetch replenishment suggestions: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Get transfer suggestions
   * RPC: inventory.get_transfer_suggestions
   */
  async getTransferSuggestions(): Promise<Array<{
    catalog_item_id: string;
    sku: string;
    item_name: string;
    from_location_id: string;
    from_location_name: string;
    from_qty_available: number;
    to_location_id: string;
    to_location_name: string;
    to_qty_available: number;
    to_reorder_point: number;
    suggested_qty: number;
    reason: string;
  }>> {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('get_transfer_suggestions', {
      p_tenant_id: tenantId,
    });

    if (error) {
      throw AppError.internal(`Failed to fetch transfer suggestions: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Get cycle count suggestions
   * RPC: inventory.get_cycle_count_suggestions
   */
  async getCycleCountSuggestions(limit?: number): Promise<Array<{
    catalog_item_id: string;
    sku: string;
    item_name: string;
    location_id: string;
    location_name: string;
    priority_score: number;
    abc_class: string;
    days_since_last_count: number;
    last_variance_pct: number;
    movement_frequency: number;
    reasons: string[];
  }>> {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('get_cycle_count_suggestions', {
      p_tenant_id: tenantId,
      p_limit: limit ?? 20,
    });

    if (error) {
      throw AppError.internal(`Failed to fetch cycle count suggestions: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Get ledger with running balance
   * RPC: inventory.get_ledger_with_running_balance
   */
  async getLedgerWithBalance(catalogItemId: string, locationId: string, limit?: number): Promise<Array<{
    movement_id: string;
    occurred_at: string;
    movement_type: string;
    quantity_delta: number;
    qty_before: number;
    qty_after: number;
    reason: string | null;
    source_ref_type: string | null;
    source_ref_id: string | null;
    posting_status: string;
    created_by_user_id: string | null;
    last_event_id: string;
  }>> {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('get_ledger_with_running_balance', {
      p_tenant_id: tenantId,
      p_catalog_item_id: catalogItemId,
      p_location_id: locationId,
      p_limit: limit ?? 100,
    });

    if (error) {
      throw AppError.internal(`Failed to fetch ledger with running balance: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Get inventory forecast
   * View: inventory.v_inventory_forecast
   */
  async getInventoryForecast(): Promise<Array<{
    catalog_item_id: string;
    sku: string;
    item_name: string;
    total_on_hand: number;
    total_reserved: number;
    total_available: number;
    qty_incoming_po: number;
    future_demand: number;
    net_position: number;
  }>> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('v_inventory_forecast')
      .select('*')
      .order('net_position');

    if (error) {
      throw AppError.internal(`Failed to fetch inventory forecast: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Get location utilization
   * View: inventory.v_location_utilization
   */
  async getLocationUtilization(): Promise<Array<{
    location_id: string;
    location_name: string;
    location_type: string | null;
    max_capacity: number | null;
    capacity_uom_term_id: string | null;
    current_qty: number;
    utilization_pct: number | null;
    is_over_capacity: boolean;
    active: boolean;
  }>> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('v_location_utilization')
      .select('*')
      .order('utilization_pct', { ascending: false, nullsFirst: false });

    if (error) {
      throw AppError.internal(`Failed to fetch location utilization: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Check reservation availability
   * RPC: inventory.check_reservation_availability
   */
  async checkReservationAvailability(itemId: string, locationId: string, qty: number): Promise<{
    available: boolean;
    qty_available: number;
    qty_after_reserve: number;
    conflicts: Array<{
      reservation_id: string;
      qty: number;
      commitment_level: string;
      allocation_type: string | null;
      needed_by: string | null;
      job_ref: any;
    }>;
  }> {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('check_reservation_availability', {
      p_tenant_id: tenantId,
      p_catalog_item_id: itemId,
      p_location_id: locationId,
      p_qty: qty,
    });

    if (error) {
      throw AppError.internal(`Failed to check reservation availability: ${error.message}`);
    }

    return data as any;
  },

  /**
   * Get negative inventory config
   * Table: inventory.negative_inventory_config
   */
  async getNegativeInventoryConfig(): Promise<Array<{
    id: string;
    scope: string;
    category_id: string | null;
    catalog_item_id: string | null;
    allow_negative: boolean;
    last_event_id: string;
    created_at: string;
    updated_at: string;
  }>> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('negative_inventory_config')
      .select('id, scope, category_id, catalog_item_id, allow_negative, last_event_id, created_at, updated_at')
      .order('scope');

    if (error) {
      throw AppError.internal(`Failed to fetch negative inventory config: ${error.message}`);
    }

    return (data || []) as any[];
  },

  /**
   * Upsert negative inventory config
   * Table: inventory.negative_inventory_config
   */
  async upsertNegativeInventoryConfig(payload: {
    scope: 'global' | 'category' | 'item';
    category_id?: string | null;
    catalog_item_id?: string | null;
    allow_negative: boolean;
  }) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const insertPayload = {
      scope: payload.scope,
      category_id: payload.category_id ?? null,
      catalog_item_id: payload.catalog_item_id ?? null,
      allow_negative: payload.allow_negative,
      last_event_id: crypto.randomUUID(),
    };

    const { data, error } = await supabase
      .from('negative_inventory_config')
      .upsert(insertPayload, {
        onConflict: 'tenant_id,scope,COALESCE(category_id,\'00000000-0000-0000-0000-000000000000\'::uuid),COALESCE(catalog_item_id,\'00000000-0000-0000-0000-000000000000\'::uuid)',
      })
      .select('id, last_event_id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to save negative inventory config: ${error.message}`);
    }

    return data as { id: string; last_event_id: string };
  },

  /**
   * Delete negative inventory config with OCC
   */
  async deleteNegativeInventoryConfig(id: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('negative_inventory_config')
      .delete()
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw AppError.internal(`Failed to delete negative inventory config: ${error.message}`);
    }
    if (!data) {
      throw AppError.conflict('Config was updated by someone else. Please refresh and try again.');
    }

    return data as { id: string };
  },

  /**
   * Auto-create draft PO from reorder alert
   * RPC: inventory.auto_create_draft_po
   */
  async autoCreateDraftPO(alertId: string): Promise<string | null> {
    const { tenantId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('auto_create_draft_po', {
      p_alert_id: alertId,
      p_tenant_id: tenantId,
    });

    if (error) {
      throw AppError.internal(`Failed to auto-create draft PO: ${error.message}`);
    }

    return data as string | null;
  },

  /**
   * Wizard: Create item with optional inline dependencies + initial stock
   * RPC: inventory.rpc_wizard_create_item
   *
   * Atomic transaction: creates category/vendor/location/item/stock in one call.
   * Idempotent via idempotency_key.
   */
  async wizardCreateItem(params: {
    name: string;
    description?: string | null;
    uom_term_id?: string | null;
    tracking_mode?: string;
    reorder_point?: number | null;
    base_sku?: string | null;
    sku?: string | null;
    category_id?: string | null;
    create_category?: {
      name: string;
      sku_prefix?: string | null;
      sku_mode?: string;
      parent_category_id?: string | null;
    } | null;
    vendor_id?: string | null;
    create_vendor?: {
      name: string;
      code?: string | null;
      contact_name?: string | null;
      contact_email?: string | null;
      contact_phone?: string | null;
      payment_terms?: string;
      lead_time_days?: number | null;
    } | null;
    vendor_sku?: string | null;
    vendor_unit_cost?: number | null;
    location_id?: string | null;
    create_location?: {
      name: string;
      location_type_id: string;
      address?: string | null;
    } | null;
    initial_qty?: number | null;
    initial_cost?: number | null;
    barcode?: string | null;
    create_assets?: Array<{ asset_tag: string; serial_number?: string }> | null;
    has_variants?: boolean;
    variant_dimensions?: string[] | null;
    variant_options?: Record<string, string[]> | null;
    idempotency_key: string;
  }): Promise<{
    success: boolean;
    idempotent_hit: boolean;
    item_id: string;
    item_sku: string;
    item_barcode?: string;
    category_id: string | null;
    vendor_id: string | null;
    location_id: string | null;
    created_asset_tags?: string[];
    created_entities: Array<{
      type: string;
      id?: string;
      name?: string;
      sku?: string;
      location_id?: string;
      quantity?: number;
      unit_cost?: number | null;
    }>;
  }> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_wizard_create_item', {
      p_name: params.name,
      p_description: params.description ?? null,
      p_uom_term_id: params.uom_term_id ?? null,
      p_tracking_mode: params.tracking_mode ?? 'stock',
      p_reorder_point: params.reorder_point ?? null,
      p_base_sku: params.base_sku ?? null,
      p_sku: params.sku ?? null,
      p_category_id: params.category_id ?? null,
      p_create_category: params.create_category ?? null,
      p_vendor_id: params.vendor_id ?? null,
      p_create_vendor: params.create_vendor ?? null,
      p_vendor_sku: params.vendor_sku ?? null,
      p_vendor_unit_cost: params.vendor_unit_cost ?? null,
      p_location_id: params.location_id ?? null,
      p_create_location: params.create_location ?? null,
      p_initial_qty: params.initial_qty ?? null,
      p_initial_cost: params.initial_cost ?? null,
      p_barcode: params.barcode ?? null,
      p_create_assets: params.create_assets ? JSON.stringify(params.create_assets) : null,
      p_has_variants: params.has_variants ?? false,
      p_variant_dimensions: params.variant_dimensions ?? null,
      p_variant_options: params.variant_options ?? null,
      p_idempotency_key: params.idempotency_key,
    });

    if (error) {
      throw AppError.internal(`Failed to create item via wizard: ${error.message}`);
    }

    return data as any;
  },

  // ─── Global Search & Stock Snapshots ─────────────────────────────────

  /**
   * Global search across items, assets, locations, vendors, POs, reservations.
   * RPC: inventory.rpc_global_search
   */
  async globalSearch(query: string, limit: number = 5): Promise<{
    items: Array<{ id: string; name: string; sku: string; url_hint: string }>;
    assets: Array<{ id: string; tag: string; serial_number: string | null; status: string; url_hint: string }>;
    locations: Array<{ id: string; name: string; address: string | null; url_hint: string }>;
    vendors: Array<{ id: string; name: string; code: string | null; url_hint: string }>;
    purchase_orders: Array<{ id: string; po_number: string; vendor_name: string | null; status: string; url_hint: string }>;
    reservations: Array<{ id: string; ref: string | null; status: string; qty: number; url_hint: string }>;
  }> {
    if (!query || query.trim().length === 0) {
      return { items: [], assets: [], locations: [], vendors: [], purchase_orders: [], reservations: [] };
    }
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_global_search', {
      p_query: query.trim(),
      p_limit: limit,
    });

    if (error) {
      throw AppError.internal(`Global search failed: ${error.message}`);
    }

    return data as any;
  },

  /**
   * Item stock snapshot: on_hand, reserved, available, inbound, locations breakdown.
   * RPC: inventory.rpc_item_stock_snapshot
   */
  async createItemVariants(parentItemId: string, variants: Array<{
    attributes: Record<string, string>;
    sku_suffix: string;
    barcode?: string;
  }>): Promise<{
    success: boolean;
    parent_item_id: string;
    variant_ids: string[];
    count: number;
  }> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_create_item_variants', {
      p_parent_item_id: parentItemId,
      p_variants: JSON.stringify(variants),
      p_idempotency_key: crypto.randomUUID(),
    });

    if (error) {
      throw AppError.internal(`Failed to create variants: ${error.message}`);
    }

    return data as any;
  },

  async getItemStockSnapshot(catalogItemId: string): Promise<{
    item: {
      id: string;
      name: string;
      sku: string;
      barcode: string | null;
      uom_term_id: string;
      tracking_mode: string;
      reorder_point: number | null;
      category_name: string | null;
      active: boolean;
      last_event_id: string | null;
      is_parent?: boolean;
      parent_item_id?: string | null;
      variant_attributes?: Record<string, string> | null;
      variant_dimensions?: string[] | null;
      variant_options?: Record<string, string[]> | null;
    };
    on_hand: number;
    reserved: number;
    available: number;
    inbound: number;
    locations: Array<{
      location_id: string;
      location_name: string;
      on_hand: number;
      reserved: number;
      available: number;
    }>;
    variants?: Array<{
      variant_id: string;
      variant_name: string;
      variant_sku: string;
      variant_barcode: string | null;
      variant_attributes: Record<string, string>;
      on_hand: number;
      reserved: number;
      available: number;
    }> | null;
    last_movement_at: string | null;
    last_count_at: string | null;
  }> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_item_stock_snapshot', {
      p_catalog_item_id: catalogItemId,
    });

    if (error) {
      throw AppError.internal(`Item stock snapshot failed: ${error.message}`);
    }

    return data as any;
  },

  /**
   * Location inventory snapshot: totals + items at location.
   * RPC: inventory.rpc_location_inventory_snapshot
   */
  async getLocationInventorySnapshot(locationId: string): Promise<{
    location: {
      id: string;
      name: string;
      address: string | null;
      active: boolean;
      location_type: string | null;
      max_capacity: number | null;
      capacity_uom_term_id: string | null;
    };
    totals: {
      on_hand: number;
      reserved: number;
      available: number;
      asset_count: number;
    };
    items: Array<{
      item_id: string;
      item_name: string;
      sku: string | null;
      uom_term_id: string | null;
      on_hand: number;
      reserved: number;
      available: number;
    }>;
    assets: Array<{
      asset_id: string;
      asset_tag: string;
      serial_number: string | null;
      status: string;
      item_id: string | null;
      item_name: string | null;
      sku: string | null;
    }>;
  }> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_location_inventory_snapshot', {
      p_location_id: locationId,
    });

    if (error) {
      throw AppError.internal(`Location inventory snapshot failed: ${error.message}`);
    }

    return data as any;
  },

  // =====================================================
  // Guardrail Policies & Exceptions
  // =====================================================

  /**
   * Get guardrail policies for current tenant
   */
  async getGuardrailPolicies(): Promise<{
    id?: string;
    over_receipt_policy: string;
    over_receipt_threshold_pct: number;
    uom_mismatch_policy: string;
    require_override_reason: boolean;
  } | null> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('guardrail_policies')
      .select('*')
      .maybeSingle();

    if (error) {
      throw AppError.internal(`Failed to fetch guardrail policies: ${error.message}`);
    }

    return data;
  },

  /**
   * Upsert guardrail policies for current tenant
   */
  async upsertGuardrailPolicies(params: {
    over_receipt_policy: string;
    over_receipt_threshold_pct: number;
    uom_mismatch_policy: string;
    require_override_reason: boolean;
  }): Promise<any> {
    const tenantId = getTenantIdFromToken(getStoredAccessToken() || '');
    if (!tenantId) throw AppError.unauthorized('No tenant ID');

    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase
      .from('guardrail_policies')
      .upsert({
        tenant_id: tenantId,
        over_receipt_policy: params.over_receipt_policy,
        over_receipt_threshold_pct: params.over_receipt_threshold_pct,
        uom_mismatch_policy: params.uom_mismatch_policy,
        require_override_reason: params.require_override_reason,
        last_event_id: crypto.randomUUID(),
      }, { onConflict: 'tenant_id' })
      .select()
      .single();

    if (error) {
      throw AppError.internal(`Failed to save guardrail policies: ${error.message}`);
    }

    return data;
  },

  /**
   * Get guardrail exceptions (audit trail) for current tenant
   */
  async getGuardrailExceptions(filters?: {
    context_type?: string;
    rule?: string;
    limit?: number;
  }): Promise<Array<{
    id: string;
    actor_user_id: string | null;
    context_type: string;
    context_id: string;
    rule: string;
    override_reason: string;
    metadata: Record<string, any>;
    created_at: string;
  }>> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('guardrail_exceptions')
      .select('id, actor_user_id, context_type, context_id, rule, override_reason, metadata, created_at')
      .order('created_at', { ascending: false });

    if (filters?.context_type) {
      query = query.eq('context_type', filters.context_type);
    }
    if (filters?.rule) {
      query = query.eq('rule', filters.rule);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }

    const { data, error } = await query;

    if (error) {
      throw AppError.internal(`Failed to fetch guardrail exceptions: ${error.message}`);
    }

    return (data || []) as any;
  },
};
