/**
 * AI Reindex — populate the data the "smart" tools depend on.
 *
 * Backfills catalog_items.embedding (powers `semantic_search`) and seeds the
 * ontology — entity types, aliases, and derived relationships — which power
 * `resolve_entity`, `query_relationships`, and `find_substitutes`.
 *
 * Run via POST /api/ai/reindex (admin only). Safe to run repeatedly: item
 * embeddings only fill rows that lack one, ontology upserts are idempotent,
 * and derived relationships are cleared-and-rebuilt each run.
 */

import { generateEmbeddingBatch, buildEmbeddingText } from './embeddings';
import { seedEntityTypes, seedAliasesFromExistingData, deriveRelationships } from './ontology/seed';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

export interface ReindexResult {
  itemsEmbedded: number;
  itemsRemaining: number;
  entityTypes: number;
  aliases: { items: number; vendors: number; locations: number };
  relationships: { supplied_by: number; stored_at: number };
}

/**
 * Backfill embeddings for catalog items that don't have one yet.
 * Returns the number embedded plus how many still lack an embedding after
 * this batch (so callers can loop until itemsRemaining === 0).
 */
async function backfillItemEmbeddings(
  supabase: SupabaseClientLike,
  tenantId: string,
  batchSize: number
): Promise<{ embedded: number; remaining: number }> {
  const inv = supabase.schema('inventory');

  const { data: items } = await inv
    .from('catalog_items')
    .select('id, name, sku, description, category_id')
    .eq('tenant_id', tenantId)
    .is('embedding', null)
    .is('deleted_at', null)
    .limit(batchSize);

  if (!items || items.length === 0) {
    return { embedded: 0, remaining: 0 };
  }

  // Resolve category names for richer embedding text.
  const catIds = [...new Set(items.map((i: any) => i.category_id).filter(Boolean))];
  let catMap: Record<string, string> = {};
  if (catIds.length > 0) {
    const { data: cats } = await inv
      .from('item_categories')
      .select('id, name')
      .in('id', catIds as string[])
      .limit(500);
    catMap = Object.fromEntries((cats || []).map((c: any) => [c.id, c.name]));
  }

  const texts = items.map((i: any) =>
    buildEmbeddingText({
      name: i.name,
      sku: i.sku,
      description: i.description,
      category: i.category_id ? catMap[i.category_id] : undefined,
    })
  );

  const vectors = await generateEmbeddingBatch(texts);

  let embedded = 0;
  for (let k = 0; k < items.length; k++) {
    const vector = vectors[k];
    if (!vector || vector.length === 0) continue;
    const { error } = await inv
      .from('catalog_items')
      .update({ embedding: vector })
      .eq('id', items[k].id)
      .eq('tenant_id', tenantId);
    if (!error) embedded++;
  }

  // Count what's still missing after this batch.
  const { count } = await inv
    .from('catalog_items')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)
    .is('embedding', null)
    .is('deleted_at', null);

  return { embedded, remaining: count ?? 0 };
}

/**
 * Run a full reindex for a tenant: item embeddings + ontology seed + relationships.
 */
export async function reindexTenant(
  supabase: SupabaseClientLike,
  tenantId: string,
  opts?: { itemBatch?: number; aliasBatch?: number }
): Promise<ReindexResult> {
  const { embedded, remaining } = await backfillItemEmbeddings(
    supabase,
    tenantId,
    opts?.itemBatch ?? 100
  );

  const entityTypes = await seedEntityTypes(supabase, tenantId);
  const aliases = await seedAliasesFromExistingData(supabase, tenantId, opts?.aliasBatch ?? 100);
  const relationships = await deriveRelationships(supabase, tenantId);

  return {
    itemsEmbedded: embedded,
    itemsRemaining: remaining,
    entityTypes,
    aliases,
    relationships,
  };
}
