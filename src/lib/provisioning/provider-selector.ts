/**
 * Provider Selector
 *
 * Picks the best fulfillment provider for each provisioning line based on:
 * 1. Kit line override (explicit provider assignment)
 * 2. Provider-item mapping (exact match in provider_item_mappings)
 * 3. Internal stock availability check
 * 4. Capability-based fallback
 * 5. Backorder if nothing available
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProviderSelection {
  providerId: string | null;
  providerType: string;
  fulfillmentMethod: 'from_stock' | 'external_order' | 'backorder';
  sourceLocationId?: string;
  externalProductId?: string;
  externalVariantId?: string;
}

export interface LineForSelection {
  catalogItemId: string;
  qty: number;
  kitLineProviderId?: string | null;
}

interface ProviderRecord {
  id: string;
  provider_key: string;
  provider_type: string;
  priority: number;
  is_active: boolean;
}

interface MappingRecord {
  provider_id: string;
  external_product_id: string | null;
  external_variant_id: string | null;
  providers: ProviderRecord;
}

/**
 * Check if internal inventory has sufficient stock for an item.
 */
async function checkInternalStock(
  inv: any,
  catalogItemId: string,
  qty: number,
): Promise<{ available: boolean; locationId: string | null }> {
  const { data: balances } = await inv
    .from('stock_balances')
    .select('location_id, qty_available')
    .eq('catalog_item_id', catalogItemId)
    .gt('qty_available', qty - 1)
    .order('qty_available', { ascending: false })
    .limit(1);

  if (balances && balances.length > 0) {
    return { available: true, locationId: balances[0].location_id };
  }
  return { available: false, locationId: null };
}

/**
 * Select the best provider for a single provisioning line.
 */
export async function selectProvider(
  supabase: SupabaseClient,
  tenantId: string,
  line: LineForSelection,
): Promise<ProviderSelection> {
  const inv = (supabase as any).schema('inventory');
  const prov = (supabase as any).schema('provisioning');

  // 1. Kit line override: explicit provider assignment
  if (line.kitLineProviderId) {
    const { data: provider } = await prov
      .from('providers')
      .select('*')
      .eq('id', line.kitLineProviderId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .limit(1)
      .single();

    if (provider) {
      if (provider.provider_type === 'internal_warehouse') {
        const stock = await checkInternalStock(inv, line.catalogItemId, line.qty);
        if (stock.available) {
          return {
            providerId: provider.id,
            providerType: provider.provider_type,
            fulfillmentMethod: 'from_stock',
            sourceLocationId: stock.locationId!,
          };
        }
      }

      // Check if there's a mapping for this provider + item
      const { data: mapping } = await prov
        .from('provider_item_mappings')
        .select('external_product_id, external_variant_id')
        .eq('provider_id', provider.id)
        .eq('catalog_item_id', line.catalogItemId)
        .eq('tenant_id', tenantId)
        .limit(1)
        .single();

      return {
        providerId: provider.id,
        providerType: provider.provider_type,
        fulfillmentMethod: 'external_order',
        externalProductId: mapping?.external_product_id ?? undefined,
        externalVariantId: mapping?.external_variant_id ?? undefined,
      };
    }
  }

  // 2. Check for provider-item mappings (best match by provider priority)
  const { data: mappings } = await prov
    .from('provider_item_mappings')
    .select('provider_id, external_product_id, external_variant_id, providers!inner(id, provider_key, provider_type, priority, is_active)')
    .eq('tenant_id', tenantId)
    .eq('catalog_item_id', line.catalogItemId)
    .eq('providers.is_active', true)
    .order('providers(priority)', { ascending: true })
    .limit(10);

  if (mappings && mappings.length > 0) {
    const best = mappings[0] as unknown as MappingRecord;
    const provider = best.providers;

    if (provider.provider_type === 'internal_warehouse') {
      const stock = await checkInternalStock(inv, line.catalogItemId, line.qty);
      if (stock.available) {
        return {
          providerId: provider.id,
          providerType: provider.provider_type,
          fulfillmentMethod: 'from_stock',
          sourceLocationId: stock.locationId!,
        };
      }
    }

    return {
      providerId: provider.id,
      providerType: provider.provider_type,
      fulfillmentMethod: 'external_order',
      externalProductId: best.external_product_id ?? undefined,
      externalVariantId: best.external_variant_id ?? undefined,
    };
  }

  // 3. Check internal stock (any internal_warehouse provider)
  const { data: warehouseProviders } = await prov
    .from('providers')
    .select('id, provider_type')
    .eq('tenant_id', tenantId)
    .eq('provider_type', 'internal_warehouse')
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(1);

  if (warehouseProviders && warehouseProviders.length > 0) {
    const stock = await checkInternalStock(inv, line.catalogItemId, line.qty);
    if (stock.available) {
      return {
        providerId: warehouseProviders[0].id,
        providerType: 'internal_warehouse',
        fulfillmentMethod: 'from_stock',
        sourceLocationId: stock.locationId!,
      };
    }
  }

  // 4. No provider found — backorder
  return {
    providerId: null,
    providerType: 'none',
    fulfillmentMethod: 'backorder',
  };
}

/**
 * Select providers for all lines in a provisioning request.
 */
export async function selectProvidersForLines(
  supabase: SupabaseClient,
  tenantId: string,
  lines: LineForSelection[],
): Promise<ProviderSelection[]> {
  const results: ProviderSelection[] = [];
  for (const line of lines) {
    const selection = await selectProvider(supabase, tenantId, line);
    results.push(selection);
  }
  return results;
}
