import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getTemplate, getTemplateNames } from '@/lib/ai/dashboard-templates';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

const CreateDashboardSchema = z.object({
  template: z.enum(['executive', 'operations', 'inventory_health', 'alerts', 'asset_tracking']),
  name: z.string().min(1).optional(),
});

export const POST = createSessionWriteRoute(async ({ ctx, req, log, supabase, idempotencyKey }) => {
  const body = CreateDashboardSchema.parse(await req.json());

  const template = getTemplate(body.template);
  if (!template) {
    throw AppError.badRequest(`Invalid template: ${body.template}. Valid templates: ${getTemplateNames().join(', ')}`);
  }

  const dashboardName = body.name || template.name;

  // Create the dashboard record
  const { data: dashboard, error: dashError } = await supabase
    .from('dashboards')
    .upsert({
      tenant_id: ctx.tenantId,
      name: dashboardName,
      description: template.description,
      scope: 'user',
      owner_user_id: ctx.userId,
      is_default: false,
      last_event_id: `${idempotencyKey}_dashboard`,
    })
    .select()
    .single();

  if (dashError) {
    throw AppError.internal(`Failed to create dashboard: ${dashError.message}`);
  }

  log.info('dashboard.created', { dashboardId: dashboard.id, template: body.template });

  // Create widgets for the dashboard
  const widgetInserts = template.widgets.map((w, i) => ({
    dashboard_id: dashboard.id,
    tenant_id: ctx.tenantId,
    widget_key: w.widget_key,
    title: w.title,
    config: w.config,
    layout: w.layout,
    refresh_seconds: 300,
    last_event_id: `${idempotencyKey}_widget_${i}`,
  }));

  // Plain insert: dashboard_widgets has no unique on last_event_id, so
  // onConflict:'last_event_id' errored (and silently produced widget-less
  // dashboards). Widgets are always new for a freshly created dashboard, and the
  // write-route idempotency guard covers retries.
  const { error: widgetError } = await supabase
    .from('dashboard_widgets')
    .insert(widgetInserts);

  if (widgetError) {
    log.error('dashboard_widgets.insert_error', { error: widgetError.message });
    // Dashboard was created but widgets failed — non-fatal
  }

  return {
    data: {
      id: dashboard.id,
      name: dashboardName,
      template: body.template,
      widgetCount: template.widgets.length,
    },
    status: 201,
    events: [{
      event_name: 'dashboard.created',
      payload: {
        dashboard_id: dashboard.id,
        name: dashboardName,
        template: body.template,
        widget_count: template.widgets.length,
      },
      last_event_id: idempotencyKey,
    }],
  };
}, { bodySchema: 'raw',
  serviceName: SERVICE_NAME,
  scope: 'POST /api/ai/create-dashboard',
});
