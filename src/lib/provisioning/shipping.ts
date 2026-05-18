/**
 * Shipping Address Resolution
 *
 * Resolves the shipping address for a provisioning order using a priority chain:
 *   1. Explicit address passed on the request
 *   2. Specific location by ID (shipping_address JSONB on inventory.locations)
 *   3. Tenant default location (is_default_ship_to = true)
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@rocketmanv9/chassis/errors';
import type { ShippingAddress } from './providers/types';

export async function resolveShippingAddress(
  supabase: SupabaseClient,
  tenantId: string,
  options?: {
    explicitAddress?: ShippingAddress;
    shipToLocationId?: string;
  },
): Promise<ShippingAddress> {
  // Priority 1: explicit address on the request
  if (options?.explicitAddress) {
    return options.explicitAddress;
  }

  // Priority 2: specific location by ID
  if (options?.shipToLocationId) {
    const inv = (supabase as any).schema('inventory');
    const { data: location, error } = await inv
      .from('locations')
      .select('shipping_address, name, address')
      .eq('tenant_id', tenantId)
      .eq('id', options.shipToLocationId)
      .limit(1)
      .single();

    if (error || !location) {
      throw AppError.badRequest(`Location ${options.shipToLocationId} not found for tenant`);
    }

    if (location.shipping_address) {
      return location.shipping_address as ShippingAddress;
    }

    throw AppError.badRequest(
      `Location "${location.name}" does not have a shipping address configured`,
    );
  }

  // Priority 3: tenant default ship-to location
  const inv = (supabase as any).schema('inventory');
  const { data: defaultLocation, error: defaultErr } = await inv
    .from('locations')
    .select('shipping_address, name, address')
    .eq('tenant_id', tenantId)
    .eq('is_default_ship_to', true)
    .limit(1)
    .single();

  if (!defaultErr && defaultLocation?.shipping_address) {
    return defaultLocation.shipping_address as ShippingAddress;
  }

  throw AppError.badRequest(
    'No shipping address available. Provide an explicit address, a ship-to location ID, or configure a default ship-to location for the tenant.',
  );
}
