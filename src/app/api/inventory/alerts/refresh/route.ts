import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const inv = (supabase as any).schema('inventory');

  // Query items below par levels to generate/refresh alerts
  const { data: itemsBelowPar, error: parError } = await inv
    .from('v_items_below_par')
    .select('*')
    .limit(500);

  if (parError) {
    log.error('alerts.refresh_failed', { error: parError.message });
    throw AppError.internal(parError.message);
  }

  log.info('alerts.refreshed', { count: itemsBelowPar?.length || 0 });

  return {
    data: { refreshed: true, alerts_count: itemsBelowPar?.length || 0 },
    status: 200,
    events: [{
      event_name: 'alerts.refreshed',
      payload: { count: itemsBelowPar?.length || 0 },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/alerts/refresh' });
