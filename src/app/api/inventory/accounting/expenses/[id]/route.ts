import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// PARKED: the backing table `supply_chain.accounting_expenses` exists, but this
// API is intentionally not wired up pending an architecture decision on whether
// expense tracking belongs in the inventory service. See docs/accounting-expenses-parked.md.
export const PATCH = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  throw AppError.notFound('Accounting expenses API is not enabled in the inventory service');
}, { serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/accounting/expenses/:id' });

export const DELETE = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  throw AppError.notFound('Accounting expenses API is not enabled in the inventory service');
}, { serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/accounting/expenses/:id' });
