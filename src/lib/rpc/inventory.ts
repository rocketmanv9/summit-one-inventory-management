/**
 * Inventory RPC Service Layer
 * Bounded Context: Inventory Management (Stock, Movements, Assets)
 * Schema: inventory
 */

import { createClient } from '@/supabase/client';

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
    const supabase = createClient();
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
    const supabase = createClient();
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
  }) {
    const supabase = createClient();
    let query = supabase
      .from('inventory.catalog_items')
      .select(`
        *,
        item_categories:category_id(name),
        vendors:preferred_vendor_id(name)
      `)
      .is('deleted_at', null)
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

    return data;
  },

  /**
   * Get locations
   * Table: inventory.locations
   */
  async getLocations(filters?: {
    type?: string;
    active?: boolean;
  }) {
    const supabase = createClient();
    let query = supabase
      .from('inventory.locations')
      .select('*')
      .order('name');

    if (filters?.type) {
      query = query.eq('location_type', filters.type);
    }
    if (filters?.active !== undefined) {
      query = query.eq('active', filters.active);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch locations: ${error.message}`);
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
    const supabase = createClient();
    let query = supabase
      .from('inventory.stock_balances')
      .select(`
        *,
        catalog_items:catalog_item_id(name, sku, unit_of_measure),
        locations:location_id(name, location_type)
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
    const supabase = createClient();
    const { data, error } = await supabase
      .from('inventory.mv_low_stock_summary')
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
    const supabase = createClient();
    const { data, error } = await supabase
      .from('inventory.mv_inventory_summary')
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to fetch inventory summary: ${error.message}`);
    }

    return data;
  },

  /**
   * Get transfers
   * Table: inventory.transfers
   */
  async getTransfers(filters?: {
    status?: string;
    from_location_id?: string;
    to_location_id?: string;
  }) {
    const supabase = createClient();
    let query = supabase
      .from('inventory.transfers')
      .select(`
        *,
        from_locations:from_location_id(name),
        to_locations:to_location_id(name)
      `)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.from_location_id) {
      query = query.eq('from_location_id', filters.from_location_id);
    }
    if (filters?.to_location_id) {
      query = query.eq('to_location_id', filters.to_location_id);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch transfers: ${error.message}`);
    }

    return data;
  },

  /**
   * Get reservations
   * Table: inventory.reservations
   */
  async getReservations(filters?: {
    status?: string;
    allocation_type?: string;
    job_ref?: string;
  }) {
    const supabase = createClient();
    let query = supabase
      .from('inventory.reservations')
      .select(`
        *,
        catalog_items:catalog_item_id(name, sku),
        locations:location_id(name)
      `)
      .order('needed_by');

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.allocation_type) {
      query = query.eq('allocation_type', filters.allocation_type);
    }
    if (filters?.job_ref) {
      query = query.contains('payload', { job_ref: filters.job_ref });
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch reservations: ${error.message}`);
    }

    return data;
  },
};
