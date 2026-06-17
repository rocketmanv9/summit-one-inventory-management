import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const inv = (supabase as any).schema('inventory');

  // Actually generate/refresh alerts: scans stock vs reorder points, upserts an
  // alert per item needing reorder, and auto-dismisses ones that are resolved.
  // (Previously this only read a view and never wrote any alerts.)
  const { data, error } = await inv.rpc('generate_reorder_alerts');

  if (error) {
    log.error('alerts.refresh_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const created = row?.alerts_created ?? 0;
  const updated = row?.alerts_updated ?? 0;
  const dismissed = row?.alerts_auto_dismissed ?? 0;

  log.info('alerts.refreshed', { created, updated, dismissed });

  return {
    data: {
      refreshed: true,
      alerts_count: created + updated,
      alerts_created: created,
      alerts_updated: updated,
      alerts_auto_dismissed: dismissed,
    },
    status: 200,
    events: [],
  };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/alerts/refresh' });
