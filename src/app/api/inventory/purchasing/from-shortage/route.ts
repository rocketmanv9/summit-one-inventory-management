/**
 * Job shortfall → draft PO (V1-C, sprint 2026-08-12 #23).
 *
 * GET  /api/inventory/purchasing/from-shortage
 *   Current job-driven material shortfalls (inventory.v_job_material_shortage),
 *   grouped by (preferred vendor, delivery location) — the purchasing inbox's
 *   "Job shortfalls" section reads this.
 *
 * POST /api/inventory/purchasing/from-shortage
 *   body { job_id? , lines?: [{ catalog_item_id, location_id, qty? }] }
 *   One-tap "Draft PO for the shortfall". The server re-derives the shortfall
 *   rows from the view (never trusts client quantities beyond an explicit qty
 *   override), groups them by (preferred vendor, location), and drafts one PO
 *   per group through the normal rpc_create_purchase_order path so spend
 *   limits / budgets / approval routing all apply to the tapping user (same
 *   pattern as the shopping-list draft route). POs are stamped origin =
 *   'shortfall'. Lines with no vendor on file go to the guided-purchase
 *   placeholder vendor as CATALOG lines (kept mapped so receiving still works;
 *   the buyer assigns a real vendor before approving) — never silently dropped.
 *
 *   Idempotence is two-layered: the chassis Idempotency-Key guard dedupes
 *   replays of the same request, and at the data level a drafted PO counts as
 *   on-order (v_on_order_by_item_location includes drafts), which clears the
 *   shortfall row from the view — so a later re-tap has nothing to draft.
 */
import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { resolveGuidedPurchaseVendorId } from '@/lib/external-orders';
import { getAdminClient } from '@/utils/supabase/admin';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

interface ShortageJobRef {
  job_id: string | null;
  job_name: string | null;
  qty: number;
  needed_by: string | null;
}

interface ShortageRow {
  tenant_id: string;
  catalog_item_id: string;
  sku: string | null;
  item_name: string;
  uom_term_id: string | null;
  location_id: string;
  location_name: string;
  job_demand: number;
  demand_total: number;
  qty_on_hand: number;
  qty_available: number;
  qty_on_order: number;
  shortfall: number;
  earliest_needed_by: string | null;
  jobs: ShortageJobRef[];
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
  suggested_order_qty: number;
  estimated_unit_cost: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const SHORTAGE_COLS =
  'catalog_item_id, sku, item_name, uom_term_id, location_id, location_name, job_demand, demand_total, qty_on_hand, qty_available, qty_on_order, shortfall, earliest_needed_by, jobs, preferred_vendor_id, preferred_vendor_name, suggested_order_qty, estimated_unit_cost';

function normalizeRow(r: any): ShortageRow {
  return {
    ...r,
    job_demand: Number(r.job_demand) || 0,
    demand_total: Number(r.demand_total) || 0,
    qty_on_hand: Number(r.qty_on_hand) || 0,
    qty_available: Number(r.qty_available) || 0,
    qty_on_order: Number(r.qty_on_order) || 0,
    shortfall: Number(r.shortfall) || 0,
    suggested_order_qty: Number(r.suggested_order_qty) || 0,
    estimated_unit_cost: r.estimated_unit_cost != null ? Number(r.estimated_unit_cost) : null,
    jobs: Array.isArray(r.jobs)
      ? r.jobs.map((j: any) => ({ ...j, qty: Number(j.qty) || 0 }))
      : [],
  };
}

async function fetchShortages(tenantId: string, jobId?: string): Promise<ShortageRow[]> {
  let q = getAdminClient()
    .schema('inventory')
    .from('v_job_material_shortage')
    .select(SHORTAGE_COLS)
    .eq('tenant_id', tenantId)
    .order('shortfall', { ascending: false })
    .limit(200);
  // jobs elements carry job_id/job_name/qty/needed_by — containment on
  // job_id alone matches (per-job variant of the view).
  if (jobId) q = q.contains('jobs', JSON.stringify([{ job_id: jobId }]));
  const { data, error } = await q;
  if (error) throw AppError.internal(`Shortage read failed: ${error.message}`);
  return (data ?? []).map(normalizeRow);
}

/** Group shortage rows by (preferred vendor, delivery location) — one draft PO
 *  per group, mirroring the auto-reorder generator's grouping. */
function groupShortages(rows: ShortageRow[]) {
  const groups = new Map<string, {
    vendor_id: string | null;
    vendor_name: string | null;
    location_id: string;
    location_name: string;
    lines: ShortageRow[];
  }>();
  for (const row of rows) {
    const key = `${row.preferred_vendor_id ?? 'none'}::${row.location_id}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        vendor_id: row.preferred_vendor_id,
        vendor_name: row.preferred_vendor_name,
        location_id: row.location_id,
        location_name: row.location_name,
        lines: [],
      };
      groups.set(key, g);
    }
    g.lines.push(row);
  }
  return [...groups.values()];
}

// ── GET: current shortfalls for the purchasing inbox ─────────────────────────

export const GET = createSessionReadRoute(
  async ({ req, session }) => {
    const jobId = new URL(req.url).searchParams.get('job_id') ?? undefined;
    const rows = await fetchShortages(session.tenantId!, jobId);
    return Response.json({
      data: {
        groups: groupShortages(rows),
        line_count: rows.length,
        total_shortfall: rows.reduce((sum, r) => sum + r.shortfall, 0),
      },
    });
  },
  { serviceName: SERVICE_NAME },
);

// ── POST: draft PO(s) for the shortfall ──────────────────────────────────────

interface CreatedPo {
  po_id: string | null;
  po_number: string | null;
  status: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  location_id: string;
  line_count: number;
}

const DraftSchema = z.object({
  job_id: z.string().uuid().optional(),
  lines: z
    .array(
      z.object({
        catalog_item_id: z.string().uuid(),
        location_id: z.string().uuid(),
        qty: z.number().positive().max(100000).optional(),
      }),
    )
    .max(200)
    .optional(),
});

export const POST = createSessionWriteRoute(
  async ({ ctx, req, log, idempotencyKey }) => {
    const body = DraftSchema.parse(await req.json());
    const tenantId = ctx.tenantId!;
    const userId = ctx.userId!;

    // Server-derived truth: re-read the live shortfall rows, then (optionally)
    // narrow to the line keys the client tapped. A qty override is honored,
    // but only for lines that ARE currently short.
    let rows = await fetchShortages(tenantId, body.job_id);
    const qtyOverride = new Map<string, number>();
    if (body.lines?.length) {
      const wanted = new Map(body.lines.map((l) => [`${l.catalog_item_id}::${l.location_id}`, l]));
      rows = rows.filter((r) => wanted.has(`${r.catalog_item_id}::${r.location_id}`));
      for (const r of rows) {
        const w = wanted.get(`${r.catalog_item_id}::${r.location_id}`);
        if (w?.qty != null) qtyOverride.set(`${r.catalog_item_id}::${r.location_id}`, w.qty);
      }
    }
    if (rows.length === 0) {
      // Nothing currently short (already drafted, or stock arrived). Not an
      // error — the button is a no-op the second time by design.
      return {
        data: {
          purchase_orders: [] as CreatedPo[],
          line_count: 0,
          message: 'No open shortfall to draft — supply already covers demand.' as string | undefined,
        },
        status: 200,
        events: [],
      };
    }

    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId,
    });
    const sc = (supabase as any).schema('supply_chain');

    const createdPOs: CreatedPo[] = [];

    for (const group of groupShortages(rows)) {
      // No vendor on file → guided-purchase placeholder vendor, catalog lines
      // kept mapped so the buyer can reassign the vendor without losing them.
      const vendorId = group.vendor_id ?? (await resolveGuidedPurchaseVendorId(supabase, tenantId, null));

      const jobNames = [
        ...new Set(
          group.lines.flatMap((l) => l.jobs.map((j) => j.job_name || j.job_id || 'unknown job')),
        ),
      ];
      const neededBys = group.lines
        .map((l) => l.earliest_needed_by)
        .filter((d): d is string => !!d)
        .sort();

      const poLines = group.lines.map((l) => {
        const qty = qtyOverride.get(`${l.catalog_item_id}::${l.location_id}`) ?? l.suggested_order_qty;
        return {
          catalog_item_id: l.catalog_item_id,
          qty_ordered: qty,
          unit_cost: l.estimated_unit_cost ?? undefined,
          price_basis: l.estimated_unit_cost != null ? 'fixed' : 'unknown',
          line_notes: `Job shortfall: short ${l.shortfall} for ${l.jobs
            .map((j) => j.job_name || j.job_id)
            .filter(Boolean)
            .join(', ') || 'reserved jobs'}`,
        };
      });

      const { data: poResult, error: poErr } = await sc.rpc('rpc_create_purchase_order', {
        p_vendor_id: vendorId,
        p_delivery_method: 'ship',
        p_delivery_location_id: group.location_id,
        p_needed_by_date: neededBys[0] ?? null,
        p_cost_context: 'overhead',
        p_notes: `Drafted from job material shortfall — jobs: ${jobNames.join(', ')}.${
          group.vendor_id ? '' : ' No vendor on file; assign a vendor before approving.'
        }`,
        p_lines: poLines,
        p_initiated_by: 'user',
        p_tenant_id: tenantId,
        p_acting_user_id: userId,
      });
      if (poErr) {
        log.error('shortfall.draft_po_failed', { vendor_id: vendorId, location_id: group.location_id, error: poErr.message });
        throw AppError.internal(`Draft PO creation failed: ${poErr.message}`);
      }

      // Badge it (rpc_create_purchase_order defaults origin='user') — same
      // post-create stamp as the guided-purchase flow.
      if (poResult?.po_id) {
        await sc
          .from('purchase_orders')
          .update({ origin: 'shortfall' })
          .eq('id', poResult.po_id)
          .eq('tenant_id', tenantId);
      }

      createdPOs.push({
        po_id: poResult?.po_id ?? null,
        po_number: poResult?.po_number ?? null,
        status: poResult?.status ?? null,
        vendor_id: group.vendor_id,
        vendor_name: group.vendor_name,
        location_id: group.location_id,
        line_count: poLines.length,
      });
    }

    log.info('shortfall.pos_drafted', {
      po_count: createdPOs.length,
      line_count: rows.length,
      job_id: body.job_id ?? null,
    });

    return {
      data: { purchase_orders: createdPOs, line_count: rows.length, message: undefined as string | undefined },
      status: 200,
      events: [
        {
          event_name: 'purchase_order.shortfall_drafted',
          payload: {
            po_ids: createdPOs.map((p) => p.po_id).filter(Boolean),
            po_count: createdPOs.length,
            line_count: rows.length,
            job_id: body.job_id ?? null,
          },
          last_event_id: idempotencyKey,
        },
      ],
    };
  },
  { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/purchasing/from-shortage' },
);
