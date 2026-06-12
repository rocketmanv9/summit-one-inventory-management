import { z } from 'zod';
import { createWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { requireMobileSession } from '@/lib/mobile-auth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RecordSerialSchema = z.object({
  line_id: z.string().uuid(),
  // Either provide a serial, or set placeholder to record an untagged present
  // unit (you can see the item but don't have/know the serial yet).
  serial: z.string().min(1).max(100).optional(),
  placeholder: z.boolean().optional(),
}).refine((d) => !!d.serial || d.placeholder === true, {
  message: 'Provide a serial, or set placeholder to mark one present without a serial.',
});

/**
 * Scan-to-add a serialized asset during a cycle count. For a serialized line,
 * scanning a serial that isn't yet in the system creates the asset record (at the
 * count's location, status available) and marks it counted/present. Initiated from
 * the line (so we know the catalog_item) because a bare serial can't identify it.
 */
export const POST = createWriteRoute(async ({ req, log, supabase, idempotencyKey }) => {
  const session = await requireMobileSession(req);
  const { line_id, serial, placeholder } = RecordSerialSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');

  // Resolve the line within this count.
  const { data: line, error: lineError } = await inv
    .from('cycle_count_lines')
    .select('id, cycle_count_id, line_number, catalog_item_id, location_id')
    .eq('id', line_id)
    .eq('cycle_count_id', session.cycleCountId)
    .eq('tenant_id', session.tenantId)
    .maybeSingle();
  if (lineError || !line) throw AppError.notFound('Count line not found');

  // Placeholder = "one is present, no serial yet": always a fresh untagged
  // asset record (unique tag) you can serial-tag later. Otherwise match/create
  // by the typed serial.
  const tag = serial?.trim() || `NOSERIAL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

  let asset = null;
  if (!placeholder && serial) {
    const { data: existingAsset } = await inv
      .from('assets')
      .select('id, asset_tag, serial_number, status')
      .eq('tenant_id', session.tenantId)
      .eq('catalog_item_id', line.catalog_item_id)
      .or(`serial_number.eq.${tag},asset_tag.eq.${tag}`)
      .limit(1)
      .maybeSingle();
    asset = existingAsset;
  }

  let created = false;
  if (!asset) {
    const { data: newAsset, error: createError } = await inv
      .from('assets')
      .upsert({
        tenant_id: session.tenantId,
        catalog_item_id: line.catalog_item_id,
        asset_tag: tag,
        // Untagged placeholders carry no serial_number — only a temp tag.
        serial_number: placeholder ? null : tag,
        status: 'available',
        location_id: line.location_id,
        last_event_id: `cc_serial_${idempotencyKey}`,
      }, { onConflict: 'tenant_id,asset_tag' })
      .select('id, asset_tag, serial_number, status')
      .single();
    if (createError) {
      log.error('mobile_count.create_asset_failed', { error: createError.message });
      throw AppError.internal(createError.message);
    }
    asset = newAsset;
    created = true;
  }

  // Record this asset as present on the line. Idempotent via the unique
  // (cycle_count_id, asset_id) constraint — re-scanning just re-affirms it.
  const { error: upsertError } = await inv
    .from('cycle_count_asset_lines')
    .upsert({
      tenant_id: session.tenantId,
      cycle_count_id: session.cycleCountId,
      cycle_count_line_id: line.id,
      line_number: line.line_number,
      asset_id: asset.id,
      expected_present: false,
      counted_present: true,
      scanned_at: new Date().toISOString(),
      last_event_id: `cc_asset_${idempotencyKey}`,
    }, { onConflict: 'cycle_count_id,asset_id' });
  if (upsertError) throw AppError.internal(upsertError.message);

  // qty_counted = number of present assets recorded for this line.
  const { count } = await inv
    .from('cycle_count_asset_lines')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', session.tenantId)
    .eq('cycle_count_line_id', line.id)
    .eq('counted_present', true);

  await inv
    .from('cycle_count_lines')
    .update({ qty_counted: count ?? 1, counted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', line.id);

  log.info('mobile_count.serial_recorded', {
    cycleCountId: session.cycleCountId,
    lineId: line.id,
    assetId: asset.id,
    created,
  });

  return {
    data: { asset, created, qty_counted: count ?? 1 },
    status: 200,
    events: [{
      event_name: 'mobile_count.serial_recorded',
      payload: { cycle_count_id: session.cycleCountId, line_id: line.id, asset_id: asset.id, created },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/m/count/record-serial',
  authenticate: async (req: Request) => {
    const session = await requireMobileSession(req);
    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId: session.tenantId,
    });
    return { tenantId: session.tenantId, userId: session.userId, supabase };
  },
});
