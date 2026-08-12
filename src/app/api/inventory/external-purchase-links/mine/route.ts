import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

import { resolveCallerPurchaseIdentity } from '@/lib/purchase-links';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Consumer contract for item 05 (mobile quick action): the active links the
// CALLER may use, filtered server-side by their HR position title. Admins see
// all. Response shape is deliberately minimal — keep in sync with item 05.
//   { id, name, description, url, category, icon, requires_po }
export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const userId = session.userId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const { isAdmin, positionTitle } = await resolveCallerPurchaseIdentity(supabase, tenantId, userId);

  const sc = (supabase as any).schema('supply_chain');
  const { data, error } = await sc
    .from('external_purchase_links')
    .select('id, name, description, url, category, icon, requires_po, allowed_positions')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(500);
  if (error) { log.error('purchase_links.mine_failed', { error: error.message }); throw AppError.internal(error.message); }

  // Admins see every active link. Everyone else sees only links whose
  // allowed_positions contains their exact HR position title.
  const visible = (data ?? []).filter((l: any) => {
    if (isAdmin) return true;
    if (!positionTitle) return false;
    return Array.isArray(l.allowed_positions) && l.allowed_positions.includes(positionTitle);
  });

  const result = visible.map((l: any) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    url: l.url,
    category: l.category,
    icon: l.icon,
    requires_po: l.requires_po,
  }));

  return Response.json({ data: result });
}, { serviceName: SERVICE_NAME });
