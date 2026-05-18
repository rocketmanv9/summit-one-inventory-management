/**
 * Ontology Seed — Bootstrap ontology from existing catalog data.
 *
 * Creates entity types for the core domain objects and aliases
 * from existing item names, vendor names, and location names.
 */

import { upsertEntityType, addAlias } from './ontology-client';
import { generateEmbedding } from '../embeddings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

function inv(supabase: SupabaseClientLike) {
  return supabase.schema('inventory');
}

// ─── Core Entity Types ───────────────────────────────────────────────

const CORE_ENTITY_TYPES = [
  { code: 'item', label: 'Catalog Item', service_owner: 'inventory', description: 'A material, product, or supply tracked in inventory' },
  { code: 'vendor', label: 'Vendor', service_owner: 'inventory', description: 'A supplier or provider company' },
  { code: 'location', label: 'Location', service_owner: 'inventory', description: 'A warehouse, yard, job site, or truck' },
  { code: 'asset', label: 'Asset', service_owner: 'inventory', description: 'A serialized piece of equipment, vehicle, or tool' },
  { code: 'purchase_order', label: 'Purchase Order', service_owner: 'inventory', description: 'An order placed with a vendor' },
  { code: 'transfer', label: 'Transfer', service_owner: 'inventory', description: 'A movement of stock between locations' },
  { code: 'reservation', label: 'Reservation', service_owner: 'inventory', description: 'A hold on inventory for a job or purpose' },
  { code: 'category', label: 'Category', service_owner: 'inventory', description: 'A classification group for catalog items' },
];

/**
 * Seed core entity types for a tenant.
 */
export async function seedEntityTypes(
  supabase: SupabaseClientLike,
  tenantId: string
): Promise<number> {
  let count = 0;
  for (const et of CORE_ENTITY_TYPES) {
    const embedding = await generateEmbedding(`${et.label}: ${et.description}`);
    await upsertEntityType(supabase, tenantId, {
      ...et,
      embedding: embedding.length > 0 ? embedding : undefined,
    });
    count++;
  }
  return count;
}

/**
 * Seed aliases from existing catalog items, vendors, and locations.
 * Processes in batches to avoid overwhelming the embedding API.
 */
export async function seedAliasesFromExistingData(
  supabase: SupabaseClientLike,
  tenantId: string,
  batchSize: number = 50
): Promise<{ items: number; vendors: number; locations: number }> {
  const counts = { items: 0, vendors: 0, locations: 0 };

  // Seed item aliases
  const { data: items } = await inv(supabase)
    .from('catalog_items')
    .select('id, name, sku, description')
    .eq('tenant_id', tenantId)
    .limit(batchSize);

  if (items) {
    for (const item of items) {
      // Primary name alias
      const embedding = await generateEmbedding(item.name);
      await addAlias(supabase, tenantId, {
        entity_type: 'item',
        entity_id: item.id,
        alias: item.name,
        alias_type: 'name',
        embedding: embedding.length > 0 ? embedding : undefined,
      });
      counts.items++;

      // SKU alias if present
      if (item.sku) {
        await addAlias(supabase, tenantId, {
          entity_type: 'item',
          entity_id: item.id,
          alias: item.sku,
          alias_type: 'sku',
        });
      }
    }
  }

  // Seed vendor aliases
  const { data: vendors } = await inv(supabase)
    .from('vendors')
    .select('id, name, code')
    .eq('tenant_id', tenantId)
    .limit(batchSize);

  if (vendors) {
    for (const vendor of vendors) {
      const embedding = await generateEmbedding(vendor.name);
      await addAlias(supabase, tenantId, {
        entity_type: 'vendor',
        entity_id: vendor.id,
        alias: vendor.name,
        alias_type: 'name',
        embedding: embedding.length > 0 ? embedding : undefined,
      });
      counts.vendors++;

      if (vendor.code) {
        await addAlias(supabase, tenantId, {
          entity_type: 'vendor',
          entity_id: vendor.id,
          alias: vendor.code,
          alias_type: 'code',
        });
      }
    }
  }

  // Seed location aliases
  const { data: locations } = await inv(supabase)
    .from('locations')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .limit(batchSize);

  if (locations) {
    for (const loc of locations) {
      const embedding = await generateEmbedding(loc.name);
      await addAlias(supabase, tenantId, {
        entity_type: 'location',
        entity_id: loc.id,
        alias: loc.name,
        alias_type: 'name',
        embedding: embedding.length > 0 ? embedding : undefined,
      });
      counts.locations++;
    }
  }

  return counts;
}
