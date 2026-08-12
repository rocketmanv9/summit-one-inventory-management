/**
 * AI Timeline Review API Route
 *
 * Accepts serialized map events (transfers + POs) and returns AI-generated
 * "tour stops" for a guided camera fly-through with narration cards.
 *
 * Used by the globe page's "AI Review" feature.
 */

import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import OpenAI from 'openai';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const EventSchema = z.object({
  id: z.string(),
  type: z.enum(['transfer', 'purchase_order']),
  date: z.string(),
  status: z.string(),
  from_name: z.string().nullable().optional(),
  from_lat: z.number().nullable().optional(),
  from_lng: z.number().nullable().optional(),
  to_name: z.string().nullable().optional(),
  to_lat: z.number().nullable().optional(),
  to_lng: z.number().nullable().optional(),
  items: z.array(z.object({
    name: z.string(),
    qty: z.number(),
  })).optional().default([]),
  po_number: z.string().nullable().optional(),
  vendor_name: z.string().nullable().optional(),
});

const RequestSchema = z.object({
  events: z.array(EventSchema).max(50),
  date_range: z.object({
    start: z.string(),
    end: z.string(),
  }),
});

export type TourStop = {
  type: 'intro' | 'transfer' | 'purchase_order' | 'outro';
  headline: string;
  summary: string;
  focus_lat: number;
  focus_lng: number;
  focus_zoom: number;
  event_id: string | null;
};

export const POST = createSessionReadRoute(async ({ req, log }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: 'AI review unavailable — OPENAI_API_KEY not configured.' },
      { status: 503 }
    );
  }

  const body = await req.json();
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message || 'Invalid request' },
      { status: 400 }
    );
  }

  const { events, date_range } = parsed.data;

  if (events.length === 0) {
    return Response.json(
      { error: 'No events to review' },
      { status: 400 }
    );
  }

  // Build the event descriptions for the prompt
  const eventDescriptions = events.map((e, i) => {
    if (e.type === 'transfer') {
      const itemList = e.items.length > 0
        ? e.items.map(it => `${it.qty}x ${it.name}`).join(', ')
        : 'items';
      return `${i + 1}. TRANSFER [id:${e.id}] on ${e.date}: ${itemList} from "${e.from_name || 'Unknown'}" (${e.from_lat},${e.from_lng}) to "${e.to_name || 'Unknown'}" (${e.to_lat},${e.to_lng}). Status: ${e.status}`;
    } else {
      return `${i + 1}. PURCHASE_ORDER [id:${e.id}] PO#${e.po_number || '?'} on ${e.date}: from vendor "${e.vendor_name || 'Unknown'}" (${e.from_lat},${e.from_lng}) delivering to "${e.to_name || 'Unknown'}" (${e.to_lat},${e.to_lng}). Status: ${e.status}`;
    }
  }).join('\n');

  try {
    const openai = new OpenAI({ apiKey });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4.1-mini',
      messages: [
        {
          role: 'system',
          content: [
            'You are a logistics operations narrator for a construction/infrastructure company.',
            'You will receive a list of inventory events (transfers and purchase orders) with locations and coordinates.',
            '',
            'Return ONLY a valid JSON array of "tour stops" for an animated map fly-through.',
            '',
            'Each stop is an object with:',
            '  type        — "intro" | "transfer" | "purchase_order" | "outro"',
            '  headline    — short 5-8 word card header',
            '  summary     — 1-2 sentence natural language description',
            '  focus_lat   — latitude to center the camera on',
            '  focus_lng   — longitude to center the camera on',
            '  focus_zoom  — map zoom level (5-14 range, higher = closer)',
            '  event_id    — the event ID from the input, or null for intro/outro',
            '',
            'ORDERING:',
            '1. First stop MUST be type "intro" — overview of the period, camera centered on the geographic centroid of all events at zoom 5-6',
            '2. Middle stops are individual events in chronological order — camera zoomed to 10-12 on the destination/delivery location',
            '3. Last stop MUST be type "outro" — summary insights and patterns, camera zoomed back out to centroid at zoom 5-6',
            '',
            'NARRATION STYLE:',
            '- Use friendly, specific date formatting: "Wednesday the 3rd of May" not "2025-05-03"',
            '- Mention specific item names and quantities when available',
            '- Mention location names by name',
            '- For the intro: summarize the time period and activity count ("Over the past 2 weeks, your team moved materials across 5 locations...")',
            '- For the outro: highlight patterns, busiest routes, total items moved, any insights',
            '',
            'Do NOT wrap the JSON in markdown code fences.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            `Date range: ${date_range.start} to ${date_range.end}`,
            `Total events: ${events.length}`,
            '',
            'EVENTS:',
            eventDescriptions,
          ].join('\n'),
        },
      ],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = completion.choices?.[0]?.message?.content;
    if (!content) {
      return Response.json({ error: 'AI returned empty response' }, { status: 502 });
    }

    // Parse JSON (strip code fences if present)
    let jsonStr = content.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const stops: TourStop[] = JSON.parse(jsonStr);

    // Validate and clamp zoom levels
    for (const stop of stops) {
      if (typeof stop.focus_zoom !== 'number') stop.focus_zoom = 8;
      stop.focus_zoom = Math.max(5, Math.min(14, stop.focus_zoom));
      if (typeof stop.focus_lat !== 'number') stop.focus_lat = 39.8;
      if (typeof stop.focus_lng !== 'number') stop.focus_lng = -98.5;
    }

    log.info(`[AI Timeline Review] Generated ${stops.length} tour stops for ${events.length} events`);

    return Response.json({ data: { stops } });
  } catch (err: unknown) {
    const error = err as { message?: string; status?: number; code?: string };
    log.error(`[AI Timeline Review] Failed: ${error.message}`);

    if (error.status === 429 || error.code === 'insufficient_quota') {
      return Response.json(
        { error: 'AI quota exceeded — please try again later.' },
        { status: 503 }
      );
    }
    if (error.status === 401) {
      return Response.json(
        { error: 'AI service authentication failed — check OPENAI_API_KEY.' },
        { status: 503 }
      );
    }

    return Response.json({ error: 'Failed to generate review. Try again.' }, { status: 500 });
  }
}, { serviceName: SERVICE_NAME });
