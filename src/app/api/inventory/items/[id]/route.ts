import { createSessionWriteRoute, createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function extractId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const itemsIdx = segments.indexOf('items');
  const id = segments[itemsIdx + 1];
  if (!id) throw AppError.badRequest('Missing item id');
  return id;
}

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const id = extractId(req);

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv.from('catalog_items').select('*').eq('id', id).single();

  if (error) {
    log.error('catalog_item.get_failed', { error: error.message });
    throw AppError.notFound('Item not found');
  }

  return Response.json({ data });
}, { serviceName: SERVICE_NAME });

// Optimistic-concurrency update. Body carries the page's strip-cleaned column
// updates plus `expected_last_event_id`; the `.eq('last_event_id', …)` guard
// turns a stale write into a 409 (matches the prior InventoryRPC OCC behavior).
export const PATCH = createSessionWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const id = extractId(req);
  const body = await req.json();
  const { expected_last_event_id, id: _id, created_at, tenant_id, last_event_id, ...updates } = body ?? {};
  if (!expected_last_event_id) throw AppError.badRequest('Missing expected_last_event_id');

  const inv = (supabase as any).schema('inventory');
  const { data, error } = await inv.from('catalog_items')
    .update({ ...updates, last_event_id: idempotencyKey })
    .eq('id', id).eq('last_event_id', expected_last_event_id)
    .select('id, last_event_id').maybeSingle();

  if (error) {
    log.error('catalog_item.update_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) throw AppError.conflict('Catalog item was updated by someone else. Please refresh and try again.');

  return { data, status: 200, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'PATCH /api/inventory/items/[id]' });

// Real transactional history — an item referenced by any of these can never
// be hard-deleted (the ledger and procurement records must stay intact).
const LEDGER_REFS = [
  { schema: 'inventory', table: 'stock_movements', column: 'catalog_item_id', label: 'stock movements' },
  { schema: 'inventory', table: 'stock_balances', column: 'catalog_item_id', label: 'stock balances' },
  { schema: 'inventory', table: 'reservations', column: 'catalog_item_id', label: 'reservations' },
  { schema: 'inventory', table: 'transfer_lines', column: 'catalog_item_id', label: 'transfers' },
  { schema: 'inventory', table: 'assets', column: 'catalog_item_id', label: 'assets' },
  { schema: 'inventory', table: 'catalog_items', column: 'parent_item_id', label: 'variant items' },
  { schema: 'inventory', table: 'rfid_tags', column: 'bulk_catalog_item_id', label: 'RFID tags' },
  { schema: 'supply_chain', table: 'purchase_order_lines', column: 'catalog_item_id', label: 'purchase order lines' },
  { schema: 'supply_chain', table: 'receipt_lines', column: 'catalog_item_id', label: 'receipt lines' },
] as const;

// Configuration / planning rows that merely point at the item. These are not
// history — they're cleaned up automatically so a test item whose only
// "history" is an unposted count line or a par level can actually be deleted.
const INCIDENTAL_REFS = [
  { schema: 'inventory', table: 'cycle_count_snapshot_skus', column: 'catalog_item_id' },
  { schema: 'inventory', table: 'cycle_count_variance_thresholds', column: 'catalog_item_id' },
  { schema: 'inventory', table: 'item_location_par_levels', column: 'catalog_item_id' },
  { schema: 'inventory', table: 'inventory_levels', column: 'catalog_item_id' },
  { schema: 'inventory', table: 'daily_item_activity', column: 'catalog_item_id' },
  { schema: 'inventory', table: 'negative_inventory_config', column: 'catalog_item_id' },
  { schema: 'inventory', table: 'mobile_onboarding_lines', column: 'catalog_item_id' },
  { schema: 'inventory', table: 'item_substitutions', column: 'item_id' },
  { schema: 'inventory', table: 'item_substitutions', column: 'substitute_item_id' },
  { schema: 'supply_chain', table: 'vendor_items', column: 'catalog_item_id' },
] as const;

async function findLedgerBlockers(supabase: any, itemId: string): Promise<string[]> {
  const checks = await Promise.all([
    ...LEDGER_REFS.map(async (ref) => {
      const { count } = await supabase
        .schema(ref.schema)
        .from(ref.table)
        .select('*', { count: 'exact', head: true })
        .eq(ref.column, itemId)
        .limit(1);
      return count && count > 0 ? `${count} ${ref.label}` : null;
    }),
    // Count lines that posted a stock adjustment are ledger; unposted ones
    // (e.g. a zero-qty line on an abandoned test count) are incidental.
    (async () => {
      const { count } = await supabase
        .schema('inventory')
        .from('cycle_count_lines')
        .select('*', { count: 'exact', head: true })
        .eq('catalog_item_id', itemId)
        .not('posted_at', 'is', null)
        .limit(1);
      return count && count > 0 ? `${count} posted count adjustments` : null;
    })(),
  ]);
  return checks.filter(Boolean) as string[];
}

async function cleanIncidentalRefs(supabase: any, itemId: string): Promise<void> {
  for (const ref of INCIDENTAL_REFS) {
    const { error } = await supabase
      .schema(ref.schema)
      .from(ref.table)
      .delete()
      .eq(ref.column, itemId);
    if (error) throw AppError.internal(`Failed to clean up ${ref.table}: ${error.message}`);
  }
  const { error: lineErr } = await supabase
    .schema('inventory')
    .from('cycle_count_lines')
    .delete()
    .eq('catalog_item_id', itemId)
    .is('posted_at', null);
  if (lineErr) throw AppError.internal(`Failed to clean up cycle count lines: ${lineErr.message}`);
}

// Optimistic-concurrency delete — body: { expected_last_event_id }.
// Items with real history (stock movements, PO/receipt lines, posted count
// adjustments…) stay undeletable; items whose only references are incidental
// (unposted count lines, par levels, vendor mappings…) get those references
// cleaned automatically and then delete cleanly.
export const DELETE = createSessionWriteRoute(async ({ req, log, supabase }) => {
  const id = extractId(req);
  const body = await req.json().catch(() => ({}));
  const expected = body?.expected_last_event_id;
  if (!expected) throw AppError.badRequest('Missing expected_last_event_id');

  const inv = (supabase as any).schema('inventory');
  const attemptDelete = () =>
    inv.from('catalog_items').delete()
      .eq('id', id).eq('last_event_id', expected)
      .select('id').maybeSingle();

  let { data, error } = await attemptDelete();

  if (error && (error as { code?: string }).code === '23503') {
    const blockers = await findLedgerBlockers(supabase, id);
    if (blockers.length > 0) {
      throw AppError.conflict(
        `This item has transaction history (${blockers.join(', ')}) and can't be permanently deleted. Deactivate it instead to hide it from active use.`,
      );
    }
    // Only incidental references — clean them and retry the delete.
    await cleanIncidentalRefs(supabase, id);
    log.info('catalog_item.incidental_refs_cleaned', { itemId: id });
    ({ data, error } = await attemptDelete());
    if (error && (error as { code?: string }).code === '23503') {
      throw AppError.conflict(
        "This item is still referenced by other records and can't be permanently deleted. Deactivate it instead.",
      );
    }
  }

  if (error) {
    log.error('catalog_item.delete_failed', { error: error.message });
    throw AppError.internal(error.message);
  }
  if (!data) throw AppError.conflict('Catalog item was updated by someone else. Please refresh and try again.');

  return { data: { id }, status: 200, events: [] };
}, { bodySchema: 'raw', emissionOwner: 'trigger', serviceName: SERVICE_NAME, scope: 'DELETE /api/inventory/items/[id]' });
