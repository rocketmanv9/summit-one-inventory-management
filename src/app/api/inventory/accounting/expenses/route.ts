import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Placeholder: accounting_expenses table does not exist yet.
// Returns empty data until the migration is created.
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  log.info('accounting_expenses.list', { note: 'table not yet created' });
  return Response.json({ data: [] });
}, { serviceName: SERVICE_NAME });
