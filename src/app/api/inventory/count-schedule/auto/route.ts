import { z } from 'zod';
import OpenAI from 'openai';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const AutoScheduleSchema = z.object({
  horizon_days: z.number().int().min(30).max(730).default(365),
  dry_run: z.boolean().default(true),
});

// Shape the AI must return; falls back to deterministic round-robin if it
// returns anything that doesn't validate.
const AiPlanSchema = z.object({
  entries: z.array(z.object({
    template_id: z.string().uuid(),
    scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    assigned_to_user_id: z.string().uuid().nullable(),
    rationale: z.string(),
  })),
});

type PlannedEntry = {
  template_id: string;
  template_name: string;
  scheduled_date: string;
  assigned_to_user_id: string | null;
  rationale: string;
};

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Shift weekend dates onto the following Monday — counts happen on work days
function shiftToWeekday(d: Date): Date {
  const day = d.getUTCDay();
  if (day === 6) d.setUTCDate(d.getUTCDate() + 2);
  else if (day === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

// Evenly space each template's occurrences across the horizon, skipping
// dates that already have an entry for that template.
function deterministicPlan(
  templates: any[],
  existingByTemplate: Map<string, Set<string>>,
  horizonDays: number,
): Omit<PlannedEntry, 'assigned_to_user_id' | 'rationale'>[] {
  const out: Omit<PlannedEntry, 'assigned_to_user_id' | 'rationale'>[] = [];
  const today = new Date();

  for (const t of templates) {
    const intervalDays = Math.max(1, Math.floor(365 / t.frequency_per_year));
    const existing = existingByTemplate.get(t.id) ?? new Set<string>();

    // Anchor on the latest already-scheduled future date if there is one
    let anchor = new Date(today);
    anchor.setUTCDate(anchor.getUTCDate() + 7);
    for (const dateStr of existing) {
      const d = new Date(`${dateStr}T00:00:00Z`);
      const next = new Date(d);
      next.setUTCDate(next.getUTCDate() + intervalDays);
      if (next > anchor) anchor = next;
    }

    const horizonEnd = new Date(today);
    horizonEnd.setUTCDate(horizonEnd.getUTCDate() + horizonDays);

    let cursor = shiftToWeekday(new Date(anchor));
    while (cursor <= horizonEnd) {
      const dateStr = toDateStr(cursor);
      if (!existing.has(dateStr)) {
        out.push({ template_id: t.id, template_name: t.name, scheduled_date: dateStr });
      }
      cursor = shiftToWeekday(new Date(cursor.setUTCDate(cursor.getUTCDate() + intervalDays)));
    }
  }

  return out.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
}

function roundRobinAssign(
  entries: Omit<PlannedEntry, 'assigned_to_user_id' | 'rationale'>[],
  userIds: string[],
): PlannedEntry[] {
  return entries.map((e, i) => ({
    ...e,
    assigned_to_user_id: userIds.length > 0 ? userIds[i % userIds.length] : null,
    rationale: userIds.length > 0
      ? 'Evenly spaced by template frequency; assigned round-robin across qualified counters.'
      : 'Evenly spaced by template frequency; no qualified counters configured yet.',
  }));
}

async function aiRefine(
  baseline: Omit<PlannedEntry, 'assigned_to_user_id' | 'rationale'>[],
  templates: any[],
  qualifiedUsers: { user_id: string; name: string }[],
  log: any,
): Promise<PlannedEntry[] | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || qualifiedUsers.length === 0 || baseline.length === 0) return null;

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You schedule inventory cycle counts. You are given proposed count dates (evenly spaced per template frequency) and a list of qualified counters. ' +
            'Adjust dates only when needed to avoid more than 2 counts on the same day, keeping dates on weekdays and close to the proposal. ' +
            'Assign every entry to a qualified counter, balancing total workload and avoiding giving one person multiple counts in the same week when possible. ' +
            'Return JSON: {"entries":[{"template_id","scheduled_date" (YYYY-MM-DD),"assigned_to_user_id","rationale" (one short sentence)}]}. ' +
            'Include every proposed entry exactly once. Use only the provided user IDs.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            proposed_entries: baseline.map(e => ({
              template_id: e.template_id,
              template_name: e.template_name,
              scheduled_date: e.scheduled_date,
            })),
            templates: templates.map(t => ({
              id: t.id,
              name: t.name,
              location: t.location?.name,
              frequency_per_year: t.frequency_per_year,
            })),
            qualified_counters: qualifiedUsers,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const plan = AiPlanSchema.parse(JSON.parse(raw));

    // The AI must cover the same template workload — reject partial plans
    if (plan.entries.length !== baseline.length) {
      log.warn('count_schedule.auto.ai_plan_size_mismatch', {
        expected: baseline.length,
        got: plan.entries.length,
      });
      return null;
    }

    const validUserIds = new Set(qualifiedUsers.map(u => u.user_id));
    const nameByTemplate = new Map(templates.map((t: any) => [t.id, t.name]));
    return plan.entries.map(e => ({
      template_id: e.template_id,
      template_name: nameByTemplate.get(e.template_id) ?? '',
      scheduled_date: e.scheduled_date,
      assigned_to_user_id: e.assigned_to_user_id && validUserIds.has(e.assigned_to_user_id)
        ? e.assigned_to_user_id
        : null,
      rationale: e.rationale,
    }));
  } catch (err: any) {
    log.warn('count_schedule.auto.ai_failed', { error: err?.message });
    return null;
  }
}

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }): Promise<{
  data: any;
  status: number;
  events: Array<{ event_name: string; payload: any; last_event_id: string }>;
}> => {
  const body = AutoScheduleSchema.parse(await req.json());
  const inv = (supabase as any).schema('inventory');

  const [templatesRes, qualifiedRes, existingRes] = await Promise.all([
    inv.from('cycle_count_templates')
      .select('id, name, frequency_per_year, location:locations(id, name)')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true)
      .limit(200),
    inv.from('cycle_count_qualified_users')
      .select('user_id')
      .eq('tenant_id', ctx.tenantId)
      .eq('active', true)
      .limit(200),
    inv.from('cycle_count_schedule')
      .select('template_id, scheduled_date')
      .eq('tenant_id', ctx.tenantId)
      .gte('scheduled_date', toDateStr(new Date()))
      .limit(1000),
  ]);

  if (templatesRes.error) throw AppError.internal(templatesRes.error.message);
  if (qualifiedRes.error) throw AppError.internal(qualifiedRes.error.message);
  if (existingRes.error) throw AppError.internal(existingRes.error.message);

  const templates = templatesRes.data || [];
  if (templates.length === 0) {
    throw AppError.badRequest('No active count templates — create a template first');
  }

  // Resolve qualified user names for the AI prompt
  const qualifiedIds = (qualifiedRes.data || []).map((q: any) => q.user_id);
  let qualifiedUsers: { user_id: string; name: string }[] = [];
  if (qualifiedIds.length > 0) {
    const { data: users } = await (supabase as any)
      .from('local_users')
      .select('user_id, name')
      .in('user_id', qualifiedIds)
      .limit(200);
    qualifiedUsers = (users || []).map((u: any) => ({ user_id: u.user_id, name: u.name || 'Unknown' }));
  }

  const existingByTemplate = new Map<string, Set<string>>();
  for (const e of existingRes.data || []) {
    if (!existingByTemplate.has(e.template_id)) existingByTemplate.set(e.template_id, new Set());
    existingByTemplate.get(e.template_id)!.add(e.scheduled_date);
  }

  const baseline = deterministicPlan(templates, existingByTemplate, body.horizon_days);
  if (baseline.length === 0) {
    return {
      data: { entries: [], created: 0, message: 'Schedule is already filled for this horizon.' },
      status: 200,
      events: [],
    };
  }

  const plan = (await aiRefine(baseline, templates, qualifiedUsers, log))
    ?? roundRobinAssign(baseline, qualifiedUsers.map(u => u.user_id));

  if (body.dry_run) {
    return {
      data: { entries: plan, created: 0, dryRun: true, aiUsed: qualifiedUsers.length > 0 && Boolean(process.env.OPENAI_API_KEY) },
      status: 200,
      events: [],
    };
  }

  const rows = plan.map((e, i) => ({
    tenant_id: ctx.tenantId,
    template_id: e.template_id,
    scheduled_date: e.scheduled_date,
    assigned_to_user_id: e.assigned_to_user_id,
    status: 'planned',
    ai_rationale: e.rationale,
    last_event_id: `${idempotencyKey}:${i}`,
  }));

  const { data: inserted, error: insertErr } = await inv
    .from('cycle_count_schedule')
    .upsert(rows, { onConflict: 'tenant_id,template_id,scheduled_date', ignoreDuplicates: true })
    .select();

  if (insertErr) {
    log.error('count_schedule.auto.insert_failed', { error: insertErr.message });
    throw AppError.internal(insertErr.message);
  }

  log.info('count_schedule.auto.generated', { count: inserted?.length ?? 0 });

  return {
    data: { entries: plan, created: inserted?.length ?? 0 },
    status: 201,
    events: [{
      event_name: 'cycle_count_schedule.auto_generated',
      payload: { created: inserted?.length ?? 0, horizon_days: body.horizon_days },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw', serviceName: SERVICE_NAME, scope: 'POST /api/inventory/count-schedule/auto' });
