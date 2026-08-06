import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Mirrors the web CreateTransferModal submit path (InventoryRPC.createTransfer)
// and the AI bridge's create_transfer action — both call rpc_inv_transfer_create.
// This thin session-authed route exists so the mobile app (which has no direct
// Supabase access) can create a transfer through the same RPC as the web app.
const CreateTransferSchema = z.object({
  from_location_id: z.string().uuid(),
  to_location_id: z.string().uuid(),
  notes: z.string().nullable().optional(),
  lines: z
    .array(
      z.object({
        catalog_item_id: z.string().uuid(),
        qty: z.number().positive(),
        asset_ids: z.array(z.string().uuid()).optional(),
      }),
    )
    .min(1),
});

export const POST = createSessionWriteRoute(
  async ({ ctx, req, log, supabase, idempotencyKey }) => {
    const body = CreateTransferSchema.parse(await req.json());

    if (body.from_location_id === body.to_location_id) {
      throw AppError.badRequest('From and to locations must be different.');
    }

    const inv = (supabase as any).schema('inventory');

    const { data, error } = await inv.rpc('rpc_inv_transfer_create', {
      p_tenant_id: ctx.tenantId,
      p_from_location_id: body.from_location_id,
      p_to_location_id: body.to_location_id,
      p_lines: body.lines,
      p_initiated_by_user_id: ctx.userId,
      p_notes: body.notes || null,
      p_last_event_id: idempotencyKey,
    });

    if (error) {
      log.error('transfer.create_failed', { error: error.message });
      throw AppError.internal(`Failed to create transfer: ${error.message}`);
    }

    log.info('transfer.created', {
      transferId: data,
      from: body.from_location_id,
      to: body.to_location_id,
      lines: body.lines.length,
    });

    // transfer/transfer_line DB triggers own outbox emission (emissionOwner:
    // 'trigger'), so the handler returns no events itself.
    return { data: { id: data }, status: 201, events: [] };
  },
  {
    bodySchema: 'raw',
    emissionOwner: 'trigger',
    serviceName: SERVICE_NAME,
    scope: 'POST /api/inventory/transfers',
  },
);
