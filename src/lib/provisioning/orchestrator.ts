/**
 * Provisioning Orchestrator
 *
 * Core orchestration flow for provisioning requests:
 * 1. Receive employee context + trigger event
 * 2. Call policy engine to evaluate rules
 * 3. Resolve kit items with variant resolution
 * 4. Select providers and determine fulfillment method
 * 5. Create provisioning_request + provisioning_lines
 * 6. For from_stock lines: create inventory reservations
 * 7. For external_order lines: call provider.placeOrder()
 * 8. Record history entries
 * 9. Return events for outbox emission
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluatePolicies, type EmployeeContext } from './policy-engine';
import { resolveItems, type ResolvedItem } from './variant-resolver';
import { selectProvidersForLines, type ProviderSelection } from './provider-selector';
import { getProvider } from './providers/registry';
import type { ProviderType, ProviderLineItem, ShippingAddress } from './providers/types';
import { resolveShippingAddress } from './shipping';

// Ensure provider modules are registered
import './providers/internal-warehouse';
import './providers/printify';

export interface ProvisioningEvent {
  event_name: string;
  payload: Record<string, unknown>;
  last_event_id: string;
}

export interface OrchestrateResult {
  requestId: string;
  status: string;
  lines: Array<{
    lineId: string;
    catalogItemId: string;
    status: string;
    fulfillmentMethod: string;
    providerId: string | null;
    dryRunPayload?: Record<string, unknown>;
  }>;
  events: ProvisioningEvent[];
  requiresApproval: boolean;
  isDryRun?: boolean;
  blockingReasons?: Array<{ type: string; lineId?: string; catalogItemId?: string; needed?: string }>;
}

/**
 * Build the idempotency dedup key for event-triggered requests.
 */
function buildDedupKey(tenantId: string, employeeId: string, triggerEvent: string): string {
  const today = new Date().toISOString().split('T')[0];
  return `hr-provision-${tenantId}-${employeeId}-${triggerEvent}-${today}`;
}

/**
 * Record a history entry for a request or line action.
 */
async function recordHistory(
  prov: any,
  tenantId: string,
  requestId: string | null,
  lineId: string | null,
  action: string,
  oldStatus: string | null,
  newStatus: string | null,
  actorSystem: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await prov
    .from('provisioning_history')
    .insert({
      tenant_id: tenantId,
      request_id: requestId,
      line_id: lineId,
      action,
      old_status: oldStatus,
      new_status: newStatus,
      actor_system: actorSystem,
      details,
    });
}

/**
 * Main orchestration entry point.
 *
 * Called from the HR webhook handler or manual request creation.
 */
export async function orchestrateProvisioning(
  supabase: SupabaseClient,
  tenantId: string,
  triggerEvent: string,
  employee: EmployeeContext,
  idempotencyKey: string,
  options?: {
    deliveryMethod?: string;
    shippingAddress?: Record<string, unknown>;
    priority?: number;
    neededBy?: string;
    skipPolicyEvaluation?: boolean;
    kitId?: string;
    requiresApproval?: boolean;
    dryRun?: boolean;
  },
): Promise<OrchestrateResult> {
  const prov = (supabase as any).schema('provisioning');
  const events: ProvisioningEvent[] = [];

  // 1. Check for duplicate request
  const dedupKey = buildDedupKey(tenantId, employee.employeeId, triggerEvent);
  const { data: existingRequest } = await prov
    .from('provisioning_requests')
    .select('id, status')
    .eq('dedup_key', dedupKey)
    .limit(1)
    .single();

  if (existingRequest) {
    // Already processed — return existing request info
    const { data: existingLines } = await prov
      .from('provisioning_lines')
      .select('id, catalog_item_id, status, fulfillment_method, provider_id')
      .eq('request_id', existingRequest.id)
      .limit(100);

    return {
      requestId: existingRequest.id,
      status: existingRequest.status,
      lines: (existingLines ?? []).map((l: any) => ({
        lineId: l.id,
        catalogItemId: l.catalog_item_id,
        status: l.status,
        fulfillmentMethod: l.fulfillment_method,
        providerId: l.provider_id,
      })),
      events: [],
      requiresApproval: false,
    };
  }

  // 2. Evaluate policies (unless skipped for manual requests)
  let kitId = options?.kitId ?? null;
  let inlineItems = null;
  let requiresApproval = options?.requiresApproval ?? false;
  let policyRuleId: string | null = null;

  if (!options?.skipPolicyEvaluation) {
    const evalResult = await evaluatePolicies(supabase, tenantId, triggerEvent, employee);
    if (!evalResult.matched) {
      // No policy matches — nothing to provision
      return {
        requestId: '',
        status: 'no_match',
        lines: [],
        events: [],
        requiresApproval: false,
      };
    }
    kitId = evalResult.kitId;
    inlineItems = evalResult.items;
    requiresApproval = evalResult.requiresApproval;
    policyRuleId = evalResult.rule?.id ?? null;
  }

  // 3. Resolve items (variant resolution)
  const resolvedItems = await resolveItems(supabase, tenantId, employee, kitId, inlineItems);

  if (resolvedItems.length === 0) {
    return {
      requestId: '',
      status: 'no_items',
      lines: [],
      events: [],
      requiresApproval: false,
    };
  }

  // 4. Resolve shipping address (needed for external orders)
  let resolvedAddress: ShippingAddress | undefined;
  try {
    resolvedAddress = await resolveShippingAddress(supabase, tenantId, {
      explicitAddress: options?.shippingAddress as ShippingAddress | undefined,
    });
  } catch {
    // No shipping address available — acceptable for from_stock-only requests.
    // External order lines will fail individually if address is missing.
  }

  // 5. Select providers for each resolved item
  const providerSelections = await selectProvidersForLines(
    supabase,
    tenantId,
    resolvedItems.map((item) => ({
      catalogItemId: item.catalogItemId,
      qty: item.qty,
    })),
  );

  // 6. Blocking checks — detect issues that prevent fulfillment
  const blockingReasons: Array<{ type: string; lineId?: string; catalogItemId?: string; needed?: string }> = [];

  for (let i = 0; i < resolvedItems.length; i++) {
    const item = resolvedItems[i];
    const selection = providerSelections[i];

    // Check 1: Missing mapping for external orders
    if (selection.fulfillmentMethod === 'external_order' &&
        (!selection.externalProductId || !selection.externalVariantId)) {
      blockingReasons.push({
        type: 'missing_mapping',
        catalogItemId: item.catalogItemId,
      });
    }

    // Check 2: Missing sizing (variant resolution failed)
    if (item.substitutionReason === 'Variant resolution failed; manual selection required') {
      blockingReasons.push({
        type: 'missing_sizing',
        catalogItemId: item.originalCatalogItemId,
      });
    }
  }

  // Check 3: Missing address for external orders
  const hasExternalOrders = providerSelections.some(s => s.fulfillmentMethod === 'external_order');
  if (hasExternalOrders && !resolvedAddress) {
    blockingReasons.push({ type: 'missing_address' });
  }

  // 7. If blocked, create request in blocked state and return early
  if (blockingReasons.length > 0) {
    // Priority: needs_mapping > needs_address > needs_sizing
    const blockingStatus = blockingReasons.some(r => r.type === 'missing_mapping')
      ? 'needs_mapping'
      : blockingReasons.some(r => r.type === 'missing_address')
        ? 'needs_address'
        : 'needs_sizing';

    const { data: request, error: reqError } = await prov
      .from('provisioning_requests')
      .upsert({
        tenant_id: tenantId,
        employee_id: employee.employeeId,
        employee_name: employee.employeeName,
        employee_attributes: {
          position: employee.position,
          division: employee.division,
          location: employee.location,
          certifications: employee.certifications,
          employmentType: employee.employmentType,
          shirtSize: employee.shirtSize,
          ...employee.attributes,
        },
        trigger_event: triggerEvent,
        trigger_payload: employee,
        policy_rule_id: policyRuleId,
        kit_id: kitId,
        status: blockingStatus,
        delivery_method: options?.deliveryMethod,
        shipping_address: resolvedAddress ?? options?.shippingAddress,
        priority: options?.priority ?? 100,
        needed_by: options?.neededBy,
        dedup_key: dedupKey,
        last_event_id: idempotencyKey,
      }, { onConflict: 'last_event_id' })
      .select()
      .single();

    if (reqError) {
      throw new Error(`Failed to create provisioning request: ${reqError.message}`);
    }

    // Create lines in blocked/pending state
    const lineResults: OrchestrateResult['lines'] = [];
    for (let i = 0; i < resolvedItems.length; i++) {
      const item = resolvedItems[i];
      const selection = providerSelections[i];

      const { data: line, error: lineError } = await prov
        .from('provisioning_lines')
        .upsert({
          tenant_id: tenantId,
          request_id: request.id,
          catalog_item_id: item.catalogItemId,
          qty: item.qty,
          fulfillment_method: selection.fulfillmentMethod,
          provider_id: selection.providerId,
          resolved_variant_attributes: item.resolvedVariantAttributes,
          source_location_id: selection.sourceLocationId,
          status: 'pending',
          original_catalog_item_id: item.isSubstitution ? item.originalCatalogItemId : null,
          substitution_reason: item.substitutionReason,
        }, { onConflict: 'id' })
        .select()
        .single();

      if (lineError) continue;

      lineResults.push({
        lineId: line.id,
        catalogItemId: item.catalogItemId,
        status: 'pending',
        fulfillmentMethod: selection.fulfillmentMethod,
        providerId: selection.providerId,
      });

      await recordHistory(prov, tenantId, request.id, line.id, 'line_created', null, 'pending', 'orchestrator', {
        catalog_item_id: item.catalogItemId,
        fulfillment_method: selection.fulfillmentMethod,
        blocked: true,
      });
    }

    await recordHistory(prov, tenantId, request.id, null, 'request_blocked', null, blockingStatus, 'orchestrator', {
      trigger_event: triggerEvent,
      employee_id: employee.employeeId,
      blocking_reasons: blockingReasons,
    });

    events.push({
      event_name: 'provision_request.blocked',
      payload: { request_id: request.id, employee_id: employee.employeeId, status: blockingStatus, blocking_reasons: blockingReasons },
      last_event_id: idempotencyKey,
    });

    return {
      requestId: request.id,
      status: blockingStatus,
      lines: lineResults,
      events,
      requiresApproval,
      blockingReasons,
    };
  }

  // 8. Check dry-run mode
  const isDryRun = options?.dryRun || process.env.PRINTIFY_DRY_RUN === 'true';

  // 9. Create provisioning request
  const initialStatus = isDryRun
    ? 'dry_run'
    : requiresApproval
      ? 'needs_approval'
      : 'provisioning';

  const { data: request, error: reqError } = await prov
    .from('provisioning_requests')
    .upsert({
      tenant_id: tenantId,
      employee_id: employee.employeeId,
      employee_name: employee.employeeName,
      employee_attributes: {
        position: employee.position,
        division: employee.division,
        location: employee.location,
        certifications: employee.certifications,
        employmentType: employee.employmentType,
        shirtSize: employee.shirtSize,
        ...employee.attributes,
      },
      trigger_event: triggerEvent,
      trigger_payload: employee,
      policy_rule_id: policyRuleId,
      kit_id: kitId,
      status: initialStatus,
      is_dry_run: isDryRun || false,
      delivery_method: options?.deliveryMethod,
      shipping_address: resolvedAddress ?? options?.shippingAddress,
      priority: options?.priority ?? 100,
      needed_by: options?.neededBy,
      dedup_key: dedupKey,
      last_event_id: idempotencyKey,
    }, { onConflict: 'last_event_id' })
    .select()
    .single();

  if (reqError) {
    throw new Error(`Failed to create provisioning request: ${reqError.message}`);
  }

  await recordHistory(prov, tenantId, request.id, null, 'request_created', null, initialStatus, 'orchestrator', {
    trigger_event: triggerEvent,
    employee_id: employee.employeeId,
    item_count: resolvedItems.length,
    is_dry_run: isDryRun,
  });

  events.push({
    event_name: 'provision_request.created',
    payload: { request_id: request.id, employee_id: employee.employeeId, status: initialStatus, is_dry_run: isDryRun },
    last_event_id: idempotencyKey,
  });

  // 10. Create provisioning lines
  const lineResults: OrchestrateResult['lines'] = [];

  for (let i = 0; i < resolvedItems.length; i++) {
    const item = resolvedItems[i];
    const selection = providerSelections[i];

    // In dry-run mode, external_order lines get dry_run_complete status
    const lineStatus = isDryRun
      ? (selection.fulfillmentMethod === 'external_order' ? 'dry_run_complete' : 'pending')
      : requiresApproval
        ? 'pending'
        : (selection.fulfillmentMethod === 'from_stock' ? 'reserved' : 'pending');

    // Build dry-run payload for external_order lines
    let dryRunPayload: Record<string, unknown> | undefined;
    if (isDryRun && selection.fulfillmentMethod === 'external_order') {
      dryRunPayload = {
        provider_type: selection.providerType,
        provider_id: selection.providerId,
        external_product_id: selection.externalProductId,
        external_variant_id: selection.externalVariantId,
        shipping_address: resolvedAddress,
        qty: item.qty,
        would_submit_to: selection.providerType,
      };
    }

    const { data: line, error: lineError } = await prov
      .from('provisioning_lines')
      .upsert({
        tenant_id: tenantId,
        request_id: request.id,
        catalog_item_id: item.catalogItemId,
        qty: item.qty,
        fulfillment_method: selection.fulfillmentMethod,
        provider_id: selection.providerId,
        resolved_variant_attributes: item.resolvedVariantAttributes,
        source_location_id: selection.sourceLocationId,
        status: lineStatus,
        original_catalog_item_id: item.isSubstitution ? item.originalCatalogItemId : null,
        substitution_reason: item.substitutionReason,
        dry_run_payload: dryRunPayload ?? null,
      }, { onConflict: 'id' })
      .select()
      .single();

    if (lineError) continue;

    lineResults.push({
      lineId: line.id,
      catalogItemId: item.catalogItemId,
      status: lineStatus,
      fulfillmentMethod: selection.fulfillmentMethod,
      providerId: selection.providerId,
      dryRunPayload,
    });

    // Execute fulfillment only if NOT dry-run and NOT awaiting approval
    if (!isDryRun && !requiresApproval && selection.fulfillmentMethod === 'from_stock' && selection.providerId) {
      const provider = getProvider('internal_warehouse');
      if (provider) {
        const orderResult = await provider.placeOrder(
          {
            tenantId,
            requestId: request.id,
            idempotencyKey: `prov-order-${tenantId}-${line.id}`,
            items: [{
              lineId: line.id,
              catalogItemId: item.catalogItemId,
              externalProductId: '',
              externalVariantId: '',
              qty: item.qty,
            }],
          },
          {},
        );

        if (orderResult.success) {
          await prov
            .from('provisioning_lines')
            .update({ status: 'reserved', last_event_id: `prov-reserved-${line.id}` })
            .eq('id', line.id);

          events.push({
            event_name: 'provision_line.reserved',
            payload: { line_id: line.id, request_id: request.id },
            last_event_id: `prov-reserved-${line.id}`,
          });
        }
      }
    }

    // External order fulfillment — skip in dry-run mode
    if (!isDryRun && !requiresApproval && selection.fulfillmentMethod === 'external_order' && selection.providerId) {
      const providerType = selection.providerType as ProviderType;
      const provider = getProvider(providerType);
      if (provider) {
        const lineIdempKey = `prov-order-${tenantId}-${line.id}`;

        // Fetch provider config
        const { data: providerConfig } = await prov
          .from('providers')
          .select('config')
          .eq('id', selection.providerId)
          .limit(1)
          .single();

        const orderResult = await provider.placeOrder(
          {
            tenantId,
            requestId: request.id,
            idempotencyKey: lineIdempKey,
            shippingAddress: resolvedAddress,
            items: [{
              lineId: line.id,
              catalogItemId: item.catalogItemId,
              externalProductId: selection.externalProductId ?? '',
              externalVariantId: selection.externalVariantId ?? '',
              qty: item.qty,
            }],
          },
          providerConfig?.config ?? {},
        );

        const newStatus = orderResult.success ? 'ordered' : 'failed';
        await prov
          .from('provisioning_lines')
          .update({
            status: newStatus,
            external_order_id: orderResult.externalOrderId ?? null,
            last_event_id: lineIdempKey,
          })
          .eq('id', line.id);

        events.push({
          event_name: `provision_line.${newStatus}`,
          payload: { line_id: line.id, request_id: request.id, external_order_id: orderResult.externalOrderId },
          last_event_id: lineIdempKey,
        });
      }
    }

    await recordHistory(prov, tenantId, request.id, line.id, 'line_created', null, lineStatus, 'orchestrator', {
      catalog_item_id: item.catalogItemId,
      fulfillment_method: selection.fulfillmentMethod,
      is_dry_run: isDryRun,
    });
  }

  return {
    requestId: request.id,
    status: initialStatus,
    lines: lineResults,
    events,
    requiresApproval,
    isDryRun: isDryRun || undefined,
  };
}

/**
 * Approve a provisioning request and begin fulfillment.
 */
export async function approveRequest(
  supabase: SupabaseClient,
  tenantId: string,
  requestId: string,
  userId: string | undefined,
  idempotencyKey: string,
): Promise<{ events: ProvisioningEvent[] }> {
  const prov = (supabase as any).schema('provisioning');
  const events: ProvisioningEvent[] = [];

  const { data: request } = await prov
    .from('provisioning_requests')
    .select('*')
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .single();

  if (!request) throw new Error('Request not found');
  if (request.status !== 'awaiting_approval' && request.status !== 'needs_approval') {
    throw new Error(`Cannot approve request in status: ${request.status}`);
  }

  // Update request status
  await prov
    .from('provisioning_requests')
    .update({ status: 'provisioning', last_event_id: idempotencyKey })
    .eq('id', requestId);

  await recordHistory(prov, tenantId, requestId, null, 'request_approved', 'awaiting_approval', 'provisioning', 'user', {
    approved_by: userId,
  });

  events.push({
    event_name: 'provision_request.approved',
    payload: { request_id: requestId },
    last_event_id: idempotencyKey,
  });

  // Resolve shipping address for external orders
  let resolvedAddress: ShippingAddress | undefined;
  try {
    resolvedAddress = await resolveShippingAddress(supabase, tenantId, {
      explicitAddress: request.shipping_address as ShippingAddress | undefined,
    });
  } catch {
    // No address available — external_order lines will fail individually
  }

  // Execute fulfillment for pending lines
  const { data: lines } = await prov
    .from('provisioning_lines')
    .select('*')
    .eq('request_id', requestId)
    .eq('status', 'pending')
    .limit(100);

  if (lines) {
    for (const line of lines) {
      if (line.fulfillment_method === 'from_stock' && line.provider_id) {
        const provider = getProvider('internal_warehouse');
        if (provider) {
          const lineIdempKey = `prov-order-${tenantId}-${line.id}`;
          const result = await provider.placeOrder(
            {
              tenantId,
              requestId,
              idempotencyKey: lineIdempKey,
              items: [{
                lineId: line.id,
                catalogItemId: line.catalog_item_id,
                externalProductId: '',
                externalVariantId: '',
                qty: line.qty,
              }],
            },
            {},
          );

          const newStatus = result.success ? 'reserved' : 'failed';
          await prov
            .from('provisioning_lines')
            .update({ status: newStatus, last_event_id: lineIdempKey })
            .eq('id', line.id);

          events.push({
            event_name: `provision_line.${newStatus}`,
            payload: { line_id: line.id, request_id: requestId },
            last_event_id: lineIdempKey,
          });
        }
      }

      if (line.fulfillment_method === 'external_order' && line.provider_id) {
        // Fetch provider record for type + config
        const { data: providerRecord } = await prov
          .from('providers')
          .select('provider_type, config')
          .eq('id', line.provider_id)
          .limit(1)
          .single();

        if (providerRecord) {
          const provider = getProvider(providerRecord.provider_type as ProviderType);
          if (provider) {
            const lineIdempKey = `prov-order-${tenantId}-${line.id}`;
            const result = await provider.placeOrder(
              {
                tenantId,
                requestId,
                idempotencyKey: lineIdempKey,
                shippingAddress: resolvedAddress,
                items: [{
                  lineId: line.id,
                  catalogItemId: line.catalog_item_id,
                  externalProductId: line.external_product_id ?? '',
                  externalVariantId: line.external_variant_id ?? '',
                  qty: line.qty,
                }],
              },
              providerRecord.config ?? {},
            );

            const newStatus = result.success ? 'ordered' : 'failed';
            await prov
              .from('provisioning_lines')
              .update({
                status: newStatus,
                external_order_id: result.externalOrderId ?? null,
                last_event_id: lineIdempKey,
              })
              .eq('id', line.id);

            events.push({
              event_name: `provision_line.${newStatus}`,
              payload: { line_id: line.id, request_id: requestId, external_order_id: result.externalOrderId },
              last_event_id: lineIdempKey,
            });
          }
        }
      }
    }
  }

  return { events };
}

/**
 * Cancel a provisioning request.
 */
export async function cancelRequest(
  supabase: SupabaseClient,
  tenantId: string,
  requestId: string,
  userId: string | undefined,
  reason: string,
  idempotencyKey: string,
): Promise<{ events: ProvisioningEvent[] }> {
  const prov = (supabase as any).schema('provisioning');
  const events: ProvisioningEvent[] = [];

  const { data: request } = await prov
    .from('provisioning_requests')
    .select('status')
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .single();

  if (!request) throw new Error('Request not found');

  const cancellableStatuses = ['pending', 'evaluating', 'awaiting_approval', 'approved', 'provisioning', 'needs_approval', 'needs_mapping', 'needs_address', 'needs_sizing', 'ready_to_order', 'draft'];
  if (!cancellableStatuses.includes(request.status)) {
    throw new Error(`Cannot cancel request in status: ${request.status}`);
  }

  const oldStatus = request.status;

  // Cancel all non-terminal lines
  await prov
    .from('provisioning_lines')
    .update({ status: 'cancelled' })
    .eq('request_id', requestId)
    .in('status', ['pending', 'reserved', 'ordered', 'backordered']);

  // Cancel the request
  await prov
    .from('provisioning_requests')
    .update({ status: 'cancelled', last_event_id: idempotencyKey })
    .eq('id', requestId);

  await recordHistory(prov, tenantId, requestId, null, 'request_cancelled', oldStatus, 'cancelled', 'user', {
    cancelled_by: userId,
    reason,
  });

  events.push({
    event_name: 'provision_request.cancelled',
    payload: { request_id: requestId, reason },
    last_event_id: idempotencyKey,
  });

  return { events };
}

/**
 * Issue a provisioning line (mark as issued and record employee provision).
 */
export async function issueLine(
  supabase: SupabaseClient,
  tenantId: string,
  requestId: string,
  lineId: string,
  userId: string | undefined,
  idempotencyKey: string,
): Promise<{ events: ProvisioningEvent[] }> {
  const prov = (supabase as any).schema('provisioning');
  const events: ProvisioningEvent[] = [];

  const { data: line } = await prov
    .from('provisioning_lines')
    .select('*, provisioning_requests!inner(employee_id, employee_name)')
    .eq('id', lineId)
    .eq('request_id', requestId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .single();

  if (!line) throw new Error('Provisioning line not found');

  const issuableStatuses = ['reserved', 'delivered', 'ordered'];
  if (!issuableStatuses.includes(line.status)) {
    throw new Error(`Cannot issue line in status: ${line.status}`);
  }

  const oldStatus = line.status;

  // Update line status
  await prov
    .from('provisioning_lines')
    .update({ status: 'issued', last_event_id: idempotencyKey })
    .eq('id', lineId);

  // Create employee provision record
  await prov
    .from('employee_provisions')
    .upsert({
      tenant_id: tenantId,
      employee_id: line.provisioning_requests.employee_id,
      catalog_item_id: line.catalog_item_id,
      asset_id: line.asset_id,
      qty: line.qty,
      status: 'active',
      provisioning_line_id: lineId,
      last_event_id: `emp-prov-${idempotencyKey}`,
    }, { onConflict: 'last_event_id' });

  await recordHistory(prov, tenantId, requestId, lineId, 'line_issued', oldStatus, 'issued', 'user', {
    issued_by: userId,
  });

  events.push({
    event_name: 'provision_line.issued',
    payload: { line_id: lineId, request_id: requestId },
    last_event_id: idempotencyKey,
  });

  // Check if all lines are now issued/cancelled/failed — if so, update request status
  const { data: remainingLines } = await prov
    .from('provisioning_lines')
    .select('status')
    .eq('request_id', requestId)
    .limit(200);

  if (remainingLines) {
    const allTerminal = remainingLines.every(
      (l: any) => ['issued', 'cancelled', 'failed', 'substituted'].includes(l.status),
    );
    const hasIssued = remainingLines.some((l: any) => l.status === 'issued');

    if (allTerminal && hasIssued) {
      await prov
        .from('provisioning_requests')
        .update({ status: 'fulfilled' })
        .eq('id', requestId);

      events.push({
        event_name: 'provision_request.fulfilled',
        payload: { request_id: requestId },
        last_event_id: `req-fulfilled-${requestId}`,
      });
    }
  }

  return { events };
}
