/**
 * Inventory data access layer
 * Handles tenant context and provides typed queries
 */

import { supabase, supabaseAdmin } from './client';

// Types for our inventory tables
export interface CatalogItem {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  tracking_mode: 'stock' | 'serialized' | 'both';
  uom: string | null;
  category_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Location {
  id: string;
  tenant_id: string;
  location_type: 'yard' | 'warehouse' | 'truck' | 'job' | 'person' | 'vendor' | 'other';
  name: string;
  parent_location_id: string | null;
  external_ref: Record<string, any> | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockBalance {
  id: string;
  tenant_id: string;
  catalog_item_id: string;
  location_id: string;
  qty_on_hand: number;
  qty_reserved: number;
  qty_available: number;
  updated_at: string;
}

export interface Asset {
  id: string;
  tenant_id: string;
  catalog_item_id: string | null;
  asset_tag: string;
  serial_number: string | null;
  vin: string | null;
  status: 'available' | 'assigned' | 'in_repair' | 'out_of_service' | 'retired';
  home_location_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Inventory Service
 * All methods automatically filter by tenant_id
 */
export class InventoryService {
  private tenantId: string;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  /**
   * Get all catalog items for the tenant
   */
  async getCatalogItems() {
    const { data, error } = await supabase
      .from('catalog_items')
      .select('*, item_categories(name)')
      .eq('tenant_id', this.tenantId)
      .eq('active', true)
      .order('name');

    if (error) throw error;
    return data;
  }

  /**
   * Get stock balances with item and location details
   */
  async getStockBalances() {
    const { data, error } = await supabase
      .from('stock_balances')
      .select(`
        *,
        catalog_items(sku, name, uom),
        locations(name, location_type)
      `)
      .eq('tenant_id', this.tenantId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  /**
   * Get low stock items (available qty < threshold)
   */
  async getLowStockItems(threshold: number = 20) {
    const { data, error } = await supabase
      .from('stock_balances')
      .select(`
        *,
        catalog_items(sku, name, uom),
        locations(name, location_type)
      `)
      .eq('tenant_id', this.tenantId)
      .lt('qty_available', threshold)
      .order('qty_available');

    if (error) throw error;
    return data;
  }

  /**
   * Get all locations
   */
  async getLocations() {
    const { data, error } = await supabase
      .from('locations')
      .select('*')
      .eq('tenant_id', this.tenantId)
      .eq('active', true)
      .order('name');

    if (error) throw error;
    return data;
  }

  /**
   * Get all assets with current state
   */
  async getAssets() {
    const { data, error } = await supabase
      .from('assets')
      .select(`
        *,
        catalog_items(name),
        asset_state(current_location_id, current_status, assigned_to_ref)
      `)
      .eq('tenant_id', this.tenantId)
      .order('asset_tag');

    if (error) throw error;
    return data;
  }

  /**
   * Get active reservations
   */
  async getActiveReservations() {
    const { data, error } = await supabase
      .from('reservations')
      .select(`
        *,
        catalog_items(sku, name),
        locations(name)
      `)
      .eq('tenant_id', this.tenantId)
      .eq('status', 'active')
      .order('needed_by');

    if (error) throw error;
    return data;
  }

  /**
   * Get recent inventory events
   */
  async getRecentEvents(limit: number = 50) {
    const { data, error } = await supabase
      .from('inventory_events')
      .select('*')
      .eq('tenant_id', this.tenantId)
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data;
  }

  /**
   * Create a new inventory event (idempotent)
   */
  async createInventoryEvent(eventData: {
    event_type: string;
    last_event_id: string;
    payload: Record<string, any>;
    occurred_at?: string;
    actor_user_id?: string;
    source_system?: string;
  }) {
    const { data, error } = await supabase
      .from('inventory_events')
      .insert({
        tenant_id: this.tenantId,
        ...eventData,
        occurred_at: eventData.occurred_at || new Date().toISOString()
      })
      .select()
      .single();

    // If error is duplicate key (idempotency), fetch existing
    if (error?.code === '23505') {
      const { data: existing } = await supabase
        .from('inventory_events')
        .select()
        .eq('tenant_id', this.tenantId)
        .eq('last_event_id', eventData.last_event_id)
        .single();
      
      return existing;
    }

    if (error) throw error;
    return data;
  }
}

// Default export for convenience
export default InventoryService;
