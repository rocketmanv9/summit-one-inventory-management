import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { z } from 'zod';

import { buildDraftPoPreview } from '@/lib/ai/draft-po-preview';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Draft-PO preview (sprint item 02) ────────────────────────────────────────
//   POST /api/ai/draft-po-preview
//     body { vendor_id?, catalog_vendor_id?, delivery_location_id?,
//            needed_by_date?, cost_context?, lines: [{ item_ref, qty }] }
//     → 200 { data: DraftPoPreviewResult }
//
// Advisory read-only (uses a session read route because it takes a JSON body and
// creates nothing). Assembles the reviewable Draft-PO card item 03 renders:
// vendor, priced lines with price_basis, per-line advisories (on-hand here /
// elsewhere, open POs, min-order nudge), estimated total, and PO-level warnings.
// Shared logic lives in @/lib/ai/draft-po-preview so Isabelle's server tool runs
// the identical function (no self-HTTP-fetch). It never calls the PO-create RPC.

const LineSchema = z.object({
  item_ref: z.string().min(1).max(500),
  qty: z.coerce.number().positive().max(1_000_000),
});

const BodySchema = z.object({
  vendor_id: z.string().uuid().optional(),
  catalog_vendor_id: z.string().uuid().optional(),
  delivery_location_id: z.string().uuid().optional(),
  needed_by_date: z.string().max(40).optional(),
  cost_context: z.string().max(60).optional(),
  lines: z.array(LineSchema).min(1).max(100),
});

export const POST = createSessionReadRoute(async ({ req, session, log }) => {
  const input = BodySchema.parse(await req.json());
  const tenantId = session.tenantId!;

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });

  const result = await buildDraftPoPreview(supabase, tenantId, input);

  log.info('draft_po_preview', {
    vendor_id: result.vendor.vendor_id,
    pending_adopt: result.vendor.pending_adopt,
    line_count: result.lines.length,
    estimated_total: result.estimated_total,
    unpriced: result.unpriced_line_count,
    warnings: result.warnings.length,
  });

  return Response.json({ data: result });
}, { serviceName: SERVICE_NAME });
