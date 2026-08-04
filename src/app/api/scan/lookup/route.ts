import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { getTenantToolClient } from '@/lib/tools';
import { AppError } from '@rocketmanv9/chassis/errors';
import { resolveScanCode } from '@/lib/scan/resolve';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * GET /api/scan/lookup?code=<value>
 *
 * Scanned barcode lookup — searches assets by asset_tag / serial_number and
 * catalog items by barcode / sku (see resolveScanCode), then falls back to GV
 * tools by id. Tenant-scoped via the chassis session + RLS.
 */
export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code')?.trim();

  if (!code) {
    throw AppError.badRequest('Missing required query parameter: code');
  }

  log.info('scan.lookup', { code });

  // ── Search inventory assets + catalog items ───────────────────────────
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });
  const inv = (supabase as any).schema('inventory');

  const match = await resolveScanCode(inv, code);
  if (match) {
    // The crew's core question is "how many, where?" — items carry their
    // per-location balances right on the scan result (rework P4).
    if (match.type === 'catalog_item' && (match.entity as any)?.id) {
      const { data: balances } = await inv
        .from('stock_balances')
        .select('qty_on_hand, qty_reserved, qty_available, location:locations(id, name)')
        .eq('catalog_item_id', (match.entity as any).id)
        .order('qty_on_hand', { ascending: false })
        .limit(50);
      return Response.json({
        data: {
          ...match,
          balances: (balances ?? []).map((b: any) => ({
            location_id: (Array.isArray(b.location) ? b.location[0] : b.location)?.id ?? null,
            location_name: (Array.isArray(b.location) ? b.location[0] : b.location)?.name ?? '—',
            on_hand: Number(b.qty_on_hand) || 0,
            available: Number(b.qty_available) || 0,
          })),
        },
      });
    }
    return Response.json({ data: match });
  }

  // ── Search GV tools by id (UUID) ─────────────────────────────────────
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(code)) {
    try {
      const client = await getTenantToolClient(session.tenantId);
      const tool = await client.getById(code);
      if (tool) {
        return Response.json({
          data: {
            type: 'tool',
            entity: tool,
            href: '/fleet/tools',
          },
        });
      }
    } catch {
      // Tool not found or client error — fall through to 404
    }
  }

  throw AppError.notFound(`No asset or tool found for code: ${code}`);
}, { serviceName: SERVICE_NAME });
