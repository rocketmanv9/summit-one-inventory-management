import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { listEquipmentClasses } from '@/lib/equipment';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/gv/equipment/classes?activeOnly=true
 *
 * Returns the shared GV `equipment_classes` taxonomy as { id, slug, name, category }
 * tuples for the equipment "Class" dropdown. activeOnly defaults to true.
 */
export const GET = createSessionReadRoute(async ({ req }) => {
  const url = new URL(req.url);
  const activeOnly = url.searchParams.get('activeOnly') === 'false' ? false : true;

  const data = await listEquipmentClasses(activeOnly);

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });
