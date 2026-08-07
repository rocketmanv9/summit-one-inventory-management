import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { resolveLocationAddress } from '@/lib/po/po-context';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/inventory/locations/:id/resolved-address
 *
 * Returns a location's display name plus the street address it renders with on
 * a PO — inheriting the parent yard's address when the location (e.g. a sub-bin
 * like "Portland Shed") carries none of its own. Backs the create-PO delivery
 * address preview so the UI shows the exact block the PDF/email will render,
 * sharing resolveLocationAddress() with loadPOContext().
 */
export const GET = createSessionReadRoute(async ({ req, session }) => {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  // /api/inventory/locations/[id]/resolved-address
  const id = segments[segments.length - 2];
  if (!id) throw AppError.badRequest('Location ID required');

  const resolved = await resolveLocationAddress(getAdminClient(), session.tenantId!, id);
  return Response.json({ data: resolved });
}, { serviceName: SERVICE_NAME });
