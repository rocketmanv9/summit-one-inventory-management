/**
 * POST /api/integrations/google/disconnect
 *
 * Revokes a Gmail connection: best-effort token revocation at Google, removes
 * the Vault secret, and marks the row revoked. Users may only disconnect a
 * connection within their own tenant.
 *
 * Body: { connection_id: uuid }
 */
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { z } from 'zod';
import { getAdminClient } from '@/utils/supabase/admin';
import { revokeConnection } from '@/lib/integrations/google-connections';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const DisconnectSchema = z.object({ connection_id: z.string().uuid() });

export const POST = createSessionWriteRoute(
  async ({ req, ctx, fetch, log, idempotencyKey }) => {
    const body = DisconnectSchema.parse(await req.json());

    const conn = await revokeConnection(getAdminClient(), ctx.tenantId, body.connection_id, {
      lastEventId: idempotencyKey,
      fetchImpl: fetch,
    });

    log.info('google_oauth.disconnected', { email: conn.google_email });

    return {
      data: { disconnected: true, connection_id: conn.id, google_email: conn.google_email },
      status: 200,
      events: [
        {
          event_name: 'gmail.disconnected',
          payload: {
            connection_id: conn.id,
            google_email: conn.google_email,
            connection_type: conn.connection_type,
          },
          last_event_id: idempotencyKey,
        },
      ],
    };
  },
  { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/integrations/google/disconnect' },
);
