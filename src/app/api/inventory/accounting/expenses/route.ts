import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// PARKED: the backing table `supply_chain.accounting_expenses` DOES exist
// (see baseline.sql), but this API is intentionally not wired up pending an
// architecture decision on whether expense tracking belongs in the inventory
// service at all. Returns empty data until that decision is made.
// See docs/accounting-expenses-parked.md.
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  log.info('accounting_expenses.list', { note: 'API parked; supply_chain.accounting_expenses exists but is not exposed' });
  return Response.json({ data: [] });
}, { serviceName: SERVICE_NAME });
