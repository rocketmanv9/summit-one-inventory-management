/**
 * Supply Chain RPC Service Layer
 * Bounded Context: Procurement (Vendors, POs, Receipts)
 * Schema: supply_chain
 */

import { createBrowserAuthedClient } from '@/supabase/client';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';
import { apiWrite } from '@/lib/api-client';
import { AppError } from '@rocketmanv9/chassis/errors';
import type { Database } from 'types/supabase';

/** Write-through helper for methods migrated onto chassis routes (preserves return shape + 409). */
async function writeJson<T = unknown>(url: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown, errMsg: string): Promise<T> {
  const res = await apiWrite(url, method, body);
  const json = await res.json().catch(() => ({} as any));
  if (res.status === 409) throw AppError.conflict(json.error?.message || errMsg);
  if (!res.ok) {
    const fieldErrs = json.error?.details?.errors;
    const detail = Array.isArray(fieldErrs) && fieldErrs.length
      ? ` — ${fieldErrs.map((e: any) => `${e.path || 'field'}: ${e.message}`).join('; ')}`
      : '';
    throw AppError.internal((json.error?.message || errMsg) + detail);
  }
  return json.data as T;
}

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

function requireAdminRole(): void {
  const token = getStoredAccessToken();
  if (!token) {
    throw AppError.unauthorized('Authentication required');
  }

  const role = parseJwtPayload(token)?.app_metadata?.role;
  if (role !== 'admin') {
    throw AppError.forbidden('Admin role required');
  }
}

export interface CreatePurchaseOrderParams {
  vendor_id: string;
  po_number?: string;
  delivery_method?: 'ship' | 'pickup';
  needed_by_date?: string;
  cost_context?: 'yard' | 'job' | 'overhead';
  job_id?: string;
  delivery_location_id?: string;
  pickup_location_id?: string;
  max_authorized_spend?: number;
  vendor_quote_ref?: string;
  notes?: string;
  attachments?: any[];
  lines: Array<{
    catalog_item_id?: string;
    item_description?: string;
    uom_term_id?: string;
    qty_ordered: number;
    unit_cost?: number;
    estimated_unit_cost?: number;
    price_basis?: 'fixed' | 'estimate' | 'unknown';
    is_approximate_qty?: boolean;
    line_notes?: string;
  }>;
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
  /** How the proactive agent handles reorder needs: notify | auto_draft | auto_send. */
  reorder_mode: 'notify' | 'auto_draft' | 'auto_send';
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
  override_reason?: string;
}

export interface GuardrailError {
  code: 'OVER_RECEIPT_BLOCKED' | 'OVERRIDE_REASON_REQUIRED' | string;
  message: string;
  details?: Record<string, any>;
  action?: string;
}

export interface PostReceiptToInventoryResult {
  success: boolean;
  error?: GuardrailError;
  receipt_id?: string;
  receipt_number?: string;
  posted_lines?: number;
  rejected_lines?: number;
  damaged_lines?: number;
  skipped_lines?: number;
  override_logged?: boolean;
  message?: string;
  lines_posted?: number;
  events_created?: number;
  stock_updated?: number;
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
      throw AppError.internal(`Failed to fetch tenant settings: ${error.message}`);
    }

    return data as TenantSettings;
  },

  /**
   * Update tenant settings
   * RPC: supply_chain.rpc_update_tenant_settings
   */
  async updateTenantSettings(updates: Partial<TenantSettings>): Promise<TenantSettings> {
    requireAdminRole();
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase.rpc('rpc_update_tenant_settings', {
      p_updates: updates,
    });

    if (error) {
      throw AppError.internal(`Failed to update tenant settings: ${error.message}`);
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
      .select('id, name, code, contact_name, contact_email, contact_phone, payment_terms, notes, active, created_at, updated_at, last_event_id, vendor_type_term_id')
      .eq('id', vendorId)
      .maybeSingle();

    if (error) {
      throw AppError.internal(`Failed to fetch vendor: ${error.message}`);
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
      p_po_number: params.po_number ?? null,
      p_delivery_method: params.delivery_method ?? 'ship',
      p_needed_by_date: params.needed_by_date ?? null,
      p_cost_context: params.cost_context ?? 'yard',
      p_job_id: params.job_id ?? null,
      p_delivery_location_id: params.delivery_location_id ?? null,
      p_pickup_location_id: params.pickup_location_id ?? null,
      p_max_authorized_spend: params.max_authorized_spend ?? null,
      p_vendor_quote_ref: params.vendor_quote_ref ?? null,
      p_notes: params.notes ?? null,
      p_attachments: params.attachments ?? [],
      p_lines: params.lines,
    });

    if (error) {
      throw AppError.internal(`Failed to create PO: ${error.message}`);
    }

    return data as CreatePurchaseOrderResult;
  },

  /**
   * Post receipt to inventory (atomic bridge, v2 with guardrails)
   * RPC: supply_chain.rpc_post_receipt_to_inventory_v2
   * Validates over-receipt against PO open qty. Returns structured error when blocked.
   */
  async postReceiptToInventory(
    params: PostReceiptToInventoryParams
  ): Promise<PostReceiptToInventoryResult> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase.rpc('rpc_post_receipt_to_inventory_v2', {
      p_receipt_id: params.receipt_id,
      p_actor_user_id: params.actor_user_id ?? null,
      p_override_reason: params.override_reason ?? null,
    });

    if (error) {
      throw AppError.internal(`Failed to post receipt: ${error.message}`);
    }

    return data as any;
  },

  /**
   * Get vendors list
   * View: inventory.vendors (compatibility view → supply_chain.vendors)
   */
  async getVendors(): Promise<VendorRow[]> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    const { data, error } = await supabase
      .from('vendors')
      .select('id, tenant_id, name, code, contact_name, contact_email, contact_phone, payment_terms, lead_time_days, notes, active, created_at, updated_at, last_event_id, vendor_type_term_id')
      .eq('active', true)
      .order('name');

    if (error) {
      throw AppError.internal(`Failed to fetch vendors: ${error.message}`);
    }

    return (data ?? []) as VendorRow[];
  },

  /**
   * Create a vendor
   * Table: supply_chain.vendors
   */
  async createVendor(payload: VendorInsertPayload) {
    // Routed through the chassis write route — the create-or-restore-inactive
    // logic now runs server-side (idempotent, tenant-scoped). The route stamps
    // last_event_id; trigger_vendor_events owns emission.
    const { last_event_id, tenant_id, ...fields } = payload as VendorInsertPayload & { tenant_id?: string };
    return writeJson<Pick<VendorRow, 'id' | 'last_event_id'>>(
      '/api/inventory/vendors',
      'POST',
      fields,
      'Failed to create vendor',
    );
  },

  /**
   * Update a vendor with optimistic concurrency control
   */
  async updateVendor(id: string, updates: VendorUpdatePayload, lastEventId: string) {
    const { id: _id, created_at, tenant_id, last_event_id, ...safeUpdates } = updates as VendorUpdatePayload & {
      id?: string;
      created_at?: string;
      tenant_id?: string;
      last_event_id?: string;
    };

    // Routed through the chassis OCC write route.
    return writeJson<Pick<VendorRow, 'id' | 'last_event_id'>>(
      `/api/inventory/vendors/${id}`,
      'PATCH',
      { ...safeUpdates, expected_last_event_id: lastEventId },
      'Vendor was updated by someone else. Please refresh and try again.',
    );
  },

  /**
   * Delete a vendor with optimistic concurrency control
   */
  async deleteVendor(id: string, lastEventId: string) {
    // Soft-delete (deactivate) routed through the chassis OCC delete route.
    return writeJson<Pick<VendorRow, 'id' | 'last_event_id'>>(
      `/api/inventory/vendors/${id}`,
      'DELETE',
      { expected_last_event_id: lastEventId },
      'Vendor was updated by someone else. Please refresh and try again.',
    );
  },

  /**
   * Get vendor item mappings
   * Table: supply_chain.vendor_items
   */
  async getVendorItems(vendorId?: string): Promise<VendorItemRow[]> {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    let query = supabase
      .from('vendor_items')
      .select('id, vendor_id, catalog_item_id, vendor_sku, vendor_uom_term_id, pack_size, is_preferred, unit_cost, currency, lead_time_days, min_order_qty, notes, created_at, updated_at, last_event_id')
      .order('updated_at', { ascending: false });

    if (vendorId) {
      query = query.eq('vendor_id', vendorId);
    }

    const { data, error } = await query;

    if (error) {
      throw AppError.internal(`Failed to fetch vendor items: ${error.message}`);
    }

    return (data || []) as VendorItemRow[];
  },

  /**
   * Get vendor items with catalog item details (cross-schema, client-side join)
   */
  async getVendorItemsWithCatalog(vendorId: string) {
    const scSupabase = createBrowserAuthedClient().schema('supply_chain');
    const invSupabase = createBrowserAuthedClient().schema('inventory');

    const { data: vendorItems, error: viError } = await scSupabase
      .from('vendor_items')
      .select('id, vendor_sku, unit_cost, catalog_item_id')
      .eq('vendor_id', vendorId)
      .order('vendor_sku');

    if (viError) {
      throw AppError.internal(`Failed to fetch vendor items: ${viError.message}`);
    }

    if (!vendorItems || vendorItems.length === 0) {
      return [];
    }

    const catalogItemIds = [...new Set(vendorItems.map(vi => vi.catalog_item_id))];
    const { data: catalogItems, error: ciError } = await invSupabase
      .from('catalog_items')
      .select('id, name, sku')
      .in('id', catalogItemIds);

    if (ciError) {
      throw AppError.internal(`Failed to fetch catalog items: ${ciError.message}`);
    }

    const catalogMap = new Map((catalogItems || []).map(ci => [ci.id, ci]));

    return vendorItems.map(vi => ({
      ...vi,
      catalog_items: catalogMap.get(vi.catalog_item_id) || null,
    })) as Array<{
      id: string;
      vendor_sku: string;
      unit_cost: number;
      catalog_item_id: string;
      catalog_items?: { id: string; name: string; sku: string } | null;
    }>;
  },

  /**
   * Create a vendor item mapping
   */
  async createVendorItem(payload: VendorItemInsertPayload) {
    const { last_event_id, ...rest } = payload as VendorItemInsertPayload & { last_event_id?: string };
    void last_event_id;
    return writeJson<Pick<VendorItemRow, 'id' | 'last_event_id'>>(
      '/api/inventory/vendor-items', 'POST', rest, 'Failed to create vendor item');
  },

  /**
   * Update a vendor item mapping with optimistic concurrency control
   */
  async updateVendorItem(id: string, updates: VendorItemUpdatePayload, lastEventId: string) {
    const { id: _id, created_at, tenant_id, last_event_id, ...safeUpdates } = updates as VendorItemUpdatePayload & {
      id?: string; created_at?: string; tenant_id?: string; last_event_id?: string;
    };
    void _id; void created_at; void tenant_id; void last_event_id;
    return writeJson<Pick<VendorItemRow, 'id' | 'last_event_id'>>(
      `/api/inventory/vendor-items/${id}`, 'PATCH',
      { ...safeUpdates, expected_last_event_id: lastEventId }, 'Failed to update vendor item');
  },

  /**
   * Delete a vendor item mapping with optimistic concurrency control
   */
  async deleteVendorItem(id: string, lastEventId: string) {
    return writeJson<Pick<VendorItemRow, 'id'>>(
      `/api/inventory/vendor-items/${id}`, 'DELETE',
      { expected_last_event_id: lastEventId }, 'Failed to delete vendor item');
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
        purchase_order_lines(
          id,
          catalog_item_id,
          item_description,
          uom_term_id,
          qty_ordered,
          qty_received,
          unit_cost,
          status
        )
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
      throw AppError.internal(`Failed to fetch POs: ${error.message}`);
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
      .select('*')
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
      throw AppError.internal(`Failed to fetch receipts: ${error.message}`);
    }

    return data;
  },

  /**
   * Get open POs for receiving
   * RPC: supply_chain.rpc_get_open_pos_for_receiving
   */
  async getOpenPOsForReceiving(filters?: {
    vendor_id?: string;
    search?: string;
    limit?: number;
  }) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    
    const { data, error } = await supabase.rpc('rpc_get_open_pos_for_receiving', {
      p_vendor_id: filters?.vendor_id || null,
      p_search: filters?.search || null,
      p_limit: filters?.limit || 50
    });

    if (error) {
      throw AppError.internal(`Failed to fetch open POs for receiving: ${error.message}`);
    }

    return data;
  },

  /**
   * Get recent receipts
   * RPC: supply_chain.rpc_get_recent_receipts
   */
  async getRecentReceipts(days: number = 30) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    
    const { data, error } = await supabase.rpc('rpc_get_recent_receipts', {
      p_days: days
    });

    if (error) {
      throw AppError.internal(`Failed to fetch recent receipts: ${error.message}`);
    }

    return data;
  },

  /**
   * Get PO receiving detail
   * RPC: supply_chain.rpc_get_po_receiving_detail
   */
  async getPOReceivingDetail(poId: string) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    
    const { data, error } = await supabase.rpc('rpc_get_po_receiving_detail', {
      p_po_id: poId
    });

    if (error) {
      throw AppError.internal(`Failed to fetch PO receiving detail: ${error.message}`);
    }

    return data;
  },

  /**
   * Create receipt
   * RPC: supply_chain.rpc_create_receipt_v2
   */
  async createReceipt(params: {
    receipt_number?: string;
    location_id: string;
    po_id?: string | null;
    vendor_id?: string | null;
    received_at?: string;
    notes?: string | null;
    packing_slip_no?: string | null;
    vendor_invoice_no?: string | null;
    source_type?: string;
    status?: string;
    auto_post?: boolean;
    lines: any[];
  }) {
    const supabase = createBrowserAuthedClient().schema('supply_chain');
    
    const { data, error } = await supabase.rpc('rpc_create_receipt_v2', {
      p_receipt_number: params.receipt_number || null,
      p_location_id: params.location_id,
      p_lines: params.lines,
      p_po_id: params.po_id || null,
      p_vendor_id: params.vendor_id || null,
      p_received_at: params.received_at || undefined, // Let SQL default apply
      p_notes: params.notes || null,
      p_packing_slip_no: params.packing_slip_no || null,
      p_vendor_invoice_no: params.vendor_invoice_no || null,
      p_source_type: params.source_type || 'delivery',
      p_status: params.status || 'confirmed',
      p_auto_post: params.auto_post ?? true
    });

    if (error) {
      throw AppError.internal(`Failed to create receipt: ${error.message}`);
    }

    return data;
  },
};
