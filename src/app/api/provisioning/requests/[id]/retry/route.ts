import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import { getProvider } from '@/lib/provisioning/providers/registry';
import '@/lib/provisioning/providers/internal-warehouse';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RetrySchema = z.object({
  line_ids: z.array(z.string().uuid()).optional(),
});

export const POST = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey, ctx }) => {
  const urlParts = req.url.split('/requests/');
  const id = urlParts[1]?.split('/')[0];
  if (!id) throw AppError.badRequest('Request ID required');

  const body = RetrySchema.parse(await req.json());
  const prov = (supabase as any).schema('provisioning');

  // Load failed lines
  let query = prov
    .from('provisioning_lines')
    .select('*, providers(provider_type)')
    .eq('request_id', id)
    .eq('tenant_id', ctx.tenantId)
    .in('status', ['failed', 'backordered'])
    .limit(100);

  if (body.line_ids && body.line_ids.length > 0) {
    query = query.in('id', body.line_ids);
  }

  const { data: failedLines } = await query;
  if (!failedLines || failedLines.length === 0) {
    throw AppError.badRequest('No failed or backordered lines found to retry');
  }

  const events: Array<{ event_name: string; payload: Record<string, unknown>; last_event_id: string }> = [];
  let retriedCount = 0;

  for (const line of failedLines) {
    const providerType = line.providers?.provider_type ?? 'internal_warehouse';
    const provider = getProvider(providerType);
    if (!provider) continue;

    const lineIdempKey = `prov-retry-${ctx.tenantId}-${line.id}-${Date.now()}`;
    const result = await provider.placeOrder(
      {
        tenantId: ctx.tenantId,
        requestId: id,
        idempotencyKey: lineIdempKey,
        items: [{
          lineId: line.id,
          catalogItemId: line.catalog_item_id,
          externalProductId: '',
          externalVariantId: '',
          qty: line.qty,
        }],
      },
      {},
    );

    const newStatus = result.success ? 'reserved' : 'failed';
    await prov
      .from('provisioning_lines')
      .update({ status: newStatus, last_event_id: lineIdempKey })
      .eq('id', line.id);

    await prov
      .from('provisioning_history')
      .insert({
        tenant_id: ctx.tenantId,
        request_id: id,
        line_id: line.id,
        action: 'line_retried',
        old_status: line.status,
        new_status: newStatus,
        actor_user_id: ctx.userId,
      });

    events.push({
      event_name: `provision_line.${newStatus}`,
      payload: { line_id: line.id, request_id: id },
      last_event_id: lineIdempKey,
    });

    if (result.success) retriedCount++;
  }

  log.info('request.retried', { requestId: id, retriedCount, total: failedLines.length });

  return {
    data: { retried: retriedCount, total: failedLines.length },
    status: 200,
    events,
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/provisioning/requests/[id]/retry' });
