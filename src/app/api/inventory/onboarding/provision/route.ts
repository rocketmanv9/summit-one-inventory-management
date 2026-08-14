import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

import { provisionHire, provisionNewHires, type ProvisionOutcome } from '@/lib/position-kits';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/** One route, two doors: a single retry or a full catch-up sweep. */
interface ScanSummary {
  candidates: number;
  provisioned: number;
  skipped: number;
  errors: number;
  /** Of the candidates, how many were stuck error/planned rows re-attempted. */
  retried: number;
}
interface ProvisionResponse {
  scan: ScanSummary | null;
  outcome: ProvisionOutcome | null;
}

const BodySchema = z.object({
  /** Provision one person (the queue's "Provision now" retry). */
  hr_person_id: z.string().uuid().optional(),
  /** Re-run a row that ended in error / got stuck planned. Never re-runs a
   *  completed provisioning — that guard lives in the engine. */
  force: z.boolean().optional(),
  /** Sweep everyone with no ledger row yet (the manual catch-up button). */
  scan: z.boolean().optional(),
});

/**
 * POST /api/inventory/onboarding/provision
 *   { hr_person_id, force? }  → provision that hire now
 *   { scan: true }            → run the sync-diff catch-up pass
 *
 * The human-triggered doors into the same engine the webhook and the nightly
 * HR sync use. Idempotency is the engine's, not this route's: a double-tap
 * returns `noop` instead of a second laptop.
 */
export const POST = createSessionWriteRoute(
  async ({ ctx, req, log, idempotencyKey }) => {
    const body = BodySchema.parse(await req.json());
    const tenantId = ctx.tenantId!;
    const userId = ctx.userId!;

    const supabase = await createTenantServiceClient({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      tenantId,
    });

    if (body.scan) {
      const summary = await provisionNewHires(supabase, { tenantId, log });
      return {
        data: { scan: summary, outcome: null } as ProvisionResponse,
        status: 200,
        events: [
          {
            event_name: 'position_kit.scan_run',
            payload: { ...summary, tenant_id: tenantId },
            last_event_id: idempotencyKey,
          },
        ],
      };
    }

    if (!body.hr_person_id) {
      throw AppError.badRequest('hr_person_id or scan:true is required');
    }

    const outcome = await provisionHire(supabase, {
      tenantId,
      hrPersonId: body.hr_person_id,
      source: 'manual',
      actingUserId: userId,
      force: body.force ?? true,
      log,
    });

    return {
      data: { scan: null, outcome } as ProvisionResponse,
      status: 200,
      events: [
        {
          event_name: 'position_kit.provisioned',
          payload: {
            hr_person_id: outcome.hr_person_id,
            provision_id: outcome.provision_id,
            kit_id: outcome.kit_id,
            status: outcome.status,
            reservation_count: outcome.reservation_ids.length,
            purchase_order_ids: outcome.purchase_order_ids,
            source: 'manual',
          },
          last_event_id: idempotencyKey,
        },
      ],
    };
  },
  {
    bodySchema: 'raw',
    serviceName: SERVICE_NAME,
    scope: 'POST /api/inventory/onboarding/provision',
  },
);
