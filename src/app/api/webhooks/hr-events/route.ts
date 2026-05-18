import { createWebhookRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import { orchestrateProvisioning } from '@/lib/provisioning/orchestrator';
import { upsertEmployeeSizing } from '@/lib/provisioning/employee-sizing';
import type { SizeDimension } from '@/lib/provisioning/employee-sizing';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'my-service';

/**
 * Webhook endpoint for HR events from Summit Core.
 *
 * Routes employee events through the provisioning orchestrator when
 * provisioning policies are configured. Falls back to the legacy
 * apparel workflow if no policies match.
 */
export const POST = createWebhookRoute(async ({ eventType, payload, supabase, log, tenantId }) => {
  switch (eventType) {
    case 'employee.created':
    case 'employee.transferred':
    case 'employee.promoted': {
      // Upsert employee sizing data from HR payload if present
      await upsertSizingFromPayload(supabase, payload, tenantId, log);
      // Try the new provisioning orchestrator first
      const provisioningHandled = await handleViaProvisioning(supabase, eventType, payload, tenantId, log);
      // Fall back to legacy apparel flow if no provisioning policies matched
      if (!provisioningHandled && eventType === 'employee.created') {
        await handleEmployeeCreated(supabase, payload, tenantId, log);
      }
      break;
    }
    default:
      log.warn('hr-webhook.unhandled', { eventType });
  }
}, {
  serviceName: SERVICE_NAME,
  consumerKey: `${SERVICE_NAME}.hr_webhook_v1`,
  createClient: async (tenantId) => createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId,
  }),
});

// ── Employee Sizing Extraction ────────────────────────────────────────────────

const SIZING_FIELDS: SizeDimension[] = ['shirt_size', 'hoodie_size', 'jacket_size', 'pants_size', 'boot_size'];

async function upsertSizingFromPayload(
  supabase: SupabaseClient,
  payload: any,
  tenantId: string,
  log: any,
): Promise<void> {
  if (!payload.employee_id) return;

  const sizing: Record<string, string> = {};
  for (const field of SIZING_FIELDS) {
    if (payload[field]) {
      sizing[field] = payload[field];
    }
  }
  // Also check preferred_fit
  if (payload.preferred_fit) {
    sizing.preferred_fit = payload.preferred_fit;
  }

  if (Object.keys(sizing).length === 0) return;

  try {
    await upsertEmployeeSizing(
      supabase,
      tenantId,
      payload.employee_id,
      sizing,
      `hr-sizing-${tenantId}-${payload.employee_id}-${new Date().toISOString().split('T')[0]}`,
    );
    log.info('hr-webhook.sizing_upserted', { employeeId: payload.employee_id, fields: Object.keys(sizing) });
  } catch (err: any) {
    log.warn('hr-webhook.sizing_upsert_failed', { error: err.message });
  }
}

// ── Provisioning Orchestrator Integration ───────────────────────────────────

async function handleViaProvisioning(
  supabase: SupabaseClient,
  eventType: string,
  payload: any,
  tenantId: string,
  log: any,
): Promise<boolean> {
  try {
    const idempotencyKey = `hr-provision-${tenantId}-${payload.employee_id}-${eventType}-${new Date().toISOString().split('T')[0]}`;

    const result = await orchestrateProvisioning(
      supabase,
      tenantId,
      eventType,
      {
        employeeId: payload.employee_id,
        employeeName: payload.employee_name,
        position: payload.position,
        division: payload.division,
        location: payload.location,
        certifications: payload.certifications,
        employmentType: payload.employment_type,
        shirtSize: payload.shirt_size,
        attributes: payload,
      },
      idempotencyKey,
      {
        shippingAddress: payload.shipping_address,
      },
    );

    if (result.status === 'no_match') {
      log.info('hr-webhook.no_provisioning_policy', { eventType, employeeId: payload.employee_id });
      return false;
    }

    log.info('hr-webhook.provisioning_triggered', {
      requestId: result.requestId,
      status: result.status,
      lineCount: result.lines.length,
    });
    return true;
  } catch (err: any) {
    log.error('hr-webhook.provisioning_failed', { error: err.message, eventType });
    return false;
  }
}

// ── Event Handler ────────────────────────────────────────────────────────────

async function handleEmployeeCreated(
  supabase: SupabaseClient,
  payload: any,
  tenantId: string,
  log: any
) {
  const { shirt_size, employee_name, employee_id } = payload;

  if (!shirt_size) {
    log.info('hr-webhook.no_shirt_size', { employee_id });
    return;
  }

  const sizeUpper = shirt_size.toUpperCase().trim();

  // 1. Load apparel config for this tenant
  const inv = (supabase as any).schema('inventory');

  const { data: config, error: configError } = await inv
    .from('apparel_config')
    .select('*')
    .eq('tenant_id', tenantId)
    .limit(1)
    .single();

  if (configError || !config || !config.enabled) {
    log.info('hr-webhook.apparel_not_configured', { tenantId });
    return;
  }

  // 2. Look up catalog_item_id from size_variant_map
  const sizeConfig = config.size_variant_map?.[sizeUpper];
  if (!sizeConfig?.catalog_item_id) {
    log.warn('hr-webhook.unknown_size', { size: sizeUpper, tenantId });
    return;
  }

  const catalogItemId = sizeConfig.catalog_item_id;

  // 3. Find a location that has stock of this item (pick the first with available qty)
  const { data: balances } = await inv
    .from('stock_balances')
    .select('location_id, qty_available')
    .eq('catalog_item_id', catalogItemId)
    .gt('qty_available', 0)
    .order('qty_available', { ascending: false })
    .limit(1);

  const locationId = balances?.[0]?.location_id;

  if (!locationId) {
    log.warn('hr-webhook.no_stock_available', { catalogItemId, size: sizeUpper });
    // Still check if we need to reorder, even though we can't reserve
    await checkAndCreateReorder(inv, tenantId, config, sizeUpper, payload, log);
    return;
  }

  // 4. Create reservation via RPC
  const idempotencyKey = `hr-shirt-${tenantId}-${employee_id}-${sizeUpper}`;

  const { error: reserveError } = await inv
    .rpc('rpc_inv_reserve_fungible', {
      p_catalog_item_id: catalogItemId,
      p_location_id: locationId,
      p_qty: 1,
      p_allocation_type: 'person',
      p_job_ref: employee_name || employee_id || 'New Employee',
      p_notes: `Auto-reserved for new employee (${sizeUpper})`,
      p_last_event_id: idempotencyKey,
    });

  if (reserveError) {
    log.error('hr-webhook.reserve_failed', { error: reserveError.message, catalogItemId });
  } else {
    log.info('hr-webhook.shirt_reserved', {
      employee_id,
      size: sizeUpper,
      catalogItemId,
      locationId,
    });
  }

  // 5. Check stock and potentially create reorder
  await checkAndCreateReorder(inv, tenantId, config, sizeUpper, payload, log);
}

// ── Reorder Logic ────────────────────────────────────────────────────────────

async function checkAndCreateReorder(
  inv: any,
  tenantId: string,
  config: any,
  triggerSize: string,
  triggerPayload: any,
  log: any
) {
  const threshold = config.reorder_threshold ?? 5;
  const defaultQty = config.default_reorder_qty ?? 10;
  const sizeMap = config.size_variant_map || {};

  // Check all sizes for low stock
  const lowStockItems: Array<{
    size: string;
    quantity: number;
    variant_id: number;
    catalog_item_id: string;
  }> = [];

  for (const [size, mapping] of Object.entries(sizeMap) as Array<[string, any]>) {
    if (!mapping?.catalog_item_id) continue;

    const { data: balance } = await inv
      .from('stock_balances')
      .select('qty_available')
      .eq('catalog_item_id', mapping.catalog_item_id)
      .limit(1)
      .single();

    const available = balance?.qty_available ?? 0;

    if (available <= threshold) {
      lowStockItems.push({
        size,
        quantity: defaultQty,
        variant_id: mapping.variant_id,
        catalog_item_id: mapping.catalog_item_id,
      });
    }
  }

  if (lowStockItems.length === 0) {
    log.info('hr-webhook.stock_ok', { tenantId });
    return;
  }

  // Check for existing pending order to avoid duplicates
  const { data: existingOrder } = await inv
    .from('apparel_orders')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('status', 'pending_approval')
    .limit(1)
    .single();

  if (existingOrder) {
    log.info('hr-webhook.pending_order_exists', { orderId: existingOrder.id });
    return;
  }

  // Create new pending apparel order
  const { data: order, error: orderError } = await inv
    .from('apparel_orders')
    .upsert({
      tenant_id: tenantId,
      status: 'pending_approval',
      trigger_event: 'employee.created',
      trigger_payload: triggerPayload,
      items: lowStockItems,
      notes: `Auto-generated: low stock detected after ${triggerSize} shirt reserved for new employee`,
    }, { onConflict: 'id' })
    .select('id')
    .single();

  if (orderError) {
    log.error('hr-webhook.order_create_failed', { error: orderError.message });
  } else {
    log.info('hr-webhook.reorder_created', {
      orderId: order?.id,
      sizes: lowStockItems.map((i) => i.size),
    });
  }
}
