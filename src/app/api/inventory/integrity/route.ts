/**
 * GET /api/inventory/integrity
 *
 * On-demand data-integrity report for the signed-in tenant. Runs
 * inventory.rpc_integrity_report (balance vs ledger, reservations,
 * negative stock, over-receipts, PO status drift) and enriches the raw
 * findings with item names/SKUs and location names so the UI never has
 * to render bare UUIDs.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/** Hard cap on findings returned to the client (scanner: bounded responses). */
const MAX_FINDINGS = 500;

interface RawFinding {
  check_name: string;
  severity: string;
  entity: Record<string, unknown> | null;
  detail: string;
}

interface IntegrityFinding {
  check_name: string;
  severity: 'error' | 'warning';
  detail: string;
  entity: Record<string, unknown>;
  item?: { id: string; name: string; sku: string | null };
  location?: { id: string; name: string };
  po?: { id: string; po_number: string | null };
}

export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const inv = (supabase as any).schema('inventory');

  const { data, error } = await inv.rpc('rpc_integrity_report', {
    p_tenant_id: tenantId,
  });

  if (error) {
    log.error('integrity.report_failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  const raw: RawFinding[] = (Array.isArray(data) ? data : []).slice(0, MAX_FINDINGS);

  // ── Collect referenced ids out of the entity jsonb ───────────────────
  const itemIds = new Set<string>();
  const locationIds = new Set<string>();
  for (const f of raw) {
    const e = f.entity || {};
    if (typeof e.catalog_item_id === 'string') itemIds.add(e.catalog_item_id);
    if (typeof e.location_id === 'string') locationIds.add(e.location_id);
  }

  // ── Batch-fetch display names so the UI never shows raw UUIDs ────────
  const itemMap = new Map<string, { id: string; name: string; sku: string | null }>();
  const locationMap = new Map<string, { id: string; name: string }>();

  if (itemIds.size > 0) {
    const { data: items, error: itemErr } = await inv
      .from('catalog_items')
      .select('id, name, sku')
      .in('id', [...itemIds])
      .limit(MAX_FINDINGS);
    if (itemErr) {
      // Enrichment is best-effort — log and keep the raw findings usable.
      log.warn('integrity.item_enrich_failed', { error: itemErr.message });
    }
    for (const it of items ?? []) {
      itemMap.set(it.id, { id: it.id, name: it.name, sku: it.sku ?? null });
    }
  }

  if (locationIds.size > 0) {
    const { data: locs, error: locErr } = await inv
      .from('locations')
      .select('id, name')
      .in('id', [...locationIds])
      .limit(MAX_FINDINGS);
    if (locErr) {
      log.warn('integrity.location_enrich_failed', { error: locErr.message });
    }
    for (const loc of locs ?? []) {
      locationMap.set(loc.id, { id: loc.id, name: loc.name });
    }
  }

  // ── Assemble enriched findings ────────────────────────────────────────
  const findings: IntegrityFinding[] = raw.map((f) => {
    const e = (f.entity || {}) as Record<string, unknown>;
    const finding: IntegrityFinding = {
      check_name: f.check_name,
      severity: f.severity === 'error' ? 'error' : 'warning',
      detail: f.detail,
      entity: e,
    };
    if (typeof e.catalog_item_id === 'string' && itemMap.has(e.catalog_item_id)) {
      finding.item = itemMap.get(e.catalog_item_id);
    }
    if (typeof e.location_id === 'string' && locationMap.has(e.location_id)) {
      finding.location = locationMap.get(e.location_id);
    }
    if (typeof e.po_id === 'string') {
      finding.po = {
        id: e.po_id,
        po_number: typeof e.po_number === 'string' ? e.po_number : null,
      };
    }
    return finding;
  });

  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;

  log.info('integrity.report', { tenantId, errors, warnings, total: findings.length });

  return Response.json({
    data: {
      generated_at: new Date().toISOString(),
      summary: { errors, warnings, total: findings.length },
      findings,
    },
  });
}, { serviceName: SERVICE_NAME });
