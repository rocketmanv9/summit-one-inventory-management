import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// PARKED: the backing table `supply_chain.accounting_expenses` exists and a
// matching RPC (`supply_chain.rpc_match_expense_to_po`) is already defined, but
// this API is intentionally not wired up pending an architecture decision on
// whether expense tracking belongs in the inventory service.
// See docs/accounting-expenses-parked.md.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  throw AppError.notFound('Accounting expenses API is not enabled in the inventory service');
}, { serviceName: SERVICE_NAME, scope: 'POST /api/inventory/accounting/expenses/:id/match' });
