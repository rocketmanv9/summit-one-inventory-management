/**
 * AI Usage Stats Endpoint
 *
 * GET  /api/ai/usage — Returns aggregated AI token usage, cost, and latency.
 * POST /api/ai/usage — Accepts friction metrics from the client for persistence.
 *
 * Query params (GET):
 *   - days: number (default 7) — lookback window
 *   - group_by: 'day' | 'user' | 'tool' (default 'day')
 */

import { createSessionReadRoute, createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';
import { z } from 'zod';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '7', 10), 1), 90);
  const groupBy = url.searchParams.get('group_by') || 'day';

  if (!['day', 'user', 'tool'].includes(groupBy)) {
    throw AppError.badRequest('group_by must be one of: day, user, tool');
  }

  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId,
  });
  const inv = (supabase as any).schema('inventory');
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // ── Summary (totals for the period) ──────────────────────────────────
  const { data: rows, error: listErr } = await inv
    .from('ai_usage_log')
    .select('prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, latency_ms, user_id, tools_called, created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (listErr) {
    log.error('ai_usage.list failed', { error: listErr.message });
    throw AppError.internal(listErr.message);
  }

  const allRows = rows || [];

  const summary = {
    total_tokens: 0,
    total_cost_usd: 0,
    avg_latency_ms: 0,
    total_requests: allRows.length,
  };

  let totalLatency = 0;
  for (const r of allRows) {
    summary.total_tokens += r.total_tokens || 0;
    summary.total_cost_usd += parseFloat(r.estimated_cost_usd) || 0;
    totalLatency += r.latency_ms || 0;
  }
  summary.avg_latency_ms = allRows.length > 0 ? Math.round(totalLatency / allRows.length) : 0;
  summary.total_cost_usd = Math.round(summary.total_cost_usd * 1_000_000) / 1_000_000;

  // ── Breakdown by group ───────────────────────────────────────────────
  const buckets = new Map<string, { tokens: number; cost_usd: number; requests: number }>();

  for (const r of allRows) {
    let label: string;

    if (groupBy === 'day') {
      label = new Date(r.created_at).toISOString().slice(0, 10);
    } else if (groupBy === 'user') {
      label = r.user_id || 'unknown';
    } else {
      // group_by === 'tool' — explode tools_called array
      const tools: string[] = Array.isArray(r.tools_called) ? r.tools_called : [];
      if (tools.length === 0) {
        const key = '(no tool)';
        const bucket = buckets.get(key) || { tokens: 0, cost_usd: 0, requests: 0 };
        bucket.tokens += r.total_tokens || 0;
        bucket.cost_usd += parseFloat(r.estimated_cost_usd) || 0;
        bucket.requests += 1;
        buckets.set(key, bucket);
        continue;
      }
      for (const t of tools) {
        const bucket = buckets.get(t) || { tokens: 0, cost_usd: 0, requests: 0 };
        bucket.tokens += r.total_tokens || 0;
        bucket.cost_usd += parseFloat(r.estimated_cost_usd) || 0;
        bucket.requests += 1;
        buckets.set(t, bucket);
      }
      continue;
    }

    const bucket = buckets.get(label) || { tokens: 0, cost_usd: 0, requests: 0 };
    bucket.tokens += r.total_tokens || 0;
    bucket.cost_usd += parseFloat(r.estimated_cost_usd) || 0;
    bucket.requests += 1;
    buckets.set(label, bucket);
  }

  const breakdown = Array.from(buckets.entries())
    .map(([label, b]) => ({
      label,
      tokens: b.tokens,
      cost_usd: Math.round(b.cost_usd * 1_000_000) / 1_000_000,
      requests: b.requests,
    }))
    .sort((a, b) => {
      // For day grouping, sort chronologically; otherwise by request count desc
      if (groupBy === 'day') return a.label.localeCompare(b.label);
      return b.requests - a.requests;
    });

  return Response.json({
    data: {
      summary,
      breakdown,
    },
  });
}, { serviceName: SERVICE_NAME });

// ── POST: Accept friction metrics from client ────────────────────────

const FrictionMetricsSchema = z.object({
  friction_metrics: z.object({
    summary: z.object({
      totalFlows: z.number(),
      completedFlows: z.number(),
      cancelRate: z.number(),
      avgQuestions: z.number(),
      autoExecRate: z.number(),
      avgTimeMs: z.number(),
    }),
    flows: z.array(z.object({
      intent: z.string(),
      outcome: z.enum(['completed', 'cancelled', 'failed']),
      questionsAsked: z.number(),
      correctionsDetected: z.number(),
      autoFilledFields: z.number(),
      totalFields: z.number(),
      wasAutoExecuted: z.boolean(),
      durationMs: z.number().nullable(),
    })),
  }),
});

export const POST = createSessionWriteRoute(async ({ req, ctx, supabase, log, idempotencyKey }) => {
  const body = FrictionMetricsSchema.parse(await req.json());

  const inv = (supabase as any).schema('inventory');

  const { error } = await inv.from('ai_usage_log').upsert({
    tenant_id: ctx.tenantId,
    user_id: ctx.userId,
    model: 'friction_metrics',
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    estimated_cost_usd: 0,
    latency_ms: 0,
    tools_called: body.friction_metrics.flows.map((f) => f.intent),
    surface: 'friction',
    metadata: body.friction_metrics,
  }, { onConflict: 'id' });

  if (error) {
    log.error('friction_metrics.store failed', { error: error.message });
    throw AppError.internal(error.message);
  }

  return {
    data: { stored: true },
    status: 201,
    events: [{
      event_name: 'ai.friction_metrics.stored',
      payload: { flow_count: body.friction_metrics.flows.length },
      last_event_id: idempotencyKey,
    }],
  };
}, { serviceName: SERVICE_NAME, scope: 'POST /api/ai/usage' });
