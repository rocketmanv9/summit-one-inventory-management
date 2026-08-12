import { createInternalRoute } from '@rocketmanv9/chassis/nextjs';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/system/gv-backfill
 *
 * Internal-only route. Previously used to backfill GV term IDs from freetext columns.
 * The freetext columns (unit_of_measure, capacity_uom, vendor_uom, from_uom, to_uom)
 * have been dropped in the Phase 6 cleanup migration. All rows now use term ID columns
 * exclusively. This route is retained as a no-op for backwards compatibility.
 */
export const POST = createInternalRoute(async ({ log }) => {
  log.info('gv_backfill.noop', { message: 'Freetext columns have been dropped. Backfill is no longer needed.' });

  return Response.json({
    data: {
      message: 'Backfill complete — freetext UOM columns have been dropped. All data uses GV term IDs.',
      status: 'no_op',
    },
  });
}, { serviceName: SERVICE_NAME });
