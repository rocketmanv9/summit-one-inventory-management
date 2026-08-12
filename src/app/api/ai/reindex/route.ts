/**
 * AI Reindex Route — admin maintenance endpoint.
 *
 * Populates the data the AI "smart" tools depend on:
 *   - catalog_items.embedding  -> powers semantic_search
 *   - ontology entity types / aliases / relationships
 *     -> power resolve_entity, query_relationships, find_substitutes
 *
 * Admin-only. Idempotent — safe to re-run; loop until itemsRemaining === 0
 * for catalogs larger than one batch.
 */

import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { resolveUserRole } from '@/lib/ai/tool-governance';
import { reindexTenant } from '@/lib/ai/reindex';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const ReindexSchema = z.object({
  item_batch: z.number().int().min(1).max(500).optional(),
  alias_batch: z.number().int().min(1).max(500).optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const userId = ctx.userId;
  const tenantId = ctx.tenantId;
  if (!userId || !tenantId) {
    throw AppError.unauthorized('Missing session context.');
  }

  // Admin gate — reindexing touches embeddings + ontology for the whole tenant.
  const role = await resolveUserRole(supabase, userId, tenantId);
  if (role !== 'admin') {
    throw AppError.forbidden('Reindexing requires an admin role.');
  }

  let body: z.infer<typeof ReindexSchema> = {};
  try {
    const raw = await req.json();
    body = ReindexSchema.parse(raw ?? {});
  } catch {
    // Empty / missing body is fine — fall back to defaults.
  }

  if (!process.env.OPENAI_API_KEY) {
    throw AppError.badRequest('OPENAI_API_KEY is not configured — embeddings cannot be generated.');
  }

  const result = await reindexTenant(supabase, tenantId, {
    itemBatch: body.item_batch,
    aliasBatch: body.alias_batch,
  });

  log.info('ai.reindexed', { ...result });

  return {
    data: result,
    status: 200,
    events: [{
      event_name: 'ai.reindexed',
      payload: {
        tenant_id: tenantId,
        items_embedded: result.itemsEmbedded,
        items_remaining: result.itemsRemaining,
        entity_types: result.entityTypes,
        relationships: result.relationships,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, {
  bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/ai/reindex',
});
