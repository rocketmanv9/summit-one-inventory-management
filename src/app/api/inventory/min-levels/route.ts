/**
 * Min-levels accept route (automagic 01).
 *
 * Writes AI-proposed (and human-reviewed/edited) stocking levels onto
 * catalog_items in one batch. This is the ONLY place levels are written — the
 * AI route just proposes; nothing lands until the user explicitly accepts here.
 *
 * Each accepted row carries its expected_last_event_id so a stale write becomes
 * a per-item conflict instead of clobbering someone else's edit (same OCC guard
 * as PATCH /api/inventory/items/[id]). The catalog_items outbox trigger emits
 * the change event, so this route sets emissionOwner: 'trigger' and returns
 * events: []. After the batch, mv_low_stock_summary is refreshed so the Low
 * Stock widget reflects the new thresholds immediately.
 */

import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const nonNegOrNull = z.number().nonnegative().nullable();

const LevelUpdate = z.object({
  catalog_item_id: z.string().uuid(),
  expected_last_event_id: z.string().min(1),
  min_stock_level: nonNegOrNull.optional().default(null),
  reorder_point: nonNegOrNull.optional().default(null),
  reorder_qty: nonNegOrNull.optional().default(null),
});

const RequestSchema = z.object({
  updates: z.array(LevelUpdate).min(1, 'Nothing to accept').max(500),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const body = await req.json();
  const { updates } = RequestSchema.parse(body);

  const inv = (supabase as any).schema('inventory');

  const applied: string[] = [];
  const conflicts: string[] = [];
  const failures: Array<{ id: string; error: string }> = [];

  // Per-item OCC update. A fresh last_event_id per row keeps each item's version
  // chain intact; the .eq('last_event_id', expected) guard turns a stale row
  // into a conflict rather than an overwrite.
  for (const u of updates) {
    const newEventId = `${idempotencyKey}:${u.catalog_item_id}`;
    const { data, error } = await inv
      .from('catalog_items')
      .update({
        min_stock_level: u.min_stock_level,
        reorder_point: u.reorder_point,
        reorder_qty: u.reorder_qty,
        last_event_id: newEventId,
      })
      .eq('id', u.catalog_item_id)
      .eq('last_event_id', u.expected_last_event_id)
      .select('id, last_event_id')
      .maybeSingle();

    if (error) {
      failures.push({ id: u.catalog_item_id, error: error.message });
      continue;
    }
    if (!data) {
      conflicts.push(u.catalog_item_id);
      continue;
    }
    applied.push(u.catalog_item_id);
  }

  if (applied.length === 0 && failures.length > 0) {
    throw AppError.internal(`Failed to write any levels: ${failures[0].error}`);
  }

  // Wake the Low Stock rollup so the widget reflects the new thresholds now.
  let lowStockRefreshed = false;
  if (applied.length > 0) {
    const { error: refreshErr } = await inv.rpc('rpc_refresh_min_level_views');
    if (refreshErr) log.warn('min_levels.accept_refresh_failed', { error: refreshErr.message });
    else lowStockRefreshed = true;
  }

  log.info(
    `[Min-Levels Accept] applied=${applied.length} conflicts=${conflicts.length} ` +
      `failures=${failures.length} low_stock_refreshed=${lowStockRefreshed}`,
  );

  return {
    data: {
      applied,
      conflicts,
      failures,
      applied_count: applied.length,
      conflict_count: conflicts.length,
      failure_count: failures.length,
      low_stock_refreshed: lowStockRefreshed,
    },
    status: 200,
    events: [],
  };
}, {
  bodySchema: 'raw',
  emissionOwner: 'trigger',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/inventory/min-levels',
});
