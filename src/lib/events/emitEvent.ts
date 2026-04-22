/**
 * emitEvent — thin TypeScript wrapper around public.emit_event() SQL function.
 *
 * Use this when a TypeScript mutation needs to explicitly emit an outbox event
 * (i.e. the table does NOT already have a trigger that emits for the operation).
 *
 * Most tables already have INSERT/UPDATE triggers that call emit_event automatically.
 * This helper is for edge cases like manual soft deletes or batch operations.
 */

import { createBrowserAuthedClient } from '@/supabase/client';
import { AppError } from '@rocketmanv9/chassis/errors';

export interface EmitEventParams {
  /** Event type key, e.g. 'supply_chain.vendor_item.deleted' */
  event_type: string;
  /** JSONB payload */
  payload: Record<string, unknown>;
  /** Tenant UUID — required for multi-tenant isolation */
  tenant_id: string;
  /** Optional actor user UUID for audit trail */
  actor_id?: string;
  /** Optional correlation UUID for request tracing */
  correlation_id?: string;
  /** Optional aggregate UUID for the affected entity */
  aggregate_id?: string;
}

export interface EmitEventResult {
  outbox_id: string;
}

/**
 * Emit an event to the events_outbox via the public.emit_event() SQL function.
 *
 * Returns the outbox row id. Throws on failure.
 */
export async function emitEvent(params: EmitEventParams): Promise<EmitEventResult> {
  const supabase = createBrowserAuthedClient();

  const { data, error } = await supabase.rpc('emit_event', {
    p_type: params.event_type,
    p_payload: params.payload,
    p_tenant_id: params.tenant_id,
    p_actor_id: params.actor_id ?? null,
    p_correlation_id: params.correlation_id ?? null,
    p_aggregate_id: params.aggregate_id ?? null,
  });

  if (error) {
    throw AppError.internal(`Failed to emit event '${params.event_type}': ${error.message}`);
  }

  return { outbox_id: data as string };
}
