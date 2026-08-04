import { z } from 'zod';
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getGoogleAccessTokenForUser } from '@/lib/integrations/google-connections';
import { listGmailMessages, getGmailMessage } from '@/lib/integrations/gmail';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({ query: z.string().min(2) });

/**
 * POST /api/ai/vendor-from-email — "look for Seattle Construction Supply in
 * my email and add them as a vendor". Searches the user's connected Gmail
 * (same Google integration the receipt collector uses) for the company,
 * then AI-extracts vendor contact details from the real correspondence:
 * sender name/email (→ email domain), phone/address/website from signatures.
 * Returns VendorCandidate[] — the Quick Add modal's review flow takes over.
 */
export const POST = createSessionReadRoute(async ({ req, session, log }) => {
  const body = RequestSchema.parse(await req.json());
  const query = body.query.trim();

  let accessToken: string;
  try {
    ({ accessToken } = await getGoogleAccessTokenForUser(session.tenantId!, session.userId!));
  } catch {
    return Response.json(
      { error: 'No Google account connected — connect Gmail in Settings → Integrations first.' },
      { status: 400 },
    );
  }

  // Search mail for the company (quoted phrase + loose), newest first.
  const refs = await listGmailMessages(fetch, accessToken, `"${query}"`, 8);
  if (refs.length === 0) {
    return Response.json({ results: [], searched: 0 });
  }

  // Pull sender headers + snippets — enough signal for extraction without
  // shipping whole mailboxes to the model.
  const excerpts: string[] = [];
  for (const ref of refs.slice(0, 6)) {
    try {
      const msg: any = await getGmailMessage(fetch, accessToken, ref.id);
      const headers: Array<{ name: string; value: string }> = msg.payload?.headers ?? [];
      const h = (n: string) => headers.find((x) => x.name?.toLowerCase() === n)?.value ?? '';
      excerpts.push(`From: ${h('from')}\nSubject: ${h('subject')}\nSnippet: ${msg.snippet ?? ''}`);
    } catch {
      // Skip unreadable messages — extraction works from what we have.
    }
  }
  if (excerpts.length === 0) {
    return Response.json({ results: [], searched: refs.length });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw AppError.internal('OPENAI_API_KEY not configured');
  const OpenAI = (await import('openai')).default;
  const openai = new OpenAI({ apiKey });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    messages: [
      {
        role: 'system',
        content: [
          `The user searched their business email for the company "${query}".`,
          'From the email excerpts below, extract the company as a vendor record.',
          'Return ONLY a JSON object: {"results": [ ... ]} with at most 2 entries, each with',
          'fields (omit unknowns; name is required): name, code (short uppercase),',
          'category (what they sell), email (their contact email), phone, street1, city,',
          'state (2-letter), zip, website. Use the sender addresses/signatures as truth —',
          'never invent contact details that are not in the excerpts.',
          'No matching company in the excerpts → {"results": []}.',
        ].join('\n'),
      },
      { role: 'user', content: excerpts.join('\n\n---\n\n') },
    ],
    max_tokens: 500,
  });

  const content = completion.choices?.[0]?.message?.content ?? '';
  let parsed: any = {};
  try {
    parsed = JSON.parse(content.replace(/```(?:json)?|```/g, '').trim());
  } catch {
    parsed = { results: [] };
  }
  const results = Array.isArray(parsed.results)
    ? parsed.results.filter((r: any) => r?.name).slice(0, 2)
    : [];

  log.info('vendor_from_email.searched', { query, messages: excerpts.length, results: results.length });
  return Response.json({ results, searched: refs.length });
}, { serviceName: SERVICE_NAME });
