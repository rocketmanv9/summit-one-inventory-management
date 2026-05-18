/**
 * Entity Resolver — Resolve free-text to canonical entities.
 *
 * Resolution chain: exact match → alias match → vector similarity
 */

import { generateEmbedding } from '../embeddings';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

function inv(supabase: SupabaseClientLike) {
  return supabase.schema('inventory');
}

export interface ResolvedEntity {
  entity_type: string;
  entity_id: string;
  canonical_name: string;
  match_method: 'exact' | 'alias' | 'vector' | 'none';
  confidence: number;
}

/**
 * Resolve a free-text entity reference to a canonical entity.
 *
 * Resolution chain:
 * 1. Exact match on entity name in the source table
 * 2. Alias match in ontology_aliases
 * 3. Vector similarity on alias embeddings
 */
export async function resolveEntity(
  supabase: SupabaseClientLike,
  tenantId: string,
  text: string,
  entityType?: string
): Promise<ResolvedEntity | null> {
  const normalizedText = text.trim().toLowerCase();
  if (!normalizedText) return null;

  // 1. Try exact match in common entity tables
  const exactMatch = await tryExactMatch(supabase, tenantId, normalizedText, entityType);
  if (exactMatch) return exactMatch;

  // 2. Try alias match
  const aliasMatch = await tryAliasMatch(supabase, tenantId, normalizedText, entityType);
  if (aliasMatch) return aliasMatch;

  // 3. Try vector similarity
  const vectorMatch = await tryVectorMatch(supabase, tenantId, normalizedText, entityType);
  if (vectorMatch) return vectorMatch;

  return null;
}

async function tryExactMatch(
  supabase: SupabaseClientLike,
  tenantId: string,
  text: string,
  entityType?: string
): Promise<ResolvedEntity | null> {
  // Check common entity tables by name
  const tables: Array<{ table: string; type: string; nameCol: string; schema: string }> = [
    { table: 'catalog_items', type: 'item', nameCol: 'name', schema: 'inventory' },
    { table: 'vendors', type: 'vendor', nameCol: 'name', schema: 'inventory' },
    { table: 'locations', type: 'location', nameCol: 'name', schema: 'inventory' },
    { table: 'assets', type: 'asset', nameCol: 'name', schema: 'inventory' },
  ];

  const filtered = entityType ? tables.filter((t) => t.type === entityType) : tables;

  for (const { table, type, nameCol, schema } of filtered) {
    const { data } = await supabase
      .schema(schema)
      .from(table)
      .select('id, name')
      .eq('tenant_id', tenantId)
      .ilike(nameCol, text)
      .limit(1);

    if (data && data.length > 0) {
      return {
        entity_type: type,
        entity_id: data[0].id,
        canonical_name: data[0].name,
        match_method: 'exact',
        confidence: 1.0,
      };
    }
  }

  return null;
}

async function tryAliasMatch(
  supabase: SupabaseClientLike,
  tenantId: string,
  text: string,
  entityType?: string
): Promise<ResolvedEntity | null> {
  let query = inv(supabase)
    .from('ontology_aliases')
    .select('entity_type, entity_id, alias')
    .eq('tenant_id', tenantId)
    .ilike('alias', text)
    .limit(1);

  if (entityType) {
    query = query.eq('entity_type', entityType);
  }

  const { data } = await query;

  if (data && data.length > 0) {
    return {
      entity_type: data[0].entity_type,
      entity_id: data[0].entity_id,
      canonical_name: data[0].alias,
      match_method: 'alias',
      confidence: 0.9,
    };
  }

  return null;
}

async function tryVectorMatch(
  supabase: SupabaseClientLike,
  tenantId: string,
  text: string,
  entityType?: string
): Promise<ResolvedEntity | null> {
  try {
    const embedding = await generateEmbedding(text);
    if (!embedding || embedding.length === 0) return null;

    // Use RPC for vector similarity search on aliases
    const { data } = await inv(supabase).rpc('rpc_resolve_entity_by_vector', {
      query_embedding: embedding,
      match_tenant_id: tenantId,
      match_entity_type: entityType || null,
      match_count: 1,
      min_similarity: 0.75,
    });

    if (data && data.length > 0) {
      return {
        entity_type: data[0].entity_type,
        entity_id: data[0].entity_id,
        canonical_name: data[0].alias,
        match_method: 'vector',
        confidence: data[0].similarity,
      };
    }
  } catch {
    // Vector search is a best-effort enhancement
  }

  return null;
}

/**
 * Resolve multiple entities from a text string.
 * Splits on common delimiters and resolves each part.
 */
export async function resolveEntities(
  supabase: SupabaseClientLike,
  tenantId: string,
  text: string
): Promise<ResolvedEntity[]> {
  // Split on "and", commas, semicolons
  const parts = text.split(/\s*(?:,|;|\band\b)\s*/).filter(Boolean);
  const results: ResolvedEntity[] = [];

  for (const part of parts) {
    const resolved = await resolveEntity(supabase, tenantId, part.trim());
    if (resolved) results.push(resolved);
  }

  return results;
}
