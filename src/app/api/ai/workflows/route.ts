import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const WorkflowSchema = z.object({
  workflow: z.enum(['auto_reorder', 'stock_rebalance']),
  dry_run: z.boolean().default(true),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }): Promise<{
  data: any;
  status: number;
  events: Array<{ event_name: string; payload: any; last_event_id: string }>;
}> => {
  const body = WorkflowSchema.parse(await req.json());

  if (body.workflow === 'auto_reorder') {
    return autoReorderWorkflow(supabase, ctx.tenantId, body.dry_run, idempotencyKey, log);
  }

  if (body.workflow === 'stock_rebalance') {
    return stockRebalanceWorkflow(supabase, ctx.tenantId, body.dry_run, idempotencyKey, log, ctx);
  }

  throw AppError.badRequest(`Unknown workflow: ${body.workflow}`);
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/ai/workflows',
});

// ─── Auto-Reorder ────────────────────────────────────────────────────

async function autoReorderWorkflow(
  supabase: any,
  tenantId: string,
  dryRun: boolean,
  idempotencyKey: string,
  log: any
) {
  // Get reorder suggestions from the inventory schema
  const invSchema = supabase;
  const { data: suggestions, error } = await (invSchema as any)
    .schema('inventory')
    .rpc('rpc_report_reorder_suggestions');

  if (error) {
    throw AppError.internal(`Failed to fetch reorder suggestions: ${error.message}`);
  }

  if (!suggestions || suggestions.length === 0) {
    return {
      data: { suggestions: [], vendorCount: 0, totalAmount: 0 },
      status: 200,
      events: [],
    };
  }

  // Group suggestions by preferred vendor
  const byVendor: Record<string, any[]> = {};
  for (const s of suggestions as any[]) {
    const vendor = s.preferred_vendor || 'Unknown Vendor';
    if (!byVendor[vendor]) byVendor[vendor] = [];
    byVendor[vendor].push(s);
  }

  const vendorSummaries = Object.entries(byVendor).map(([vendor, items]) => ({
    vendor,
    itemCount: items.length,
    totalQty: items.reduce((sum: number, i: any) => sum + (Number(i.suggested_order_qty) || 0), 0),
    estimatedAmount: items.reduce((sum: number, i: any) => {
      const qty = Number(i.suggested_order_qty) || 0;
      const cost = Number(i.unit_cost) || 0;
      return sum + qty * cost;
    }, 0),
  }));

  const totalAmount = vendorSummaries.reduce((sum, v) => sum + v.estimatedAmount, 0);

  if (dryRun) {
    return {
      data: {
        suggestions: vendorSummaries,
        vendorCount: vendorSummaries.length,
        totalAmount,
        dryRun: true,
      },
      status: 200,
      events: [],
    };
  }

  // Execute: generate POs via the existing RPC
  log.info('workflow.auto_reorder.executing', { vendorCount: vendorSummaries.length });

  const { data: result, error: genError } = await (invSchema as any)
    .schema('supply_chain')
    .rpc('generate_reorder_pos', { p_tenant_id: tenantId });

  if (genError) {
    throw AppError.internal(`Failed to generate reorder POs: ${genError.message}`);
  }

  const createdPOs = Array.isArray(result) ? result : [];

  return {
    data: {
      posCreated: createdPOs.length,
      createdPOs: createdPOs.map((po: any) => ({
        poNumber: po.po_number,
        vendor: po.vendor_name,
        itemCount: po.line_count,
        totalAmount: po.total_amount,
      })),
      totalAmount,
      dryRun: false,
    },
    status: 201,
    events: [{
      event_name: 'workflow.auto_reorder_completed',
      payload: {
        pos_created: createdPOs.length,
        total_amount: totalAmount,
      },
      last_event_id: idempotencyKey,
    }],
  };
}

// ─── Stock Rebalance ─────────────────────────────────────────────────

async function stockRebalanceWorkflow(
  supabase: any,
  tenantId: string,
  dryRun: boolean,
  idempotencyKey: string,
  log: any,
  ctx: { tenantId: string; userId?: string }
) {
  // Get velocity data to identify imbalances
  const { data: velocityData, error: velError } = await (supabase as any)
    .schema('inventory')
    .from('mv_item_velocity')
    .select('*')
    .eq('tenant_id', tenantId)
    .limit(500);

  if (velError) {
    throw AppError.internal(`Failed to fetch velocity data: ${velError.message}`);
  }

  if (!velocityData || velocityData.length === 0) {
    return {
      data: { transfers: [], transfersCreated: 0 },
      status: 200,
      events: [],
    };
  }

  // Get location names
  const { data: locations } = await (supabase as any)
    .schema('inventory')
    .from('locations')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .limit(100);

  const locationMap: Record<string, string> = {};
  for (const loc of (locations || []) as any[]) {
    locationMap[loc.id] = loc.name;
  }

  // Get item names
  const { data: items } = await (supabase as any)
    .schema('inventory')
    .from('catalog_items')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .limit(500);

  const itemMap: Record<string, string> = {};
  for (const item of (items || []) as any[]) {
    itemMap[item.id] = item.name;
  }

  // Identify transfer opportunities: locations with excess vs deficit
  // Group by catalog_item_id
  const byItem: Record<string, any[]> = {};
  for (const v of velocityData as any[]) {
    const key = v.catalog_item_id;
    if (!byItem[key]) byItem[key] = [];
    byItem[key].push(v);
  }

  const transfers: any[] = [];

  for (const [itemId, locs] of Object.entries(byItem)) {
    if (locs.length < 2) continue;

    // Find locations with excess (high days_of_stock) and deficit (low days_of_stock)
    const sorted = [...locs].sort((a: any, b: any) =>
      (Number(a.days_of_stock) || 9999) - (Number(b.days_of_stock) || 9999)
    );

    const deficit = sorted[0]; // lowest days_of_stock
    const surplus = sorted[sorted.length - 1]; // highest days_of_stock

    const deficitDays = Number(deficit.days_of_stock) || 0;
    const surplusDays = Number(surplus.days_of_stock) || 9999;
    const surplusQty = Number(surplus.qty_available) || 0;

    // Only suggest if there's a meaningful imbalance
    if (deficitDays < 14 && surplusDays > 60 && surplusQty > 0) {
      const transferQty = Math.min(
        Math.ceil(surplusQty * 0.3), // Transfer up to 30% of surplus
        surplusQty
      );

      if (transferQty > 0) {
        transfers.push({
          item: itemMap[itemId] || itemId,
          catalogItemId: itemId,
          fromLocation: locationMap[surplus.location_id] || surplus.location_id,
          fromLocationId: surplus.location_id,
          toLocation: locationMap[deficit.location_id] || deficit.location_id,
          toLocationId: deficit.location_id,
          quantity: transferQty,
          reason: `${deficitDays}d supply at destination vs ${surplusDays}d at source`,
        });
      }
    }
  }

  if (dryRun) {
    return {
      data: {
        transfers,
        transfersCreated: 0,
        dryRun: true,
      },
      status: 200,
      events: [],
    };
  }

  // Execute: create real transfer records via RPC
  log.info('workflow.stock_rebalance.executing', { transferCount: transfers.length });

  const createdTransfers: any[] = [];
  for (const t of transfers) {
    try {
      const { data: transferId, error: transferError } = await (supabase as any)
        .schema('inventory')
        .rpc('rpc_inv_transfer_create', {
          p_tenant_id: tenantId,
          p_from_location_id: t.fromLocationId,
          p_to_location_id: t.toLocationId,
          p_lines: [{ catalog_item_id: t.catalogItemId, qty: t.quantity }],
          p_initiated_by_user_id: ctx.userId || tenantId,
          p_notes: `Auto-rebalance: ${t.reason}`,
          p_last_event_id: `${idempotencyKey}-rebal-${createdTransfers.length}`,
        });

      if (transferError) {
        log.warn('workflow.stock_rebalance.transfer_failed', { error: transferError.message, item: t.item });
        continue;
      }

      createdTransfers.push({ ...t, transferId });
    } catch (err: any) {
      log.warn('workflow.stock_rebalance.transfer_failed', { error: err.message, item: t.item });
    }
  }

  return {
    data: {
      transfers: createdTransfers,
      transfersCreated: createdTransfers.length,
      dryRun: false,
    },
    status: 201,
    events: [{
      event_name: 'workflow.stock_rebalance_completed',
      payload: {
        transfers_created: createdTransfers.length,
      },
      last_event_id: idempotencyKey,
    }],
  };
}
