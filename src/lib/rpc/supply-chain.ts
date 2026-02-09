/**
 * Supply Chain RPC Service Layer
 * Bounded Context: Procurement (Vendors, POs, Receipts)
 * Schema: supply_chain
 */

import { createBrowserAuthedClient } from '@/supabase/client';
import type { Database } from 'types/supabase';

type VendorRow = Database['supply_chain']['Tables']['vendors']['Row'];
type VendorInsert = Database['supply_chain']['Tables']['vendors']['Insert'];
type VendorUpdate = Database['supply_chain']['Tables']['vendors']['Update'];
type VendorItemRow = Database['supply_chain']['Tables']['vendor_items']['Row'];
type VendorItemInsert = Database['supply_chain']['Tables']['vendor_items']['Insert'];
type VendorItemUpdate = Database['supply_chain']['Tables']['vendor_items']['Update'];

type VendorInsertPayload = Omit<VendorInsert, 'tenant_id'> & { tenant_id?: string };
type VendorUpdatePayload = Omit<VendorUpdate, 'tenant_id'> & { tenant_id?: string };
type VendorItemInsertPayload = Omit<VendorItemInsert, 'tenant_id'> & { tenant_id?: string };
type VendorItemUpdatePayload = Omit<VendorItemUpdate, 'tenant_id'> & { tenant_id?: string };

export interface CreatePurchaseOrderParams {
  vendor_id: string;
  po_number?: string;
  delivery_location_id: string;
  lines: Array<{
    catalog_item_id: string;
    qty_ordered: number;
    unit_cost: number;
  }>;
  expected_delivery_date?: string;
  notes?: string;
}

export interface CreatePurchaseOrderResult {
  success: boolean;
  po_id: string;
  po_number: string;
  line_count: number;
  status: string;
}

export interface CreateReceiptParams {
  receipt_number?: string;
  location_id: string;
  lines: Array<{
    catalog_item_id: string;
    qty_received: number;
    po_line_id?: string;
  }>;
  po_id?: string;
  received_at?: string;
  notes?: string;
  auto_post?: boolean;
}

export interface CreateReceiptResult {
  success: boolean;
  receipt_id: string;
  receipt_number: string;
  posted_lines: number;
  post_result?: any;
}

export type VendorCodeStrategy = 'manual' | 'sequential' | 'hybrid' | 'import';
export type VendorCodeCase = 'upper' | 'lower' | 'preserve';

export interface TenantSettings {
  id: string;
  tenant_id: string;
  po_number_format: string;
  po_number_prefix: string | null;
  cycle_count_number_format: string;
  cycle_count_number_prefix: string | null;
  auto_approve_enabled: boolean;
  auto_approve_limit: number | null;
  vendor_auto_approve_limits: Record<string, number> | null;
  vendor_code_strategy: VendorCodeStrategy;
  vendor_code_required: boolean;
  vendor_code_case: VendorCodeCase;
  vendor_code_min_length: number | null;
  vendor_code_max_length: number | null;
  vendor_code_prefix: string | null;
  vendor_code_suffix: string | null;
  vendor_code_allowed_chars: string | null;
  vendor_code_regex: string | null;
  vendor_code_user_editable: boolean;
  vendor_code_immutable_after_use: boolean;
  vendor_code_sequence_padding: number;
  vendor_code_next_seq: number;
  updated_at: string;
}

export interface PostReceiptToInventoryParams {
  receipt_id: string;
  actor_user_id?: string;
}

export interface PostReceiptToInventoryResult {
  success: boolean;
  receipt_id: string;
  lines_posted: number;
  events_created: number;
  stock_updated: number;
}

export const SupplyChainRPC = {
  /**
   * Tenant settings (PO numbering, approvals, vendor code rules)
   * RPC: supply_chain.rpc_get_tenant_settings
   */
  async getTenantSettings(): Promise<TenantSettings> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase.rpc('rpc_get_tenant_settings');

    if (error) {
      throw new Error(`Failed to fetch tenant settings: ${error.message}`);
    }

    return data as TenantSettings;
  },

  /**
   * Update tenant settings
   * RPC: supply_chain.rpc_update_tenant_settings
   */
  async updateTenantSettings(updates: Partial<TenantSettings>): Promise<TenantSettings> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase.rpc('rpc_update_tenant_settings', {
      p_updates: updates,
    });

    if (error) {
      throw new Error(`Failed to update tenant settings: ${error.message}`);
    }

    return data as TenantSettings;
  },
  /**
   * Get a single vendor by id
   * Table: supply_chain.vendors
   */
  async getVendorById(vendorId: string): Promise<VendorRow | null> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase
      .from('vendors')
      .select('id, name, code, contact_name, contact_email, contact_phone, payment_terms, notes, active, created_at, updated_at, last_event_id')
      .eq('id', vendorId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch vendor: ${error.message}`);
    }

    return data as VendorRow | null;
  },
  /**
   * Create a new purchase order
   * RPC: supply_chain.rpc_create_purchase_order
   */
  async createPurchaseOrder(
    params: CreatePurchaseOrderParams
  ): Promise<CreatePurchaseOrderResult> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase.rpc('rpc_create_purchase_order', {
      p_vendor_id: params.vendor_id,
      p_po_number: params.po_number,
      p_delivery_location_id: params.delivery_location_id,
      p_lines: params.lines,
      p_expected_delivery_date: params.expected_delivery_date,
      p_notes: params.notes,
    });

    if (error) {
      throw new Error(`Failed to create PO: ${error.message}`);
    }

    return (data || []) as VendorRow[];
  },

  /**
   * Create a receipt (with optional auto-post to inventory)
   * RPC: supply_chain.rpc_create_receipt
   */
  async createReceipt(
    params: CreateReceiptParams
  ): Promise<CreateReceiptResult> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase.rpc('rpc_create_receipt', {
      p_receipt_number: params.receipt_number,
      p_location_id: params.location_id,
      p_lines: params.lines,
      p_po_id: params.po_id,
      p_received_at: params.received_at,
      p_notes: params.notes,
      p_auto_post: params.auto_post ?? true,
    });

    if (error) {
      throw new Error(`Failed to create receipt: ${error.message}`);
    }

    return data;
  },

  /**
   * Post receipt to inventory (atomic bridge)
   * RPC: supply_chain.rpc_post_receipt_to_inventory
   */
  async postReceiptToInventory(
    params: PostReceiptToInventoryParams
  ): Promise<PostReceiptToInventoryResult> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase.rpc('rpc_post_receipt_to_inventory', {
      p_receipt_id: params.receipt_id,
      p_actor_user_id: params.actor_user_id,
    });

    if (error) {
      throw new Error(`Failed to post receipt: ${error.message}`);
    }

    return data;
  },

  /**
   * Get vendors list
   * View: inventory.vendors (compatibility view → supply_chain.vendors)
   */
  async getVendors() {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase
      .from('vendors')
      .select('id, name, code, contact_name, contact_email, contact_phone, payment_terms, lead_time_days, notes, active, created_at, last_event_id')
      .eq('active', true)
      .order('name');

    if (error) {
      throw new Error(`Failed to fetch vendors: ${error.message}`);
    }

    return data;
  },

  /**
   * Create a vendor
   * Table: supply_chain.vendors
   */
  async createVendor(payload: VendorInsertPayload) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const insertPayload: VendorInsertPayload = {
      ...payload,
      last_event_id: payload.last_event_id ?? crypto.randomUUID(),
    };

    const { data: existingByName, error: existingError } = await supabase
      .from('vendors')
      .select('id, last_event_id, active')
      .eq('name', insertPayload.name)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to check existing vendor: ${existingError.message}`);
    }

    if (existingByName?.active) {
      throw new Error('A vendor with this name already exists. Edit the existing vendor or choose a different name.');
    }

    if (existingByName && !existingByName.active) {
      const nextEventId = crypto.randomUUID();
      const updatePayload: VendorUpdatePayload = {
        ...insertPayload,
        active: true,
        last_event_id: nextEventId,
      };
      delete (updatePayload as VendorUpdatePayload & { tenant_id?: string }).tenant_id;

      let updateQuery = supabase
        .from('vendors')
        .update(updatePayload)
        .eq('id', existingByName.id);

      if (existingByName.last_event_id) {
        updateQuery = updateQuery.eq('last_event_id', existingByName.last_event_id);
      }

      const { data: restored, error: restoreError } = await updateQuery
        .select('id, last_event_id')
        .single();

      if (restoreError) {
        throw new Error(`Failed to restore vendor: ${restoreError.message}`);
      }

      return restored as Pick<VendorRow, 'id' | 'last_event_id'>;
    }

    const { data, error } = await supabase
      .from('vendors')
      .insert(insertPayload)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw new Error(`Failed to create vendor: ${error.message}`);
    }

    return data as Pick<VendorRow, 'id' | 'last_event_id'>;
  },

  /**
   * Update a vendor with optimistic concurrency control
   */
  async updateVendor(id: string, updates: VendorUpdatePayload, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { id: _id, created_at, tenant_id, last_event_id, ...safeUpdates } = updates as VendorUpdatePayload & {
      id?: string;
      created_at?: string;
      tenant_id?: string;
      last_event_id?: string;
    };

    const { data, error } = await supabase
      .from('vendors')
      .update({ ...safeUpdates })
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw new Error(`Failed to update vendor: ${error.message}`);
    }
    if (!data) {
      throw new Error('Vendor was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<VendorRow, 'id' | 'last_event_id'>;
  },

  /**
   * Delete a vendor with optimistic concurrency control
   */
  async deleteVendor(id: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const nextEventId = crypto.randomUUID();
    const { data, error } = await supabase
      .from('vendors')
      .update({ active: false, last_event_id: nextEventId })
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw new Error(`Failed to delete vendor: ${error.message}`);
    }
    if (!data) {
      throw new Error('Vendor was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<VendorRow, 'id' | 'last_event_id'>;
  },

  /**
   * Get vendor item mappings
   * Table: supply_chain.vendor_items
   */
  async getVendorItems(vendorId?: string): Promise<VendorItemRow[]> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    let query = supabase
      .from('vendor_items')
      .select('id, vendor_id, catalog_item_id, vendor_sku, vendor_uom, pack_size, is_preferred, unit_cost, currency, lead_time_days, min_order_qty, notes, created_at, updated_at, last_event_id')
      .order('updated_at', { ascending: false });

    if (vendorId) {
      query = query.eq('vendor_id', vendorId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch vendor items: ${error.message}`);
    }

    return (data || []) as VendorItemRow[];
  },

  /**
   * Create a vendor item mapping
   */
  async createVendorItem(payload: VendorItemInsertPayload) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const insertPayload: VendorItemInsertPayload = {
      ...payload,
      last_event_id: payload.last_event_id ?? crypto.randomUUID(),
    };

    const { data, error } = await supabase
      .from('vendor_items')
      .insert(insertPayload)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw new Error(`Failed to create vendor item: ${error.message}`);
    }

    return data as Pick<VendorItemRow, 'id' | 'last_event_id'>;
  },

  /**
   * Update a vendor item mapping with optimistic concurrency control
   */
  async updateVendorItem(id: string, updates: VendorItemUpdatePayload, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { id: _id, created_at, tenant_id, last_event_id, ...safeUpdates } = updates as VendorItemUpdatePayload & {
      id?: string;
      created_at?: string;
      tenant_id?: string;
      last_event_id?: string;
    };

    const { data, error } = await supabase
      .from('vendor_items')
      .update({ ...safeUpdates })
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id, last_event_id')
      .single();

    if (error) {
      throw new Error(`Failed to update vendor item: ${error.message}`);
    }
    if (!data) {
      throw new Error('Vendor item was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<VendorItemRow, 'id' | 'last_event_id'>;
  },

  /**
   * Delete a vendor item mapping with optimistic concurrency control
   */
  async deleteVendorItem(id: string, lastEventId: string) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase
      .from('vendor_items')
      .delete()
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to delete vendor item: ${error.message}`);
    }
    if (!data) {
      throw new Error('Vendor item was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<VendorItemRow, 'id'>;
  },

  /**
   * Get purchase orders
   * Table: supply_chain.purchase_orders (via compatibility view)
   */
  async getPurchaseOrders(filters?: {
    status?: string;
    vendor_id?: string;
    from_date?: string;
    to_date?: string;
  }) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    let query = supabase
      .from('purchase_orders')
      .select(`
        *,
        vendors:vendor_id(name),
        locations:delivery_location_id(name)
      `)
      .order('created_at', { ascending: false });

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.vendor_id) {
      query = query.eq('vendor_id', filters.vendor_id);
    }
    if (filters?.from_date) {
      query = query.gte('created_at', filters.from_date);
    }
    if (filters?.to_date) {
      query = query.lte('created_at', filters.to_date);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch POs: ${error.message}`);
    }

    return data;
  },

  /**
   * Get receipts
   * Table: supply_chain.receipts (via compatibility view)
   */
  async getReceipts(filters?: {
    location_id?: string;
    po_id?: string;
    from_date?: string;
    to_date?: string;
  }) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    let query = supabase
      .from('receipts')
      .select(`
        *,
        locations:location_id(name),
        purchase_orders:po_id(po_number)
      `)
      .order('received_at', { ascending: false });

    if (filters?.location_id) {
      query = query.eq('location_id', filters.location_id);
    }
    if (filters?.po_id) {
      query = query.eq('po_id', filters.po_id);
    }
    if (filters?.from_date) {
      query = query.gte('received_at', filters.from_date);
    }
    if (filters?.to_date) {
      query = query.lte('received_at', filters.to_date);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch receipts: ${error.message}`);
    }

    return data;
  },
};
