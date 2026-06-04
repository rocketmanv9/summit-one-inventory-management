/**
 * Purchase Order RPC Client & React Hooks
 * 
 * Provides type-safe wrappers around the supply_chain.rpc_create_purchase_order
 * function and React hooks for PO management.
 */

import { createBrowserAuthedClient } from '@/supabase/client';
import type {
  CreatePORequest,
  CreatePOResponse,
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderWithDetails,
  VendorConfiguration,
  VendorDefaults,
  VendorOrderingGuidance,
  OrderPlacementMethod
} from '@/types/purchase-orders';

// =====================================================
// RPC CLIENT FUNCTIONS
// =====================================================

/**
 * Create a new purchase order
 */
export async function createPurchaseOrder(
  request: CreatePORequest
): Promise<{ data: CreatePOResponse | null; error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');
  
  try {
    const { data, error } = await supabase.rpc('rpc_create_purchase_order', {
      p_vendor_id: request.vendor_id,
      p_po_number: request.po_number,
      p_delivery_method: request.delivery_method,
      p_needed_by_date: request.needed_by_date,
      p_cost_context: request.cost_context,
      p_job_id: request.job_id || null,
      p_delivery_location_id: request.delivery_location_id || null,
      p_pickup_location_id: request.pickup_location_id || null,
      p_max_authorized_spend: request.max_authorized_spend || null,
      p_vendor_quote_ref: request.vendor_quote_ref || null,
      p_notes: request.notes || null,
      p_attachments: request.attachments || [],
      p_lines: request.lines
    });
    
    if (error) {
      console.error('Error creating purchase order:', error);
      return { data: null, error: new Error(error.message) };
    }
    
    return { data: data as CreatePOResponse, error: null };
  } catch (err) {
    console.error('Exception creating purchase order:', err);
    return { 
      data: null, 
      error: err instanceof Error ? err : new Error('Unknown error') 
    };
  }
}

/**
 * Get vendor ordering guidance (from view)
 */
export async function getVendorOrderingGuidance(
  vendorId: string
): Promise<{ data: VendorOrderingGuidance | null; error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');
  
  try {
    const { data, error } = await supabase
      .from('v_vendor_ordering_guidance')
      .select('*')
      .eq('vendor_id', vendorId)
      .single();
    
    if (error) {
      console.error('Error fetching vendor ordering guidance:', error);
      return { data: null, error: new Error(error.message) };
    }
    
    return { data, error: null };
  } catch (err) {
    console.error('Exception fetching vendor ordering guidance:', err);
    return { 
      data: null, 
      error: err instanceof Error ? err : new Error('Unknown error') 
    };
  }
}

/**
 * Mark PO as ordered externally (portal/phone/etc)
 */
export async function markPOAsOrdered(
  poId: string,
  externalOrderNumber?: string,
  placementMethod?: OrderPlacementMethod,
  placementNotes?: string
): Promise<{ data: any | null; error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');
  
  try {
    const { data, error } = await supabase.rpc('rpc_mark_po_ordered', {
      p_po_id: poId,
      p_external_order_number: externalOrderNumber || null,
      p_order_placement_method: placementMethod || 'portal',
      p_order_placement_notes: placementNotes || null
    });
    
    if (error) {
      console.error('Error marking PO as ordered:', error);
      return { data: null, error: new Error(error.message) };
    }
    
    return { data, error: null };
  } catch (err) {
    console.error('Exception marking PO as ordered:', err);
    return { 
      data: null, 
      error: err instanceof Error ? err : new Error('Unknown error') 
    };
  }
}

/**
 * Send PO via email to vendor
 */
export async function sendPOEmail(
  poId: string,
  recipientEmail?: string
): Promise<{ data: any | null; error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');
  
  try {
    const { data, error } = await supabase.rpc('rpc_send_po_email', {
      p_po_id: poId,
      p_recipient_email: recipientEmail || null
    });
    
    if (error) {
      console.error('Error sending PO email:', error);
      return { data: null, error: new Error(error.message) };
    }
    
    return { data, error: null };
  } catch (err) {
    console.error('Exception sending PO email:', err);
    return { 
      data: null, 
      error: err instanceof Error ? err : new Error('Unknown error') 
    };
  }
}

/**
 * Get vendor defaults for PO creation
 */
export async function getVendorDefaults(
  vendorId: string
): Promise<{ data: VendorDefaults | null; error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');
  
  try {
    const { data, error } = await supabase
      .from('vendors')
      .select('id, name, default_delivery_method, default_payment_method, po_email, po_instructions, requires_po_in_subject, min_order_amount, freight_terms, lead_time_days, ordering_mode')
      .eq('id', vendorId)
      .single();
    
    if (error) {
      console.error('Error fetching vendor defaults:', error);
      return { data: null, error: new Error(error.message) };
    }
    
    const defaults: VendorDefaults = {
      vendor_id: data.id,
      vendor_name: data.name,
      default_delivery_method: data.default_delivery_method,
      default_payment_method: data.default_payment_method,
      po_email: data.po_email,
      po_instructions: data.po_instructions,
      requires_po_in_subject: data.requires_po_in_subject,
      min_order_amount: data.min_order_amount,
      freight_terms: data.freight_terms,
      lead_time_days: data.lead_time_days,
      ordering_mode: data.ordering_mode
    };
    
    return { data: defaults, error: null };
  } catch (err) {
    console.error('Exception fetching vendor defaults:', err);
    return { 
      data: null, 
      error: err instanceof Error ? err : new Error('Unknown error') 
    };
  }
}

/**
 * Get purchase order with all details
 */
export async function getPurchaseOrderWithDetails(
  poId: string
): Promise<{ data: PurchaseOrderWithDetails | null; error: Error | null }> {
  const client = createBrowserAuthedClient();
  const supabase = client.schema('supply_chain');
  const inventory = client.schema('inventory');

  try {
    // Fetch PO header
    const { data: po, error: poError } = await supabase
      .from('purchase_orders')
      .select('*')
      .eq('id', poId)
      .single();
    
    if (poError) {
      return { data: null, error: new Error(poError.message) };
    }
    
    // Fetch PO lines
    const { data: lines, error: linesError } = await supabase
      .from('purchase_order_lines')
      .select('*')
      .eq('po_id', poId)
      .order('line_number');
    
    if (linesError) {
      return { data: null, error: new Error(linesError.message) };
    }
    
    // Fetch vendor if present
    let vendor = null;
    if (po.vendor_id) {
      const { data: vendorData } = await supabase
        .from('vendors')
        .select('*')
        .eq('id', po.vendor_id)
        .single();
      vendor = vendorData;
    }
    
    // Fetch locations
    let delivery_location = null;
    let pickup_location = null;
    
    if (po.delivery_location_id) {
      const { data: locData } = await inventory
        .from('locations')
        .select('id, name')
        .eq('id', po.delivery_location_id)
        .single();
      delivery_location = locData;
    }

    if (po.pickup_location_id) {
      const { data: locData } = await inventory
        .from('locations')
        .select('id, name')
        .eq('id', po.pickup_location_id)
        .single();
      pickup_location = locData;
    }
    
    const poWithDetails: PurchaseOrderWithDetails = {
      ...po,
      vendor,
      lines: lines || [],
      delivery_location,
      pickup_location
    };
    
    return { data: poWithDetails, error: null };
  } catch (err) {
    console.error('Exception fetching PO details:', err);
    return { 
      data: null, 
      error: err instanceof Error ? err : new Error('Unknown error') 
    };
  }
}

/**
 * Get next available PO number
 */
export async function getNextPONumber(): Promise<{ data: string | null; error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');
  
  try {
    // Get the latest PO number for this tenant
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('po_number')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (error) {
      console.error('Error fetching latest PO number:', error);
      // Fallback to date-based number
      const year = new Date().getFullYear();
      return { data: `PO-${year}-001`, error: null };
    }
    
    if (!data) {
      // No POs yet, start with 001
      const year = new Date().getFullYear();
      return { data: `PO-${year}-001`, error: null };
    }
    
    // Extract number from format PO-YYYY-NNN
    const match = data.po_number.match(/PO-(\d{4})-(\d+)/);
    if (match) {
      const year = new Date().getFullYear();
      const lastYear = parseInt(match[1]);
      const lastNum = parseInt(match[2]);
      
      // If new year, reset to 001
      if (year > lastYear) {
        return { data: `PO-${year}-001`, error: null };
      }
      
      // Increment
      const nextNum = lastNum + 1;
      const nextPONum = `PO-${year}-${nextNum.toString().padStart(3, '0')}`;
      return { data: nextPONum, error: null };
    }
    
    // Fallback
    const year = new Date().getFullYear();
    return { data: `PO-${year}-001`, error: null };
  } catch (err) {
    console.error('Exception generating PO number:', err);
    const year = new Date().getFullYear();
    return { data: `PO-${year}-001`, error: null };
  }
}

/**
 * List purchase orders with filters
 */
export async function listPurchaseOrders(filters?: {
  vendor_id?: string;
  status?: string;
  cost_context?: string;
  job_id?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
}): Promise<{ data: PurchaseOrder[] | null; error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');
  
  try {
    let query = supabase
      .from('purchase_orders')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (filters?.vendor_id) {
      query = query.eq('vendor_id', filters.vendor_id);
    }
    if (filters?.status) {
      query = query.eq('status', filters.status);
    }
    if (filters?.cost_context) {
      query = query.eq('cost_context', filters.cost_context);
    }
    if (filters?.job_id) {
      query = query.eq('job_id', filters.job_id);
    }
    if (filters?.from_date) {
      query = query.gte('order_date', filters.from_date);
    }
    if (filters?.to_date) {
      query = query.lte('order_date', filters.to_date);
    }
    if (filters?.limit) {
      query = query.limit(filters.limit);
    }
    
    const { data, error } = await query;
    
    if (error) {
      return { data: null, error: new Error(error.message) };
    }
    
    return { data, error: null };
  } catch (err) {
    console.error('Exception listing purchase orders:', err);
    return { 
      data: null, 
      error: err instanceof Error ? err : new Error('Unknown error') 
    };
  }
}

// =====================================================
// REACT HOOKS
// =====================================================

import { useState } from 'react';

/**
 * Hook for creating a purchase order
 */
export function useCreatePurchaseOrder() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const create = async (request: CreatePORequest) => {
    setIsLoading(true);
    setError(null);
    
    const result = await createPurchaseOrder(request);
    
    setIsLoading(false);
    
    if (result.error) {
      setError(result.error);
      return { data: null, error: result.error };
    }
    
    return { data: result.data, error: null };
  };
  
  return {
    create,
    isLoading,
    error,
    reset: () => {
      setError(null);
      setIsLoading(false);
    }
  };
}

/**
 * Hook for fetching vendor defaults
 */
export function useVendorDefaults(vendorId: string | null) {
  const [defaults, setDefaults] = useState<VendorDefaults | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  const fetch = async () => {
    if (!vendorId) {
      setDefaults(null);
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    const result = await getVendorDefaults(vendorId);
    
    setIsLoading(false);
    
    if (result.error) {
      setError(result.error);
      setDefaults(null);
    } else {
      setDefaults(result.data);
    }
  };
  
  return {
    defaults,
    isLoading,
    error,
    fetch,
    reset: () => {
      setDefaults(null);
      setError(null);
      setIsLoading(false);
    }
  };
}

/**
 * Hook for generating next PO number
 */
export function useNextPONumber() {
  const [poNumber, setPONumber] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  const generate = async () => {
    setIsLoading(true);
    const result = await getNextPONumber();
    setIsLoading(false);
    
    if (result.data) {
      setPONumber(result.data);
    }
    
    return result.data;
  };
  
  return {
    poNumber,
    isLoading,
    generate
  };
}

/**
 * Update purchase order status with optimistic concurrency control
 */
export async function updatePurchaseOrderStatus(
  poId: string,
  status: string,
  lastEventId: string
): Promise<{ data: any | null; error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');

  try {
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({ status })
      .eq('id', poId)
      .eq('last_event_id', lastEventId)
      .select()
      .single();

    if (error) {
      console.error('Error updating PO status:', error);
      return { data: null, error: new Error(error.message) };
    }
    if (!data) {
      return { data: null, error: new Error('Purchase order was updated by someone else. Please refresh and try again.') };
    }

    return { data, error: null };
  } catch (err) {
    console.error('Exception updating PO status:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error('Unknown error')
    };
  }
}

/**
 * Mark free-text (non-catalog) PO lines as received by setting their absolute
 * cumulative qty_received. There's no stock to post for these, so we write the
 * line directly; the update_po_line_status BEFORE trigger derives the line
 * status and update_po_status_from_lines rolls the header up to
 * partially_received / fully_received. Pass the NEW cumulative qty_received per
 * line (existing + amount received now), not a delta.
 *
 * Raw supabase-js writes don't throw on error, so each update selects the row
 * and the error is surfaced explicitly.
 */
export async function receivePurchaseOrderLines(
  poId: string,
  lines: Array<{ id: string; qty_received: number }>
): Promise<{ error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');
  for (const line of lines) {
    const { data, error } = await supabase
      .from('purchase_order_lines')
      .update({ qty_received: line.qty_received })
      .eq('id', line.id)
      .eq('po_id', poId)
      .select('id')
      .single();
    if (error) return { error: new Error(error.message) };
    if (!data) return { error: new Error('Could not update a PO line — it may have changed. Please refresh and retry.') };
  }
  return { error: null };
}

/**
 * Void (soft-delete) a purchase order with optimistic concurrency control.
 * Sets status to 'voided' instead of hard-deleting so the existing
 * trigger_po_status_events trigger emits a status-change event to the outbox.
 */
export async function deletePurchaseOrder(
  poId: string,
  lastEventId: string
): Promise<{ data: any | null; error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');

  try {
    const { data, error } = await supabase
      .from('purchase_orders')
      .update({ status: 'voided' })
      .eq('id', poId)
      .eq('last_event_id', lastEventId)
      .select()
      .single();

    if (error) {
      console.error('Error voiding PO:', error);
      return { data: null, error: new Error(error.message) };
    }
    if (!data) {
      return { data: null, error: new Error('Purchase order was updated by someone else. Please refresh and try again.') };
    }

    return { data, error: null };
  } catch (err) {
    console.error('Exception voiding PO:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error('Unknown error')
    };
  }
}

/**
 * Update purchase order (header) with optimistic concurrency control.
 * Note: This is a simplified update. For production, consider creating an RPC function
 * that handles the full transactional update of PO + lines.
 */
export async function updatePurchaseOrder(
  poId: string,
  lastEventId: string,
  updates: {
    vendor_id?: string;
    delivery_location_id?: string;
    needed_by_date?: string | null;
    notes?: string | null;
    lines?: Array<{
      id?: string;
      catalog_item_id: string;
      qty_ordered: number;
      unit_cost: number;
    }>;
  }
): Promise<{ data: any | null; error: Error | null }> {
  const supabase = createBrowserAuthedClient().schema('supply_chain');

  try {
    // Update PO header with OCC guard
    const headerUpdates: any = {};
    if (updates.vendor_id) headerUpdates.vendor_id = updates.vendor_id;
    if (updates.delivery_location_id) headerUpdates.delivery_location_id = updates.delivery_location_id;
    if (updates.needed_by_date !== undefined) headerUpdates.needed_by_date = updates.needed_by_date;
    if (updates.notes !== undefined) headerUpdates.notes = updates.notes;

    const { data, error: headerError } = await supabase
      .from('purchase_orders')
      .update(headerUpdates)
      .eq('id', poId)
      .eq('last_event_id', lastEventId)
      .select()
      .single();

    if (headerError) {
      console.error('Error updating PO header:', headerError);
      return { data: null, error: new Error(headerError.message) };
    }
    if (!data) {
      return { data: null, error: new Error('Purchase order was updated by someone else. Please refresh and try again.') };
    }

    // Replace line items when provided. Editing is only exposed for draft POs (no
    // receipts yet), so a wholesale delete + re-insert is safe — the status-from-lines
    // triggers only fire on received quantities and leave the PO status untouched here.
    if (updates.lines) {
      const { error: deleteError } = await supabase
        .from('purchase_order_lines')
        .delete()
        .eq('po_id', poId);

      if (deleteError) {
        console.error('Error clearing PO lines:', deleteError);
        return { data: null, error: new Error(deleteError.message) };
      }

      if (updates.lines.length > 0) {
        const lineRows = updates.lines.map((line, index) => ({
          tenant_id: data.tenant_id,
          po_id: poId,
          line_number: index + 1,
          catalog_item_id: line.catalog_item_id,
          qty_ordered: line.qty_ordered,
          unit_cost: line.unit_cost,
          status: 'pending',
          // last_event_id is NOT NULL + UNIQUE per row — one fresh id per line.
          last_event_id: globalThis.crypto.randomUUID(),
        }));

        const { error: insertError } = await supabase
          .from('purchase_order_lines')
          .insert(lineRows);

        if (insertError) {
          console.error('Error inserting PO lines:', insertError);
          return { data: null, error: new Error(insertError.message) };
        }
      }
    }

    return { data: { success: true }, error: null };
  } catch (err) {
    console.error('Exception updating PO:', err);
    return {
      data: null,
      error: err instanceof Error ? err : new Error('Unknown error')
    };
  }
}
