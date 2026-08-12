/**
 * Operations material-need mirror — pure mapping from Operations material.*
 * event payloads to rpc_inv_apply_ops_material_hold calls. Quantity twin of
 * ops-equipment-mirror.ts; the webhook route stays thin, tests cover this.
 *
 * Ops need lifecycle → mirror op:
 *   material.requested (inventory_item_id set, qty > 0) → upsert (active fungible reservation)
 *   material.requested (unmapped / no qty)              → release (nothing holdable yet)
 *   material.released                                   → release
 *
 * The mirror row on the inventory side is keyed
 * last_event_id = 'ops-material:<need_id>' (built inside the RPC).
 */

export interface OpsMaterialRpcArgs {
  p_op: 'upsert' | 'release';
  p_need_id: string;
  p_catalog_item_id: string | null;
  p_qty: number | null;
  p_job_id: string | null;
  p_job_name: string | null;
  p_reserved_from: string | null;
  p_reserved_until: string | null;
}

export type OpsMaterialEventAction =
  | { action: 'skip'; reason: 'unhandled_event' | 'no_need_id' }
  | { action: 'apply'; args: OpsMaterialRpcArgs };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function mapOpsMaterialEvent(eventType: string, p: Record<string, unknown>): OpsMaterialEventAction {
  if (eventType !== 'material.requested' && eventType !== 'material.released') {
    return { action: 'skip', reason: 'unhandled_event' };
  }

  const needId = str(p.need_id);
  if (!needId) return { action: 'skip', reason: 'no_need_id' };

  const itemId = str(p.inventory_item_id);
  const qty = num(p.quantity);
  const holds = eventType === 'material.requested' && itemId != null && qty != null && qty > 0;

  return {
    action: 'apply',
    args: {
      p_op: holds ? 'upsert' : 'release',
      p_need_id: needId,
      p_catalog_item_id: itemId,
      p_qty: qty,
      p_job_id: str(p.job_id),
      p_job_name: str(p.job_name),
      p_reserved_from: str(p.planned_start),
      p_reserved_until: str(p.planned_end),
    },
  };
}
