/**
 * TTS API Route
 * Converts text to speech using OpenAI's TTS API.
 *
 * - Session-authenticated (no mutation, no events/idempotency needed)
 * - Returns raw audio/mpeg bytes
 * - 503 if OPENAI_API_KEY not configured
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';
import OpenAI from 'openai';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const TtsRequestSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']).optional(),
});

export const POST = createSessionReadRoute(async ({ req, log }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw AppError.internal('TTS service not configured');
  }

  const body = TtsRequestSchema.parse(await req.json());

  const openai = new OpenAI({ apiKey });

  log.info('[TTS] Generating speech', { textLength: body.text.length, voice: body.voice || 'nova' });

  const response = await openai.audio.speech.create({
    model: 'tts-1',
    voice: body.voice || 'nova',
    input: body.text,
  });

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  return new Response(audioBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': String(audioBuffer.length),
    },
  });
}, { serviceName: SERVICE_NAME });
