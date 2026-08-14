import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * The onboarding queue — what the kit automation did about every new hire.
 *
 * GET /api/inventory/onboarding?status=&limit=
 *   → 200 { data: { provisions: [...], counts: {...} } }
 *
 * Reads supply_chain.position_kit_provisions (the ledger written by
 * provisionHire) and hydrates the two things a human needs to trust it: the PO
 * numbers/status behind "on order", and the live reservation status behind
 * "reserved". Backfill rows (everyone who already worked here when the feature
 * shipped) are excluded by default — they're noise, not news.
 */
export const GET = createSessionReadRoute(
  async ({ req, session, log }) => {
    const tenantId = session.tenantId!;
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get('status');
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 100) || 100, 300);

    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId,
    });
    const sc = (supabase as any).schema('supply_chain');

    let q = sc
      .from('position_kit_provisions')
      .select(
        'id, hr_person_id, kit_id, person_name, position_title, hr_position_id, location_id, location_name, status, order_mode, plan, reservation_ids, purchase_order_ids, error, source, created_at, processed_at',
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (statusFilter && statusFilter !== 'all') {
      q = q.eq('status', statusFilter);
    } else {
      // Default view = the actual queue. Backfill rows are history, not work.
      q = q.neq('status', 'skipped_backfill');
    }

    const { data: rows, error } = await q;
    if (error) {
      log.error('onboarding.list_failed', { error: error.message });
      throw AppError.internal(error.message);
    }

    const provisions = rows ?? [];

    // ── Hydrate the POs behind "on order" ───────────────────────────────────
    const poIds = [...new Set(provisions.flatMap((p: any) => p.purchase_order_ids ?? []))] as string[];
    const poById = new Map<string, any>();
    if (poIds.length > 0) {
      const { data: pos } = await sc
        .from('purchase_orders')
        .select('id, po_number, status, vendor_name_snapshot, origin')
        .eq('tenant_id', tenantId)
        .in('id', poIds)
        .limit(500);
      for (const po of pos ?? []) poById.set(po.id, po);
    }

    // ── Hydrate reservations (they can be released/fulfilled later) ─────────
    const resIds = [...new Set(provisions.flatMap((p: any) => p.reservation_ids ?? []))] as string[];
    const resById = new Map<string, any>();
    if (resIds.length > 0) {
      const { data: res } = await (supabase as any)
        .schema('inventory')
        .from('reservations')
        .select('id, catalog_item_id, qty, status')
        .eq('tenant_id', tenantId)
        .in('id', resIds)
        .limit(1000);
      for (const r of res ?? []) resById.set(r.id, r);
    }

    // ── Counts across the whole ledger (not just the page) ──────────────────
    const { data: allStatuses } = await sc
      .from('position_kit_provisions')
      .select('status')
      .eq('tenant_id', tenantId)
      .limit(20000);
    const counts: Record<string, number> = {};
    for (const r of allStatuses ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;

    return Response.json({
      data: {
        provisions: provisions.map((p: any) => ({
          ...p,
          purchase_orders: (p.purchase_order_ids ?? [])
            .map((id: string) => poById.get(id))
            .filter(Boolean),
          reservations: (p.reservation_ids ?? []).map((id: string) => resById.get(id)).filter(Boolean),
        })),
        counts,
      },
    });
  },
  { serviceName: SERVICE_NAME },
);
