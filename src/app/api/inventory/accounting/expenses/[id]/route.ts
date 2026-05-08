import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Placeholder: accounting_expenses table does not exist yet.
export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  throw AppError.notFound('Accounting expenses table not yet created');
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/accounting/expenses/:id' });

export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  throw AppError.notFound('Accounting expenses table not yet created');
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/accounting/expenses/:id' });
