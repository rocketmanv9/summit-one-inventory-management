import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('transfers') + 1];
  if (!id) throw AppError.badRequest('Missing transfer id');
  return id;
}

const LineSchema = z.object({
  id: z.string().optional(),
  catalog_item_id: z.string().min(1),
  qty: z.number(),
  last_event_id: z.string().optional(),
});

const BodySchema = z.object({
  expected_last_event_id: z.string().min(1),
  from_location_id: z.string().min(1),
  to_location_id: z.string().min(1),
  notes: z.string().nullable().optional(),
  lines: z.array(LineSchema),
});

// Edit a draft transfer: header + line reconciliation (delete removed, update
// kept, insert new). Mirrors the prior InventoryRPC.updateTransfer sequence —
// each write keeps its OCC guard (last_event_id). Not wrapped in a single DB
// transaction (PostgREST has no cross-statement txn), same as before; the
// idempotency guard makes a full retry safe. transfer/transfer_line triggers
// own emission.
export const PATCH = createSessionWriteRoute(async ({ req, body, log, supabase, idempotencyKey }) => {
  const transferId = extractId(req);
  const { expected_last_event_id, from_location_id, to_location_id, notes, lines } = body as z.infer<typeof BodySchema>;
  const inv = (supabase as any).schema('inventory');

  // 1) Header (OCC). Capture tenant_id to stamp on any new lines — transfer_lines
  // has no tenant-inject trigger or default, so the insert must set it explicitly
  // (the prior browser-side insert omitted it and would hit a NOT NULL violation).
  const { data: header, error: headerError } = await inv.from('transfers')
    .update({ from_location_id, to_location_id, notes, last_event_id: idempotencyKey })
    .eq('id', transferId).eq('last_event_id', expected_last_event_id)
    .select('id, tenant_id').maybeSingle();
  if (headerError) { log.error('transfer.update_failed', { error: headerError.message }); throw AppError.internal(headerError.message); }
  if (!header) throw AppError.conflict('Transfer was updated by someone else. Please refresh and try again.');
  const tenantId = header.tenant_id;

  // 2) Load existing lines to compute deletions.
  const { data: existingLines, error: existingError } = await inv.from('transfer_lines')
    .select('id, last_event_id').eq('transfer_id', transferId);
  if (existingError) { log.error('transfer.lines_load_failed', { error: existingError.message }); throw AppError.internal(existingError.message); }

  const existing = existingLines || [];
  const incomingIds = new Set(lines.filter((l) => l.id).map((l) => l.id as string));

  // 3) Delete lines no longer present (OCC per line).
  for (const line of existing) {
    if (!incomingIds.has(line.id)) {
      const { error: deleteError } = await inv.from('transfer_lines')
        .delete().eq('id', line.id).eq('last_event_id', line.last_event_id);
      if (deleteError) { log.error('transfer.line_delete_failed', { error: deleteError.message }); throw AppError.internal(deleteError.message); }
    }
  }

  // 4) Update kept lines / insert new ones (renumbered).
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (line.id) {
      if (!line.last_event_id) throw AppError.badRequest('Missing last_event_id for transfer line. Please refresh and try again.');
      const { error: lineError } = await inv.from('transfer_lines')
        .update({ catalog_item_id: line.catalog_item_id, qty: line.qty, line_number: lineNumber, last_event_id: crypto.randomUUID() })
        .eq('id', line.id).eq('last_event_id', line.last_event_id);
      if (lineError) { log.error('transfer.line_update_failed', { error: lineError.message }); throw AppError.internal(lineError.message); }
    } else {
      const { error: insertError } = await inv.from('transfer_lines')
        .insert({ tenant_id: tenantId, transfer_id: transferId, catalog_item_id: line.catalog_item_id, qty: line.qty, line_number: lineNumber, last_event_id: crypto.randomUUID() });
      if (insertError) { log.error('transfer.line_insert_failed', { error: insertError.message }); throw AppError.internal(insertError.message); }
    }
  }

  return { data: { id: transferId }, status: 200, events: [] };
}, { bodySchema: BodySchema, emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/transfers/[id]' });
