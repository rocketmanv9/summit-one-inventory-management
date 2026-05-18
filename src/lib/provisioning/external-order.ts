/**
 * External Order Execution with Dedup
 *
 * Handles safe external order placement with deduplication and retry tracking.
 * If a line already has an external_order_id, the call is a no-op.
 * On failure, increments submit_attempt_count and marks as failed after 3 attempts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getProvider } from './providers/registry';
import type { ProviderType, ShippingAddress } from './providers/types';
import type { ProvisioningEvent } from './orchestrator';

// Ensure printify provider is registered
import './providers/printify';

export interface ExternalOrderContext {
  tenantId: string;
  requestId: string;
  line: {
    id: string;
    catalog_item_id: string;
    qty: number;
    fulfillment_method: string;
    provider_id: string;
    external_order_id: string | null;
    submit_attempt_count: number;
    resolved_variant_attributes?: Record<string, string> | null;
  };
  shippingAddress?: ShippingAddress;
  idempotencyKey: string;
}

/**
 * Execute an external order for a provisioning line with dedup.
 *
 * 1. If line.external_order_id is already set, return no-op (already submitted).
 * 2. Compute payload_hash, increment submit_attempt_count, set submitted_at.
 * 3. Load provider record + provider_item_mappings for the line's catalog_item_id.
 * 4. Call provider.placeOrder().
 * 5. On success: set external_order_id, status -> ordered, emit event.
 * 6. On failure: if submit_attempt_count >= 3, status -> failed.
 */
export async function executeExternalOrder(
  supabase: SupabaseClient,
  ctx: ExternalOrderContext,
): Promise<{ success: boolean; events: ProvisioningEvent[] }> {
  const prov = (supabase as any).schema('provisioning');
  const events: ProvisioningEvent[] = [];

  // 1. Dedup: already submitted
  if (ctx.line.external_order_id) {
    return { success: true, events: [] };
  }

  // 2. Increment attempt count and compute payload hash
  const attemptCount = ctx.line.submit_attempt_count + 1;
  const payloadHash = simpleHash(
    JSON.stringify({
      line_id: ctx.line.id,
      catalog_item_id: ctx.line.catalog_item_id,
      qty: ctx.line.qty,
      provider_id: ctx.line.provider_id,
    }),
  );

  await prov
    .from('provisioning_lines')
    .update({
      submit_attempt_count: attemptCount,
      submitted_at: new Date().toISOString(),
      payload_hash: payloadHash,
    })
    .eq('id', ctx.line.id);

  // 3. Load provider record (type + config)
  const { data: providerRecord, error: provErr } = await prov
    .from('providers')
    .select('id, provider_type, config')
    .eq('id', ctx.line.provider_id)
    .limit(1)
    .single();

  if (provErr || !providerRecord) {
    throw AppError.notFound(`Provider not found: ${ctx.line.provider_id}`);
  }

  // Load provider_item_mappings for external product/variant IDs
  const { data: mappings } = await prov
    .from('provider_item_mappings')
    .select('external_product_id, external_variant_id')
    .eq('provider_id', ctx.line.provider_id)
    .eq('catalog_item_id', ctx.line.catalog_item_id)
    .limit(1)
    .single();

  const externalProductId = mappings?.external_product_id ?? '';
  const externalVariantId = mappings?.external_variant_id ?? '';

  // 4. Resolve provider and place order
  const providerType = providerRecord.provider_type as ProviderType;
  const provider = getProvider(providerType);

  if (!provider) {
    throw AppError.internal(`No registered provider for type: ${providerType}`);
  }

  try {
    const orderResult = await provider.placeOrder(
      {
        tenantId: ctx.tenantId,
        requestId: ctx.requestId,
        idempotencyKey: ctx.idempotencyKey,
        shippingAddress: ctx.shippingAddress,
        items: [
          {
            lineId: ctx.line.id,
            catalogItemId: ctx.line.catalog_item_id,
            externalProductId,
            externalVariantId,
            qty: ctx.line.qty,
          },
        ],
      },
      providerRecord.config ?? {},
    );

    if (orderResult.success) {
      // 5. Success: update line with external order ID
      await prov
        .from('provisioning_lines')
        .update({
          status: 'ordered',
          external_order_id: orderResult.externalOrderId ?? null,
          last_event_id: ctx.idempotencyKey,
        })
        .eq('id', ctx.line.id);

      events.push({
        event_name: 'provision_line.ordered',
        payload: {
          line_id: ctx.line.id,
          request_id: ctx.requestId,
          external_order_id: orderResult.externalOrderId,
        },
        last_event_id: ctx.idempotencyKey,
      });

      return { success: true, events };
    }

    // 6. Failure path
    if (attemptCount >= 3) {
      await prov
        .from('provisioning_lines')
        .update({
          status: 'failed',
          last_event_id: ctx.idempotencyKey,
        })
        .eq('id', ctx.line.id);

      events.push({
        event_name: 'provision_line.failed',
        payload: {
          line_id: ctx.line.id,
          request_id: ctx.requestId,
          error: orderResult.error,
          attempts: attemptCount,
        },
        last_event_id: ctx.idempotencyKey,
      });
    }

    return { success: false, events };
  } catch (err: any) {
    // Unexpected error during placeOrder
    if (attemptCount >= 3) {
      await prov
        .from('provisioning_lines')
        .update({
          status: 'failed',
          last_event_id: ctx.idempotencyKey,
        })
        .eq('id', ctx.line.id);

      events.push({
        event_name: 'provision_line.failed',
        payload: {
          line_id: ctx.line.id,
          request_id: ctx.requestId,
          error: err.message,
          attempts: attemptCount,
        },
        last_event_id: ctx.idempotencyKey,
      });
    }

    return { success: false, events };
  }
}

/**
 * Simple string hash for payload dedup tracking.
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}
