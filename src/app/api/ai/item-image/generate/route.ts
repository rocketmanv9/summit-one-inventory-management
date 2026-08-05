/**
 * AI Item Image Generate API Route
 *
 * Generates a clean product catalog image for an item from its name/description
 * using an OpenAI image model. Returns a base64 data URL; the client re-encodes
 * it to JPEG and attaches it via the existing entity-image upload.
 *
 * Refinement (item 11): when the caller passes a `previous_image` plus an
 * `adjustment` instruction, we steer the existing image instead of re-rolling
 * from scratch — gpt-image-1's images.edit path (prior image + instruction)
 * when available, otherwise a composed prompt that folds the adjustment into
 * the original description. Either way the result visibly builds on the last
 * one rather than starting over.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import OpenAI, { toFile } from 'openai';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const RequestSchema = z.object({
  name: z.string().min(1, 'name is required'),
  description: z.string().optional().default(''),
  // Refinement: the image to adjust (data URL) + what to change about it.
  // Both must be present to trigger the edit path; either alone is ignored.
  previous_image: z.string().optional(),
  adjustment: z.string().max(500).optional(),
});

// The studio-catalog look every generated image shares, so refinements don't
// drift away from the house style.
const STYLE = 'Centered single item on a plain neutral light-gray studio background, soft even lighting, realistic, no text, no watermarks, no people, no hands. Industrial/construction inventory item.';

function basePrompt(name: string, description: string): string {
  return [
    `A clean, professional product catalog photo of: ${name}.`,
    description ? `Details: ${description}.` : '',
    STYLE,
  ].filter(Boolean).join(' ');
}

// data:image/...;base64,XXXX → raw base64 (no prefix).
function stripDataUrl(dataUrl: string): { b64: string; mime: string } {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (m) return { mime: m[1], b64: m[2] };
  // Already bare base64.
  return { mime: 'image/png', b64: dataUrl };
}

export const POST = createSessionReadRoute(async ({ req, log }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'AI image generation unavailable — OPENAI_API_KEY not configured.' }, { status: 503 });
  }

  const parsed = RequestSchema.safeParse(await req.json());
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  }
  const { name, description, previous_image, adjustment } = parsed.data;
  const isRefine = !!(previous_image && adjustment?.trim());

  try {
    const openai = new OpenAI({ apiKey });
    let b64: string | undefined;

    if (isRefine) {
      // Steer the existing image. Prefer gpt-image-1's edit path (feeds the
      // actual prior image in), and fold the instruction into the prompt so the
      // change is explicit while the catalog style is preserved.
      const editPrompt = [
        basePrompt(name, description),
        `Keep the same subject and composition, but apply this change: ${adjustment!.trim()}.`,
      ].join(' ');
      try {
        const { b64: prevB64, mime } = stripDataUrl(previous_image!);
        const ext = mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
        const imageFile = await toFile(Buffer.from(prevB64, 'base64'), `previous.${ext}`, { type: mime });
        const edited = await openai.images.edit({
          model: 'gpt-image-1',
          image: imageFile,
          prompt: editPrompt,
          size: '1024x1024',
          quality: 'low',
          n: 1,
        } as any);
        b64 = edited.data?.[0]?.b64_json;
      } catch (editErr: any) {
        // Edit unsupported/failed (e.g. dall-e-3 orgs) — compose the adjustment
        // into a fresh generation so the instruction still steers the output.
        log.warn(`[AI Item Image Generate] edit path failed (${editErr?.message}); composing adjustment into a fresh prompt`);
        const composed = `${basePrompt(name, description)} Emphasize this correction from the previous attempt: ${adjustment!.trim()}.`;
        b64 = await freshGenerate(openai, composed, log);
      }
    } else {
      b64 = await freshGenerate(openai, basePrompt(name, description), log);
    }

    if (!b64) return Response.json({ error: 'AI returned no image' }, { status: 502 });

    log.info(`[AI Item Image Generate] ${isRefine ? 'refined' : 'generated'} image for "${name}"`);
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

// Fresh generation: prefer gpt-image-1, fall back to dall-e-3 for orgs without it.
async function freshGenerate(openai: OpenAI, prompt: string, log: any): Promise<string | undefined> {
  try {
    const img = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: '1024x1024',
      quality: 'low',
      n: 1,
    } as any);
    return img.data?.[0]?.b64_json;
  } catch (modelErr: any) {
    log.warn(`[AI Item Image Generate] gpt-image-1 failed (${modelErr?.message}); falling back to dall-e-3`);
    const img = await openai.images.generate({
      model: 'dall-e-3',
      prompt,
      size: '1024x1024',
      response_format: 'b64_json',
      n: 1,
    } as any);
    return img.data?.[0]?.b64_json;
  }
}
