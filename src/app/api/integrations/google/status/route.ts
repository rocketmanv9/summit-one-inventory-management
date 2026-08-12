/**
 * GET /api/integrations/google/status
 *
 * Returns the current user's Gmail connection metadata plus any tenant shared
 * mailboxes. Never returns token material.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';
import { listConnectionsForUser } from '@/lib/integrations/google-connections';
import { isGoogleConfigured } from '@/lib/integrations/google-oauth';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(
  async ({ session }) => {
    const connections = await listConnectionsForUser(
      getAdminClient(),
      session.tenantId,
      session.userId,
    );

    const personal = connections.find((c) => c.connection_type === 'user' && c.is_active) ?? null;
    const sharedMailboxes = connections.filter(
      (c) => c.connection_type === 'shared_mailbox' && c.is_active,
    );

    return Response.json({
      data: {
        configured: isGoogleConfigured(),
        connected: !!personal || sharedMailboxes.length > 0,
        personal,
        shared_mailboxes: sharedMailboxes,
        connections,
      },
    });
  },
  { serviceName: SERVICE_NAME },
);
