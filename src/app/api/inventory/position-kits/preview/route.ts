import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { resolveKitForHire, planKitFulfillment } from '@/lib/position-kits';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// "Preview a hire" — the read-only dry run of item 04's engine.
//
//   GET /api/inventory/position-kits/preview?hr_position_id=…&location_id=…
//     → 200 { data: { kit: {id,name,location_id,order_mode} | null, plan: KitPlan | null } }
//
// Deliberately answers the question the way the automation will: resolve which
// kit applies (location kit beats all-locations kit) and then plan it against
// that location's available stock. Same two functions item 04 calls, so what an
// admin sees here is what the robot will do.
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const tenantId = session.tenantId!;
  const url = new URL(req.url);
  const hrPositionId = z.string().uuid().parse(url.searchParams.get('hr_position_id'));
  const locationId = z.string().uuid().parse(url.searchParams.get('location_id'));

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  try {
    const kit = await resolveKitForHire(supabase, { tenantId, hrPositionId, locationId });
    if (!kit) return Response.json({ data: { kit: null, plan: null } });

    const plan = await planKitFulfillment(supabase, { tenantId, kit, locationId });
    return Response.json({
      data: {
        kit: {
          id: kit.id,
          name: kit.name,
          location_id: kit.location_id,
          order_mode: kit.order_mode,
          // Tells the UI whether the general kit or a location override answered.
          scope: kit.location_id ? 'location' : 'all_locations',
        },
        plan,
      },
    });
  } catch (e) {
    log.error('position_kits.preview_failed', { error: (e as Error).message });
    throw AppError.internal((e as Error).message);
  }
}, { serviceName: SERVICE_NAME });
