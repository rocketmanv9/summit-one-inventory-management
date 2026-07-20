import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

function getCycleCountId(req: Request): string {
  const url = new URL(req.url);
  const segments = url.pathname.split('/');
  const idx = segments.indexOf('cycle-counts');
  const id = idx >= 0 ? segments[idx + 1] : undefined;
  if (!id) throw AppError.badRequest('Missing cycle count ID');
  return id;
}

const slugPrefix = (sku: string | null, name: string | null): string => {
  if (sku && sku.trim()) return sku.trim().toUpperCase();
  return (name || 'ASSET').replace(/[^A-Za-z0-9]/g, '').slice(0, 6).toUpperCase() || 'ASSET';
};

// POST /api/inventory/cycle-counts/[id]/labels
// Finalize labels for an approved/posted count: assign real sequential asset
// tags to any untagged placeholders (created via "mark present, no serial"),
// then return the print list — catalog labels for fungible items, per-unit
// labels for serialized assets.
export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const cycleCountId = getCycleCountId(req);
  const inv = (supabase as any).schema('inventory');

  const { data: count, error: countErr } = await inv
    .from('cycle_counts')
    .select('id, status')
    .eq('id', cycleCountId)
    .eq('tenant_id', ctx.tenantId)
    .maybeSingle();
  if (countErr || !count) throw AppError.notFound('Cycle count not found');

  // Lines that were actually counted (qty_counted recorded).
  const { data: lines, error: linesErr } = await inv
    .from('cycle_count_lines')
    .select('id, catalog_item_id, qty_counted')
    .eq('cycle_count_id', cycleCountId)
    .eq('tenant_id', ctx.tenantId)
    .not('qty_counted', 'is', null)
    .limit(1000);
  if (linesErr) throw AppError.internal(linesErr.message);

  const emptyLabels: Array<{ code: string; label: string }> = [];
  const itemIds = [...new Set((lines || []).map((l: any) => l.catalog_item_id))];
  if (itemIds.length === 0) return { data: { items: emptyLabels, retagged: 0 }, status: 200, events: [] };

  const { data: items } = await inv
    .from('catalog_items')
    .select('id, name, sku, barcode, tracking_mode')
    .in('id', itemIds)
    .limit(1000);
  const itemById = new Map((items || []).map((i: any) => [i.id, i]));

  // Counted assets for serialized lines (present units).
  const { data: assetLines } = await inv
    .from('cycle_count_asset_lines')
    .select('asset_id, asset:assets(id, asset_tag, serial_number, catalog_item_id)')
    .eq('cycle_count_id', cycleCountId)
    .eq('tenant_id', ctx.tenantId)
    .eq('counted_present', true)
    .limit(2000);

  const labels: Array<{ code: string; label: string; kind: 'stock' | 'individual' }> = [];
  let retagged = 0;

  // Per-item next sequence for placeholder retagging — seed from existing tags.
  const nextSeqByItem = new Map<string, number>();
  const seedSeq = async (itemId: string): Promise<number> => {
    if (nextSeqByItem.has(itemId)) return nextSeqByItem.get(itemId)!;
    const { data: existing } = await inv
      .from('assets')
      .select('asset_tag')
      .eq('tenant_id', ctx.tenantId)
      .eq('catalog_item_id', itemId)
      .not('asset_tag', 'ilike', 'NOSERIAL-%')
      .limit(1000);
    let max = 0;
    for (const a of existing || []) {
      const m = String(a.asset_tag || '').match(/(\d+)\s*$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    nextSeqByItem.set(itemId, max + 1);
    return max + 1;
  };

  // Serialized: one label per present asset; retag placeholders first.
  for (const al of assetLines || []) {
    const asset = al.asset;
    if (!asset) continue;
    const item: any = itemById.get(asset.catalog_item_id);
    let tag = asset.asset_tag as string;

    if (/^NOSERIAL-/i.test(tag)) {
      const seq = await seedSeq(asset.catalog_item_id);
      const prefix = slugPrefix(item?.sku, item?.name);
      const newTag = `${prefix}-${String(seq).padStart(3, '0')}`;
      nextSeqByItem.set(asset.catalog_item_id, seq + 1);
      const { error: upErr } = await inv
        .from('assets')
        .update({ asset_tag: newTag, updated_at: new Date().toISOString() })
        .eq('id', asset.id)
        .eq('tenant_id', ctx.tenantId);
      if (upErr) {
        log.warn('cycle_count_labels.retag_failed', { assetId: asset.id, error: upErr.message });
      } else {
        tag = newTag;
        retagged++;
      }
    }
    labels.push({ code: tag, label: `${tag} — ${item?.name || 'Item'}`, kind: 'individual' });
  }

  // Fungible items: one catalog-level label per counted line (by barcode/SKU).
  const serializedItemIds = new Set(
    (items || []).filter((i: any) => i.tracking_mode === 'serialized').map((i: any) => i.id)
  );
  const seenCatalog = new Set<string>();
  for (const line of lines || []) {
    if (serializedItemIds.has(line.catalog_item_id)) continue;
    if (seenCatalog.has(line.catalog_item_id)) continue;
    seenCatalog.add(line.catalog_item_id);
    const item: any = itemById.get(line.catalog_item_id);
    const code = item?.barcode || item?.sku;
    if (code) labels.push({ code, label: item?.name || code, kind: 'stock' });
  }

  log.info('cycle_count_labels.built', { cycleCountId, labelCount: labels.length, retagged });

  return {
    data: { items: labels, retagged },
    status: 200,
    events: retagged > 0 ? [{
      event_name: 'cycle_count.placeholders_retagged',
      payload: { cycle_count_id: cycleCountId, retagged },
      last_event_id: idempotencyKey,
    }] : [],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/cycle-counts/:id/labels' });
