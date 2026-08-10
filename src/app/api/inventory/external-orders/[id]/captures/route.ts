import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { CAPTURES_BUCKET, MAX_CAPTURES, loadOwnedSession } from '@/lib/external-orders';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// ── Item 06 — stream a screenshot into an active session ─────────────────────
// CONTRACT (item 07):
//   POST /api/inventory/external-orders/{id}/captures   { image_data }
//     image_data: a base64 image data URL — "data:image/jpeg;base64,<...>"
//     (same encoding the mobile side already sends to /api/ai/item-image/analyze
//      and /api/inventory/images/upload; JPEG/PNG/WEBP accepted, ≤5MB decoded).
//     → 201 { data: { capture_id, sort, capture_count } }
//   Auth: session, gated to the session OWNER. Idempotent (Idempotency-Key):
//   the key is the capture row's last_event_id, so a retried upload is a no-op.
//   Only 'active' sessions accept captures; cap MAX_CAPTURES (30) per session.

const CaptureSchema = z.object({
  image_data: z.string().min(1, 'image_data is required'),
});

function extractSessionId(req: Request): string {
  const segs = new URL(req.url).pathname.split('/');
  const id = segs[segs.indexOf('external-orders') + 1];
  if (!id) throw AppError.badRequest('Missing session id');
  return z.string().uuid().parse(id);
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, idempotencyKey }) => {
  const sessionId = extractSessionId(req);
  const body = CaptureSchema.parse(await req.json());
  const tenantId = ctx.tenantId!;
  const userId = ctx.userId!;

  const match = body.image_data.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) throw AppError.badRequest('Invalid image_data — expected a base64 image data URL.');
  const ext = match[1].toLowerCase() === 'png' ? 'png' : match[1].toLowerCase() === 'webp' ? 'webp' : 'jpg';
  const contentType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length > 5 * 1024 * 1024) throw AppError.badRequest('Encoded image exceeds 5MB limit.');

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  });
  const sc = (supabase as any).schema('supply_chain');

  const session = await loadOwnedSession(supabase, tenantId, userId, sessionId);
  if (session.status !== 'active') {
    throw AppError.conflict(`Session is "${session.status}" — captures only accepted while active.`);
  }
  if (session.capture_count >= MAX_CAPTURES) {
    throw AppError.badRequest(`Capture limit reached (${MAX_CAPTURES}). Complete or cancel the session.`);
  }

  const sort = session.capture_count; // 0-based; next screenshot in order
  const storagePath = `${tenantId}/${sessionId}/${sort}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(CAPTURES_BUCKET)
    .upload(storagePath, buffer, { contentType, upsert: true });
  if (upErr) throw AppError.internal(`Capture upload failed: ${upErr.message}`);

  const { data: capture, error: insErr } = await sc
    .from('external_order_captures')
    .upsert(
      {
        tenant_id: tenantId,
        session_id: sessionId,
        storage_path: storagePath,
        sort,
        last_event_id: idempotencyKey,
      },
      { onConflict: 'tenant_id,last_event_id' },
    )
    .select('id, sort')
    .single();
  if (insErr) throw AppError.internal(insErr.message);

  // Recount from the captures table (authoritative) rather than blind-increment,
  // so retries / out-of-order deliveries can't drift the counter.
  const { count } = await sc
    .from('external_order_captures')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  const captureCount = count ?? session.capture_count + 1;

  await sc
    .from('external_order_sessions')
    .update({ capture_count: captureCount, updated_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('tenant_id', tenantId);

  log.info('external_order.capture_added', { session_id: sessionId, sort, capture_count: captureCount });

  return {
    data: { capture_id: capture.id, sort: capture.sort, capture_count: captureCount },
    status: 201,
    events: [{
      event_name: 'external_order_capture.added',
      payload: { session_id: sessionId, capture_id: capture.id, sort },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/external-orders/[id]/captures' });
