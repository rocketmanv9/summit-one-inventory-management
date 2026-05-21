/**
 * Ontology — Public API barrel export.
 *
 * Consolidates entity resolution, relationship queries, and ontology
 * CRUD into a single import path: `@/lib/ai/ontology`.
 */

// Entity resolution
export { resolveEntity, resolveEntities } from './entity-resolver';
export type { ResolvedEntity } from './entity-resolver';

// Ontology CRUD (entity types, relationships, aliases)
export {
  listEntityTypes,
  upsertEntityType,
  addRelationship,
  queryRelationships,
  addAlias,
  findAliases,
} from './ontology-client';
export type {
  OntologyEntityType,
  OntologyRelationship,
  OntologyAlias,
  RelationType,
} from './ontology-client';

// Relationship queries
export {
  findSubstitutes,
  findSuppliers,
  findComponents,
  findAllRelationships,
  findStoredAt,
} from './relationship-query';
export type { RelationshipResult } from './relationship-query';

// Seeding
export { seedEntityTypes, seedAliasesFromExistingData } from './seed';
