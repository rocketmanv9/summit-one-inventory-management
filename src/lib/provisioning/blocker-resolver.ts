/**
 * Blocker Resolver
 *
 * Resolves blocking states on provisioning requests by re-checking
 * whether the blocking condition has been addressed. After resolution,
 * re-runs blocking checks and advances the request status.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@rocketmanv9/chassis/errors';

export interface BlockingReason {
  type: 'missing_mapping' | 'missing_address' | 'missing_sizing';
  lineId?: string;
  catalogItemId?: string;
  needed?: string;
}

export interface ResolveResult {
  resolved: boolean;
  newStatus: string;
  remainingBlockers: BlockingReason[];
  events: Array<{
    event_name: string;
    payload: Record<string, unknown>;
    last_event_id: string;
  }>;
}

/**
 * Re-check all blocking conditions on a request after an admin resolves one.
 * Returns any remaining blockers.
 */
async function recheckBlockers(
  supabase: SupabaseClient,
  tenantId: string,
  requestId: string,
): Promise<BlockingReason[]> {
  const prov = (supabase as any).schema('provisioning');
  const remaining: BlockingReason[] = [];

  // Load request + lines
  const { data: request } = await prov
    .from('provisioning_requests')
    .select('*, provisioning_lines(*)')
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .single();

  if (!request) throw AppError.notFound('Request not found');

  const lines = request.provisioning_lines ?? [];

  for (const line of lines) {
    if (line.status === 'cancelled' || line.status === 'failed') continue;

    // Check mapping: external_order lines need product + variant IDs
    if (line.fulfillment_method === 'external_order') {
      // Look up current mapping
      if (line.provider_id) {
        const { data: mapping } = await prov
          .from('provider_item_mappings')
          .select('external_product_id, external_variant_id')
          .eq('provider_id', line.provider_id)
          .eq('catalog_item_id', line.catalog_item_id)
          .eq('tenant_id', tenantId)
          .limit(1)
          .single();

        if (!mapping?.external_product_id || !mapping?.external_variant_id) {
          remaining.push({
            type: 'missing_mapping',
            lineId: line.id,
            catalogItemId: line.catalog_item_id,
          });
        }
      }
    }

    // Check sizing: lines that had variant resolution failure
    if (line.substitution_reason === 'Variant resolution failed; manual selection required') {
      remaining.push({
        type: 'missing_sizing',
        lineId: line.id,
        catalogItemId: line.original_catalog_item_id || line.catalog_item_id,
      });
    }
  }

  // Check address: any external_order lines need a shipping address
  const hasExternalOrders = lines.some(
    (l: any) => l.fulfillment_method === 'external_order' &&
      l.status !== 'cancelled' && l.status !== 'failed',
  );
  if (hasExternalOrders && !request.shipping_address) {
    remaining.push({ type: 'missing_address' });
  }

  return remaining;
}

/**
 * Determine the blocking status from a list of blocking reasons.
 * Priority: needs_mapping > needs_address > needs_sizing
 */
function getBlockingStatus(reasons: BlockingReason[]): string {
  if (reasons.some((r) => r.type === 'missing_mapping')) return 'needs_mapping';
  if (reasons.some((r) => r.type === 'missing_address')) return 'needs_address';
  if (reasons.some((r) => r.type === 'missing_sizing')) return 'needs_sizing';
  return 'needs_approval';
}

/**
 * Resolve a blocker on a provisioning request.
 *
 * This does NOT fix the underlying data (e.g. adding a mapping) — the caller
 * does that first. This function re-checks conditions and advances status.
 */
export async function resolveBlocker(
  supabase: SupabaseClient,
  tenantId: string,
  requestId: string,
  idempotencyKey: string,
): Promise<ResolveResult> {
  const prov = (supabase as any).schema('provisioning');
  const events: ResolveResult['events'] = [];

  // Load current request
  const { data: request } = await prov
    .from('provisioning_requests')
    .select('status, employee_id')
    .eq('id', requestId)
    .eq('tenant_id', tenantId)
    .limit(1)
    .single();

  if (!request) throw AppError.notFound('Request not found');

  const blockedStatuses = ['needs_mapping', 'needs_address', 'needs_sizing'];
  if (!blockedStatuses.includes(request.status)) {
    throw AppError.badRequest(`Request is not in a blocked state (current: ${request.status})`);
  }

  const oldStatus = request.status;

  // Re-check all blockers
  const remaining = await recheckBlockers(supabase, tenantId, requestId);

  if (remaining.length > 0) {
    // Still blocked — update to the highest-priority blocking status
    const newStatus = getBlockingStatus(remaining);
    await prov
      .from('provisioning_requests')
      .update({
        status: newStatus,
        blocking_reasons: remaining,
        last_event_id: idempotencyKey,
      })
      .eq('id', requestId);

    // Record history
    await prov
      .from('provisioning_history')
      .insert({
        tenant_id: tenantId,
        request_id: requestId,
        line_id: null,
        action: 'blocker_recheck',
        old_status: oldStatus,
        new_status: newStatus,
        actor_system: 'blocker_resolver',
        details: { remaining_blockers: remaining.length },
      });

    return {
      resolved: false,
      newStatus,
      remainingBlockers: remaining,
      events: [],
    };
  }

  // All blockers resolved — determine next status
  // Check if approval is required (from the policy rule)
  const { data: fullRequest } = await prov
    .from('provisioning_requests')
    .select('policy_rule_id')
    .eq('id', requestId)
    .limit(1)
    .single();

  let newStatus = 'ready_to_order';
  if (fullRequest?.policy_rule_id) {
    const { data: rule } = await prov
      .from('policy_rules')
      .select('requires_approval')
      .eq('id', fullRequest.policy_rule_id)
      .limit(1)
      .single();

    if (rule?.requires_approval) {
      newStatus = 'needs_approval';
    }
  }

  // Update request
  await prov
    .from('provisioning_requests')
    .update({
      status: newStatus,
      blocking_reasons: [],
      resolved_at: new Date().toISOString(),
      last_event_id: idempotencyKey,
    })
    .eq('id', requestId);

  // Update any needs_mapping lines back to pending
  await prov
    .from('provisioning_lines')
    .update({ status: 'pending' })
    .eq('request_id', requestId)
    .eq('status', 'needs_mapping');

  // Record history
  await prov
    .from('provisioning_history')
    .insert({
      tenant_id: tenantId,
      request_id: requestId,
      line_id: null,
      action: 'blockers_resolved',
      old_status: oldStatus,
      new_status: newStatus,
      actor_system: 'blocker_resolver',
      details: {},
    });

  events.push({
    event_name: 'provision_request.unblocked',
    payload: {
      request_id: requestId,
      employee_id: request.employee_id,
      new_status: newStatus,
    },
    last_event_id: idempotencyKey,
  });

  return {
    resolved: true,
    newStatus,
    remainingBlockers: [],
    events,
  };
}
