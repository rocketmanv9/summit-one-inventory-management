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

const BodySchema = z.object({ expected_last_event_id: z.string().min(1) });

// Ship a transfer (draft → in_transit): stamp qty_shipped on each line, then
// flip the header. Mirrors the prior InventoryRPC.shipTransfer sequence with
// per-line + header OCC guards. transfer/transfer_line triggers own emission.
export const POST = createSessionWriteRoute(async ({ req, body, log, supabase, idempotencyKey }) => {
  const transferId = extractId(req);
  const { expected_last_event_id } = body as z.infer<typeof BodySchema>;
  const inv = (supabase as any).schema('inventory');

  const { data: lines, error: lineError } = await inv.from('transfer_lines')
    .select('id, qty, last_event_id').eq('transfer_id', transferId);
  if (lineError) { log.error('transfer.ship_lines_load_failed', { error: lineError.message }); throw AppError.internal(lineError.message); }
  if (!lines || lines.length === 0) throw AppError.notFound('No transfer lines found. Please refresh and try again.');

  for (const line of lines) {
    const { error: updateError } = await inv.from('transfer_lines')
      .update({ qty_shipped: line.qty, last_event_id: crypto.randomUUID() })
      .eq('id', line.id).eq('last_event_id', line.last_event_id);
    if (updateError) { log.error('transfer.ship_line_failed', { error: updateError.message }); throw AppError.internal(updateError.message); }
  }

  const { data, error } = await inv.from('transfers')
    .update({ status: 'in_transit', initiated_at: new Date().toISOString(), last_event_id: idempotencyKey })
    .eq('id', transferId).eq('last_event_id', expected_last_event_id)
    .select('id').maybeSingle();
  if (error) { log.error('transfer.ship_failed', { error: error.message }); throw AppError.internal(error.message); }
  if (!data) throw AppError.conflict('Transfer was updated by someone else. Please refresh and try again.');

  return { data: { id: transferId }, status: 200, events: [] };
}, { bodySchema: BodySchema, emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/transfers/[id]/ship' });
