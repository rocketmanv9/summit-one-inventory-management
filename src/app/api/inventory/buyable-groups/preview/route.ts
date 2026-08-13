import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { z } from 'zod';

import { assertCapability } from '@/lib/access-server';
import { buildConsumerGroupsPayload, loadGroupsForPosition } from '@/lib/buyable-groups';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Preview-as for the buying-access matrix (item 02, tyler-ideas sprint):
//   GET /api/inventory/buyable-groups/preview?position=Estimator
// Answers "what will an Estimator see in the buying flow?" without logging in
// as one. Runs the EXACT consumer path — loadGroupsForPosition with
// isAdmin=false (the same filter /mine applies to non-admins) shaped by the
// same buildConsumerGroupsPayload /mine serves — so the preview cannot drift
// from reality. Gated on purchase_orders.manage, the buying-config capability.
//
// Item 02: items include the additive `fulfillment` object (kind/url/vendor/
// price/configured_for_caller). The lens previews a POSITION, not a person, so
// external_link items resolve to the item's fallback URL only — per-person
// Canva links show as configured only for the specific person in /mine.
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const tenantId = session.tenantId!;
  const url = new URL(req.url);
  const position = z.string().min(1).max(200).parse(url.searchParams.get('position') ?? '');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  await assertCapability(supabase, { tenantId, userId: session.userId! }, 'purchase_orders.manage');

  const groups = await loadGroupsForPosition(supabase, tenantId, { isAdmin: false, positionTitle: position });
  const data = await buildConsumerGroupsPayload(supabase, tenantId, groups, (msg, meta) => log.warn(msg, meta));

  if (data.length === 0) {
    // Distinguish "position sees nothing" (valid, common) from a bad request.
    log.info('buyable_groups.preview_empty', { position });
  }

  return Response.json({ data, position });
}, { serviceName: SERVICE_NAME });
