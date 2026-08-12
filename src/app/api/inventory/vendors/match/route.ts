/**
 * Vendor duplicate-match check.
 *
 * POST /api/inventory/vendors/match
 *   { name, street1?, city?, state?, zip?, website?, email?, domain?, phone?, exclude_vendor_id? }
 *   → { matches: VendorMatch[], strongThreshold, hintThreshold }
 *
 * Called by the VendorQuickAddModal review phase (all four add paths funnel
 * there) before enabling confirm, so the user sees a confidence-scored match
 * against existing vendors and must explicitly choose "create new anyway". The
 * same matcher runs server-side in POST /api/inventory/vendors as a hard guard.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { findVendorMatches, STRONG_MATCH_THRESHOLD, HINT_MATCH_THRESHOLD } from '@/lib/vendor-match';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const MatchSchema = z.object({
  name: z.string().min(2, 'Vendor name is required'),
  street1: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  exclude_vendor_id: z.string().uuid().nullable().optional(),
});

export const POST = createSessionReadRoute(async ({ req, session, log }) => {
  const body = MatchSchema.parse(await req.json());
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });
  const sc = (supabase as any).schema('supply_chain');

  const matches = await findVendorMatches(sc, session.tenantId!, {
    name: body.name,
    street1: body.street1,
    city: body.city,
    state: body.state,
    zip: body.zip,
    website: body.website,
    email: body.email,
    domain: body.domain,
    phone: body.phone,
    excludeVendorId: body.exclude_vendor_id,
  }, log);

  return Response.json({
    matches,
    strongThreshold: STRONG_MATCH_THRESHOLD,
    hintThreshold: HINT_MATCH_THRESHOLD,
  });
}, { serviceName: SERVICE_NAME });

// A stray GET keeps Next's route typing happy and returns a clear 405-style hint.
export const GET = createSessionReadRoute(async () => {
  throw AppError.badRequest('Use POST with a candidate vendor to check for duplicates.');
}, { serviceName: SERVICE_NAME });
