/**
 * Operations RPC Service Layer
 * Bounded Context: Operations (Globe visualization, network view)
 */

import { getStoredAccessToken } from '@/lib/auth-token';
import { AppError } from '@rocketmanv9/chassis/errors';

export interface GlobeLocation {
  id: string;
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  active: boolean;
  location_type: { id: string; name: string } | null;
}

export interface GlobeTransferLine {
  id: string;
  qty: number;
  catalog_items: { id: string; name: string; sku: string } | null;
}

export interface GlobeTransfer {
  id: string;
  status: string;
  notes: string | null;
  created_at: string;
  initiated_at: string | null;
  completed_at: string | null;
  from_location: { id: string; name: string; latitude: number | null; longitude: number | null } | null;
  to_location: { id: string; name: string; latitude: number | null; longitude: number | null } | null;
  transfer_lines: GlobeTransferLine[];
}

export interface GlobeVendor {
  id: string;
  name: string;
  code: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  city: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
}

export interface GlobePurchaseOrder {
  id: string;
  po_number: string;
  status: string;
  needed_by_date: string | null;
  vendor_id: string;
  delivery_location_id: string | null;
  created_at: string;
}

export interface GlobeData {
  locations: GlobeLocation[];
  transfers: GlobeTransfer[];
  vendors: GlobeVendor[];
  purchaseOrders: GlobePurchaseOrder[];
}

export interface GlobeFilters {
  date_from?: string;
  date_to?: string;
  show_vendors?: boolean;
  show_pos?: boolean;
  transfer_statuses?: string[];
  po_statuses?: string[];
}

export const OperationsRPC = {
  async getGlobeData(filters?: GlobeFilters): Promise<GlobeData> {
    const token = getStoredAccessToken();
    if (!token) {
      throw AppError.unauthorized('Authentication required');
    }

    const params = new URLSearchParams();
    if (filters?.date_from) params.set('date_from', filters.date_from);
    if (filters?.date_to) params.set('date_to', filters.date_to);
    if (filters?.show_vendors === false) params.set('show_vendors', 'false');
    if (filters?.show_pos === false) params.set('show_pos', 'false');

    const qs = params.toString();
    const url = `/api/operations/globe${qs ? `?${qs}` : ''}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw AppError.internal(body.error?.message || `Globe data fetch failed (${response.status})`);
    }

    const json = await response.json();
    return json.data;
  },
};
