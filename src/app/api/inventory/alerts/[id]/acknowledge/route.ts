import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function getAlertId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('alerts');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing alert ID');
  return id;
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const alertId = getAlertId(req);
  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.rpc('rpc_acknowledge_alert', {
    p_alert_id: alertId,
  });

  if (error) {
    log.error('alert.acknowledge_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  log.info('alert.acknowledged', { alertId });

  return {
    data: data || { alert_id: alertId },
    status: 200,
    events: [{
      event_name: 'alert.acknowledged',
      payload: { alert_id: alertId },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/alerts/:id/acknowledge' });
