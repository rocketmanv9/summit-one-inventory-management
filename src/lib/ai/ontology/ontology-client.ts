/**
 * Ontology Client — CRUD for entity types, relationships, and aliases.
 *
 * All operations are tenant-scoped via the injected Supabase client.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

function inv(supabase: SupabaseClientLike) {
  return supabase.schema('inventory');
}

// ─── Entity Types ────────────────────────────────────────────────────

export interface OntologyEntityType {
  id: string;
  tenant_id: string;
  code: string;
  label: string;
  gv_term_id?: string | null;
  description?: string | null;
  service_owner?: string | null;
  embedding?: number[] | null;
  created_at: string;
  updated_at: string;
}

export async function listEntityTypes(
  supabase: SupabaseClientLike,
  tenantId: string
): Promise<OntologyEntityType[]> {
  const { data } = await inv(supabase)
    .from('ontology_entity_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('code')
    .limit(500);
  return data || [];
}

export async function upsertEntityType(
  supabase: SupabaseClientLike,
  tenantId: string,
  entityType: {
    code: string;
    label: string;
    gv_term_id?: string;
    description?: string;
    service_owner?: string;
    embedding?: number[];
  }
): Promise<OntologyEntityType | null> {
  const { data } = await inv(supabase)
    .from('ontology_entity_types')
    .upsert(
      { tenant_id: tenantId, ...entityType, updated_at: new Date().toISOString() },
      { onConflict: 'tenant_id,code' }
    )
    .select()
    .single();
  return data;
}

// ─── Relationships ───────────────────────────────────────────────────

export type RelationType =
  | 'is_a' | 'same_as' | 'includes' | 'owned_by' | 'substitute_for'
  | 'supplied_by' | 'requires' | 'related_to' | 'stored_at' | 'part_of';

export interface OntologyRelationship {
  id: string;
  tenant_id: string;
  source_type: string;
  source_id: string | null;
  relation: RelationType;
  target_type: string;
  target_id: string | null;
  confidence: number;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export async function addRelationship(
  supabase: SupabaseClientLike,
  tenantId: string,
  rel: {
    source_type: string;
    source_id?: string;
    relation: RelationType;
    target_type: string;
    target_id?: string;
    confidence?: number;
    metadata?: Record<string, any>;
  }
): Promise<OntologyRelationship | null> {
  const { data } = await inv(supabase)
    .from('ontology_relationships')
    .insert({
      tenant_id: tenantId,
      ...rel,
      confidence: rel.confidence ?? 1.0,
      metadata: rel.metadata ?? {},
    })
    .select()
    .single();
  return data;
}

export async function queryRelationships(
  supabase: SupabaseClientLike,
  tenantId: string,
  filters: {
    source_type?: string;
    source_id?: string;
    relation?: RelationType;
    target_type?: string;
    target_id?: string;
  },
  limit: number = 50
): Promise<OntologyRelationship[]> {
  let query = inv(supabase)
    .from('ontology_relationships')
    .select('*')
    .eq('tenant_id', tenantId);

  if (filters.source_type) query = query.eq('source_type', filters.source_type);
  if (filters.source_id) query = query.eq('source_id', filters.source_id);
  if (filters.relation) query = query.eq('relation', filters.relation);
  if (filters.target_type) query = query.eq('target_type', filters.target_type);
  if (filters.target_id) query = query.eq('target_id', filters.target_id);

  const { data } = await query.order('created_at', { ascending: false }).limit(limit);
  return data || [];
}

// ─── Aliases ─────────────────────────────────────────────────────────

export interface OntologyAlias {
  id: string;
  tenant_id: string;
  entity_type: string;
  entity_id: string;
  alias: string;
  alias_type: string;
  embedding?: number[] | null;
  created_at: string;
}

export async function addAlias(
  supabase: SupabaseClientLike,
  tenantId: string,
  aliasData: {
    entity_type: string;
    entity_id: string;
    alias: string;
    alias_type?: string;
    embedding?: number[];
  }
): Promise<OntologyAlias | null> {
  const { data } = await inv(supabase)
    .from('ontology_aliases')
    .upsert(
      {
        tenant_id: tenantId,
        entity_type: aliasData.entity_type,
        entity_id: aliasData.entity_id,
        alias: aliasData.alias.toLowerCase(),
        alias_type: aliasData.alias_type || 'name',
        embedding: aliasData.embedding || null,
      },
      { onConflict: 'tenant_id,entity_type,alias' }
    )
    .select()
    .single();
  return data;
}

export async function findAliases(
  supabase: SupabaseClientLike,
  tenantId: string,
  entityType: string,
  searchText: string
): Promise<OntologyAlias[]> {
  const { data } = await inv(supabase)
    .from('ontology_aliases')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('entity_type', entityType)
    .ilike('alias', `%${searchText.toLowerCase()}%`)
    .limit(10);
  return data || [];
}
