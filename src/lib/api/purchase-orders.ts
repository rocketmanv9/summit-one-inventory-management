/**
 * Purchase Order RPC Client & React Hooks
 * 
 * Provides type-safe wrappers around the supply_chain.rpc_create_purchase_order
 * function and React hooks for PO management.
 */

import { createClient } from '@/lib/supabase/client';
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
  const supabase = createClient();
  
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
  const supabase = createClient();
  
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
  const supabase = createClient();
  
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
  const supabase = createClient();
  
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
  const supabase = createClient();
  
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
  const supabase = createClient();
  
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
      const { data: locData } = await supabase
        .from('locations')
        .select('id, name, type')
        .eq('id', po.delivery_location_id)
        .single();
      delivery_location = locData;
    }
    
    if (po.pickup_location_id) {
      const { data: locData } = await supabase
        .from('locations')
        .select('id, name, type')
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
  const supabase = createClient();
  
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
  const supabase = createClient();
  
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
