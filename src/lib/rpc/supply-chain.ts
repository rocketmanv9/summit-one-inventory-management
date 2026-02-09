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
    const { data, error } = await supabase
      .from('vendors')
      .delete()
      .eq('id', id)
      .eq('last_event_id', lastEventId)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to delete vendor: ${error.message}`);
    }
    if (!data) {
      throw new Error('Vendor was updated by someone else. Please refresh and try again.');
    }

    return data as Pick<VendorRow, 'id'>;
  },

  /**
   * Get vendor item mappings
   * Table: supply_chain.vendor_items
   */
  async getVendorItems(): Promise<VendorItemRow[]> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase
      .from('vendor_items')
      .select('id, vendor_id, catalog_item_id, vendor_sku, vendor_uom, pack_size, is_preferred, unit_cost, currency, lead_time_days, min_order_qty, notes, created_at, updated_at, last_event_id')
      .order('updated_at', { ascending: false });

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
