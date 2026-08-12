import { z } from 'zod';
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { getTenantVendorClient, createCustomVendor } from '@/lib/vendors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/gv/vendors
 *
 * List the tenant's vendors (active only).
 */
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const client = await getTenantVendorClient(session.tenantId);
  const vendors = await client.list({ activeOnly: true });

  return Response.json({ data: vendors });
}, { serviceName: SERVICE_NAME });

/**
 * POST /api/gv/vendors
 *
 * Create a custom vendor for the tenant.
 */
const CreateVendorSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  vendor_type_id: z.string().uuid('Valid vendor type is required'),
  account_number: z.string().optional(),
  payment_terms: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log }) => {
  const body = CreateVendorSchema.parse(await req.json());

  // Via the SECURITY DEFINER RPC — reliable tenant context under GV's pooled
  // PostgREST (the SDK's set_claim + insert split across connections and fails RLS).
  const vendor = await createCustomVendor(ctx.tenantId, body);

  log.info('vendor.created', { vendorId: vendor?.id });

  // GV service emits its own events — no local outbox events needed for this proxy route
  return { data: vendor, status: 201, events: [] };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/gv/vendors' });
