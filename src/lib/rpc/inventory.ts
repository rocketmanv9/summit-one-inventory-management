/**
 * Inventory RPC Service Layer
 * Bounded Context: Inventory Management (Stock, Movements, Assets)
 * Schema: inventory
 */

import { createBrowserAuthedClient } from '@/supabase/client';
import { getStoredAccessToken, getTenantIdFromToken, getUserIdFromToken } from '@/lib/auth-token';
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
  unit_of_measure: string | null;
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
    throw new Error('Authentication required');
  }

  const tenantId = getTenantIdFromToken(token);
  if (!tenantId) {
    throw new Error('Missing tenant context');
  }

  return {
    tenantId,
    userId: getUserIdFromToken(token),
  };
}

function requireUserId(userId: string | null): string {
  if (!userId) {
    throw new Error('Missing user identity');
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
}

export interface AdjustInventoryResult {
  success: boolean;
  old_qty: number;
  new_qty: number;
  delta: number;
  reason: string;
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
      throw new Error(`Failed to issue inventory: ${error.message}`);
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
    });

    if (error) {
      throw new Error(`Failed to adjust inventory: ${error.message}`);
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
  }): Promise<CatalogItemWithCategory[]> {
    const supabase = createBrowserAuthedClient().schema('inventory');
    let query = supabase
      .from('catalog_items')
      .select(
        'id, name, sku, description, category_id, unit_of_measure, tracking_mode, reorder_point, min_stock_level, max_stock_level, active, base_sku, last_event_id, item_categories(name)'
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

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch catalog items: ${error.message}`);
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
      throw new Error(`Failed to count category items: ${error.message}`);
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
      throw new Error(`Failed to fetch category items for reassignment: ${fetchError.message}`);
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
        throw new Error(`Failed to reassign catalog item ${item.id}: ${error.message}`);
      }
      if (!updated) {
        throw new Error(`Concurrent modification detected on catalog item ${item.id} (OCC conflict)`);
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
      .select('id, name, sku_prefix, sku_mode, parent_category_id, last_event_id, created_at, updated_at')
      .order('name');

    if (error) {
      throw new Error(`Failed to fetch item categories: ${error.message}`);
    }

    return (data || []) as ItemCategoryRow[];
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
      throw new Error(`Failed to create category: ${error.message}`);
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
      throw new Error(`Failed to update category: ${error.message}`);
    }
    if (!data) {
      throw new Error('Category was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to delete category SKU settings: ${skuError.message}`);
    }

    const { data, error } = await supabase
      .from('item_categories')
      .delete()
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to delete category: ${error.message}`);
    }
    if (!data) {
      throw new Error('Category was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to fetch location types: ${error.message}`);
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
      throw new Error(`Failed to create location type: ${error.message}`);
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
      throw new Error(`Failed to delete location type: ${error.message}`);
    }
    if (!data) {
      throw new Error('Location type was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to update location type: ${error.message}`);
    }
    if (!data) {
      throw new Error('Location type was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to fetch SKU settings: ${error.message}`);
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
      throw new Error(`Failed to update SKU settings: ${error.message}`);
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
      p_unit_of_measure: payload.unit_of_measure ?? null,
      p_tracking_mode: payload.tracking_mode ?? null,
      p_reorder_point: payload.reorder_point ?? null,
      p_base_sku: payload.base_sku ?? null,
      p_sku: payload.sku ?? null,
      p_last_event_id: payload.last_event_id ?? crypto.randomUUID(),
    });

    if (error) {
      throw new Error(`Failed to create catalog item: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new Error('Failed to create catalog item: no data returned');
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
      throw new Error(`Failed to update catalog item: ${error.message}`);
    }
    if (!data) {
      throw new Error('Catalog item was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to delete catalog item: ${error.message}`);
    }
    if (!data) {
      throw new Error('Catalog item was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to fetch inventory levels: ${error.message}`);
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
      throw new Error(`Failed to save inventory levels: ${error.message}`);
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
      throw new Error(`Failed to fetch assignment types: ${error.message}`);
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
      throw new Error(`Failed to create assignment type: ${error.message}`);
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
      throw new Error(`Failed to update assignment type: ${error.message}`);
    }
    if (!data) {
      throw new Error('Assignment type was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to delete assignment type: ${error.message}`);
    }
    if (!data) {
      throw new Error('Assignment type was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to fetch assets: ${error.message}`);
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
      throw new Error(`Failed to check existing asset: ${existingError.message}`);
    }

    if (existingAsset && existingAsset.status !== 'retired') {
      throw new Error('An asset with this tag already exists. Edit the existing asset or choose a different tag.');
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
        throw new Error(`Failed to restore asset: ${restoreError.message}`);
      }

      return restored as Pick<AssetRow, 'id' | 'last_event_id'>;
    }

    const { data, error } = await supabase
      .from('assets')
      .insert(insertPayload)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw new Error(`Failed to create asset: ${error.message}`);
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
      throw new Error(`Failed to update asset: ${error.message}`);
    }
    if (!data) {
      throw new Error('Asset was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to delete asset: ${error.message}`);
    }
    if (!data) {
      throw new Error('Asset was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to assign asset: ${error.message}`);
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
      throw new Error(`Failed to return asset: ${error.message}`);
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
      throw new Error(`Failed to fetch reservations: ${error.message}`);
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
      throw new Error(`Failed to create reservation: ${error.message}`);
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
      throw new Error(`Failed to create reservation: ${error.message}`);
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
      throw new Error(`Failed to fetch available assets: ${error.message}`);
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
      throw new Error(`Failed to fulfill reservation: ${error.message}`);
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
      throw new Error(`Failed to release reservation: ${error.message}`);
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
      throw new Error(`Failed to undo fulfillment: ${error.message}`);
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
      throw new Error(`Failed to undo release: ${error.message}`);
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
      throw new Error(`Failed to fetch transfers: ${error.message}`);
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
      throw new Error(`Failed to fetch transfer: ${error.message}`);
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
      throw new Error(`Failed to create transfer: ${error.message}`);
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
      throw new Error(`Failed to update transfer: ${headerError.message}`);
    }
    if (!header) {
      throw new Error('Transfer was updated by someone else. Please refresh and try again.');
    }

    const { data: existingLines, error: existingError } = await supabase
      .from('transfer_lines')
      .select('id, last_event_id')
      .eq('transfer_id', transferId);

    if (existingError) {
      throw new Error(`Failed to load transfer lines: ${existingError.message}`);
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
          throw new Error(`Failed to delete transfer line: ${deleteError.message}`);
        }
      }
    }

    for (let index = 0; index < payload.lines.length; index += 1) {
      const line = payload.lines[index];
      const lineNumber = index + 1;

      if (line.id) {
        if (!line.last_event_id) {
          throw new Error('Missing last_event_id for transfer line. Please refresh and try again.');
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
          throw new Error(`Failed to update transfer line: ${lineError.message}`);
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
          throw new Error(`Failed to add transfer line: ${insertError.message}`);
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
      throw new Error(`Failed to load transfer lines: ${lineError.message}`);
    }

    if (!lines || lines.length === 0) {
      throw new Error('No transfer lines found. Please refresh and try again.');
    }

    for (const line of lines) {
      const { error: updateError } = await supabase
        .from('transfer_lines')
        .update({ qty_shipped: line.qty })
        .eq('id', line.id)
        .eq('last_event_id', line.last_event_id);

      if (updateError) {
        throw new Error(`Failed to ship transfer line: ${updateError.message}`);
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
      throw new Error(`Failed to ship transfer: ${error.message}`);
    }
    if (!data) {
      throw new Error('Transfer was updated by someone else. Please refresh and try again.');
    }
  },

  /**
   * Receive transfer fully via RPC
   */
  async receiveTransferFull(transferId: string) {
    const { tenantId, userId } = getAuthContext();
    const supabase = createBrowserAuthedClient().schema('inventory');
    const { data, error } = await supabase.rpc('rpc_inv_transfer_execute', {
      p_tenant_id: tenantId,
      p_transfer_id: transferId,
      p_received_by_user_id: requireUserId(userId),
      p_last_event_id: crypto.randomUUID(),
    });

    if (error) {
      throw new Error(`Failed to receive transfer: ${error.message}`);
    }

    return data as boolean;
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
      throw new Error(`Failed to receive transfer: ${error.message}`);
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
      throw new Error(`Failed to cancel transfer: ${error.message}`);
    }
    if (!data) {
      throw new Error('Transfer was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to undo cancellation: ${error.message}`);
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
      throw new Error(`Failed to create return transfer: ${error.message}`);
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
      throw new Error(`Failed to undo shipment: ${error.message}`);
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
      throw new Error(`Failed to reverse receipt: ${error.message}`);
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
      .select('catalog_item_id, qty_available, catalog_items:catalog_item_id(id, name, sku, unit_of_measure, tracking_mode)')
      .eq('location_id', locationId)
      .gt('qty_available', 0)
      .order('name', { foreignTable: 'catalog_items' });

    if (stockError) {
      throw new Error(`Failed to load location stock: ${stockError.message}`);
    }

    const { data: assetData, error: assetError } = await supabase
      .from('assets')
      .select('catalog_item_id, catalog_item:catalog_item_id(id, name, sku, unit_of_measure, tracking_mode)')
      .eq('location_id', locationId)
      .in('status', ['available', 'assigned']);

    if (assetError) {
      throw new Error(`Failed to load location assets: ${assetError.message}`);
    }

    const assetCounts = new Map<string, { count: number; catalog_item: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'unit_of_measure' | 'tracking_mode'> | null }>();
    (assetData || []).forEach((row) => {
      const catalogItemId = row.catalog_item_id as string | null;
      if (!catalogItemId) return;
      const catalogItem = Array.isArray((row as any).catalog_item)
        ? (row as any).catalog_item[0] ?? null
        : (row as any).catalog_item ?? null;
      const existing = assetCounts.get(catalogItemId);
      assetCounts.set(catalogItemId, {
        count: (existing?.count || 0) + 1,
        catalog_item: (catalogItem || existing?.catalog_item || null) as Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'unit_of_measure' | 'tracking_mode'> | null,
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
      catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'unit_of_measure' | 'tracking_mode'> | null;
    }>();

    (stockData || []).forEach((row) => {
      const catalogItems = Array.isArray((row as any).catalog_items)
        ? (row as any).catalog_items[0] ?? null
        : (row as any).catalog_items ?? null;
      merged.set(row.catalog_item_id, {
        catalog_item_id: row.catalog_item_id,
        qty_available: row.qty_available,
        asset_count: null,
        catalog_items: catalogItems as Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'unit_of_measure' | 'tracking_mode'> | null,
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
            catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'unit_of_measure' | 'tracking_mode'> | null;
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
          catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'unit_of_measure' | 'tracking_mode'> | null;
        });
      }
    });

    return Array.from(merged.values()).sort((a, b) =>
      (a.catalog_items?.name || '').localeCompare(b.catalog_items?.name || '')
    ) as Array<{
      catalog_item_id: string;
      qty_available: number | null;
      asset_count?: number | null;
      catalog_items?: Pick<CatalogItemRow, 'id' | 'name' | 'sku' | 'unit_of_measure' | 'tracking_mode'> | null;
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
      throw new Error(`Failed to load assets for transfer: ${error.message}`);
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
      throw new Error(`Failed to fetch stock movements: ${error.message}`);
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
      throw new Error(`Failed to reverse movement: ${error.message}`);
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
      throw new Error(`Failed to fetch locations: ${error.message}`);
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
      throw new Error(`Failed to create location: ${error.message}`);
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
      throw new Error(`Failed to update location: ${error.message}`);
    }
    if (!data) {
      throw new Error('Location was updated by someone else. Please refresh and try again.');
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
      throw new Error(`Failed to delete location: ${error.message}`);
    }
    if (!data) {
      throw new Error('Location was updated by someone else. Please refresh and try again.');
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
        catalog_items:catalog_item_id(name, sku, unit_of_measure, reorder_point),
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
      throw new Error(`Failed to fetch stock balances: ${error.message}`);
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
      throw new Error(`Failed to fetch low stock items: ${error.message}`);
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
      throw new Error(`Failed to fetch inventory summary: ${error.message}`);
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
      throw new Error(`Failed to fetch reservation types: ${error.message}`);
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
      throw new Error(`Failed to create reservation type: ${error.message}`);
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
      throw new Error(`Failed to update reservation type: ${error.message}`);
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
      throw new Error(`Failed to delete reservation type: ${error.message}`);
    }

    return data as Pick<ReservationTypeRow, 'id'>;
  },
};
