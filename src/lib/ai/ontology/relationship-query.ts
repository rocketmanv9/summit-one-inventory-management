/**
 * Relationship Query — Traverse ontology relationships.
 *
 * Answers questions like "what substitutes for X?", "who supplies rebar?",
 * "what does location Y store?"
 */

import { queryRelationships, type RelationType, type OntologyRelationship } from './ontology-client';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseClientLike = any;

export interface RelationshipResult {
  relation: RelationType;
  entities: Array<{
    entity_type: string;
    entity_id: string | null;
    confidence: number;
    metadata: Record<string, any>;
  }>;
}

/**
 * Find substitutes for an entity.
 * Looks for substitute_for relationships in both directions.
 */
export async function findSubstitutes(
  supabase: SupabaseClientLike,
  tenantId: string,
  entityType: string,
  entityId: string
): Promise<RelationshipResult> {
  // Items that can substitute for this one
  const outbound = await queryRelationships(supabase, tenantId, {
    source_type: entityType,
    source_id: entityId,
    relation: 'substitute_for',
  });

  // Items that this one can substitute for
  const inbound = await queryRelationships(supabase, tenantId, {
    target_type: entityType,
    target_id: entityId,
    relation: 'substitute_for',
  });

  const entities = [
    ...outbound.map((r) => ({
      entity_type: r.target_type,
      entity_id: r.target_id,
      confidence: Number(r.confidence),
      metadata: r.metadata,
    })),
    ...inbound.map((r) => ({
      entity_type: r.source_type,
      entity_id: r.source_id,
      confidence: Number(r.confidence),
      metadata: r.metadata,
    })),
  ];

  return { relation: 'substitute_for', entities };
}

/**
 * Find suppliers for an entity (items supplied_by vendors).
 */
export async function findSuppliers(
  supabase: SupabaseClientLike,
  tenantId: string,
  entityType: string,
  entityId: string
): Promise<RelationshipResult> {
  const rels = await queryRelationships(supabase, tenantId, {
    source_type: entityType,
    source_id: entityId,
    relation: 'supplied_by',
  });

  return {
    relation: 'supplied_by',
    entities: rels.map((r) => ({
      entity_type: r.target_type,
      entity_id: r.target_id,
      confidence: Number(r.confidence),
      metadata: r.metadata,
    })),
  };
}

/**
 * Find components/parts of an entity.
 */
export async function findComponents(
  supabase: SupabaseClientLike,
  tenantId: string,
  entityType: string,
  entityId: string
): Promise<RelationshipResult> {
  const rels = await queryRelationships(supabase, tenantId, {
    source_type: entityType,
    source_id: entityId,
    relation: 'includes',
  });

  return {
    relation: 'includes',
    entities: rels.map((r) => ({
      entity_type: r.target_type,
      entity_id: r.target_id,
      confidence: Number(r.confidence),
      metadata: r.metadata,
    })),
  };
}

/**
 * Find all relationships for an entity (both directions).
 */
export async function findAllRelationships(
  supabase: SupabaseClientLike,
  tenantId: string,
  entityType: string,
  entityId: string
): Promise<OntologyRelationship[]> {
  const [outbound, inbound] = await Promise.all([
    queryRelationships(supabase, tenantId, {
      source_type: entityType,
      source_id: entityId,
    }),
    queryRelationships(supabase, tenantId, {
      target_type: entityType,
      target_id: entityId,
    }),
  ]);

  return [...outbound, ...inbound];
}

/**
 * Find what's stored at a location.
 */
export async function findStoredAt(
  supabase: SupabaseClientLike,
  tenantId: string,
  locationId: string
): Promise<RelationshipResult> {
  const rels = await queryRelationships(supabase, tenantId, {
    target_type: 'location',
    target_id: locationId,
    relation: 'stored_at',
  });

  return {
    relation: 'stored_at',
    entities: rels.map((r) => ({
      entity_type: r.source_type,
      entity_id: r.source_id,
      confidence: Number(r.confidence),
      metadata: r.metadata,
    })),
  };
}
