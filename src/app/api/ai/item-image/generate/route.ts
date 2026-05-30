/**
 * AI Item Image Generate API Route
 *
 * Generates a clean product image for an item from its name/description using
 * an OpenAI image model. Returns a base64 data URL; the client re-encodes it to
 * JPEG and attaches it via the existing entity-image upload. Used when an item
 * has no photo yet.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import OpenAI from 'openai';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional().default(''),
});

export const POST = createSessionReadRoute(async ({ req, log }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'AI image generation unavailable — OPENAI_API_KEY not configured.' }, { status: 503 });
  }

  const parsed = RequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  }
  const { name, description } = parsed.data;

  const prompt = [
    `A clean, professional product catalog photo of: ${name}.`,
    description ? `Details: ${description}.` : '',
    'Centered single item on a plain neutral light-gray studio background, soft even lighting,',
    'realistic, no text, no watermarks, no people, no hands. Industrial/construction inventory item.',
  ].filter(Boolean).join(' ');

  try {
    const openai = new OpenAI({ apiKey });

    // Prefer gpt-image-1; fall back to dall-e-3 if the model is unavailable to
    // this org. Both return base64 so the client can re-encode + attach.
    let b64: string | undefined;
    try {
      const img = await openai.images.generate({
        model: 'gpt-image-1',
        prompt,
        size: '1024x1024',
        quality: 'low',
        n: 1,
      } as any);
      b64 = img.data?.[0]?.b64_json;
    } catch (modelErr: any) {
      log.warn(`[AI Item Image Generate] gpt-image-1 failed (${modelErr?.message}); falling back to dall-e-3`);
      const img = await openai.images.generate({
        model: 'dall-e-3',
        prompt,
        size: '1024x1024',
        response_format: 'b64_json',
        n: 1,
      } as any);
      b64 = img.data?.[0]?.b64_json;
    }

    if (!b64) return Response.json({ error: 'AI returned no image' }, { status: 502 });

    log.info(`[AI Item Image Generate] generated image for "${name}"`);
    return Response.json({ image_data: `data:image/png;base64,${b64}` });
  } catch (err: any) {
    log.error(`[AI Item Image Generate] Failed: ${err.message}`);
    if (err.status === 429 || err.code === 'insufficient_quota') {
      return Response.json({ error: 'AI quota exceeded — check OpenAI billing or try again later.' }, { status: 503 });
    }
    if (err.status === 401) {
      return Response.json({ error: 'AI service authentication failed — check OPENAI_API_KEY.' }, { status: 503 });
    }
    if (err.status === 403) {
      return Response.json({ error: 'Image generation not enabled for this OpenAI org. Verify your organization at platform.openai.com.' }, { status: 503 });
    }
    return Response.json({ error: 'Failed to generate image. Try again.' }, { status: 500 });
  }
}, { serviceName: SERVICE_NAME });
