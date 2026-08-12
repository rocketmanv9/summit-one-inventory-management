/**
 * GET /api/system/cron/item-suggestions
 *
 * Daily background scan: for each tenant with an active Gmail connection, mine
 * recent purchase-looking emails for products not yet tracked in the catalog
 * and queue them as item onboarding suggestions (Accept → pre-filled item
 * wizard). See src/lib/suggestions/item-onboarding.ts.
 *
 * Triggered by Vercel Cron (see vercel.json). Vercel sends
 * `Authorization: Bearer <CRON_SECRET>`; anything else is rejected.
 */
import { createReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { scanAllTenantsForItemSuggestions } from '@/lib/suggestions/item-onboarding';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

// Fans out across tenants + Gmail + AI extraction — give it headroom.
export const maxDuration = 300;

export const GET = createReadRoute(
  async ({ req, fetch, log }) => {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get('authorization') || '';
    if (!secret || auth !== `Bearer ${secret}`) {
      throw AppError.unauthorized('Invalid or missing cron secret.');
    }

    const result = await scanAllTenantsForItemSuggestions({ fetchImpl: fetch, log });

    log.info('item_suggestions.cron_scan', {
      tenants: result.tenants,
      messagesScanned: result.messagesScanned,
      suggestionsCreated: result.suggestionsCreated,
      suggestionsBumped: result.suggestionsBumped,
      errorCount: result.errors.length,
    });
    return Response.json({ data: result });
  },
  { serviceName: SERVICE_NAME, auth: 'public' },
);
