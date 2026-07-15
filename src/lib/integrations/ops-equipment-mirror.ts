/**
 * Operations equipment-hold mirror — pure mapping from Operations
 * equipment.* event payloads to rpc_inv_apply_ops_equipment_hold calls.
 * The webhook route (/api/webhooks/operations-events) stays thin; this
 * decides, tests cover it.
 *
 * Ops hold lifecycle → mirror op:
 *   equipment.requested status reserved|confirmed → upsert (active reservation)
 *   equipment.requested status requested          → release (soft ask, holds nothing)
 *   equipment.released                            → release
 *
 * The mirror row on the inventory side is keyed
 * last_event_id = 'ops-hold:<assignment_id>' (built inside the RPC).
 */

/** Ops hold statuses that actually hold the asset (mirror-worthy). */
const BLOCKING_HOLD_STATUSES = new Set(['reserved', 'confirmed']);

export interface OpsHoldRpcArgs {
  p_op: 'upsert' | 'release';
  p_assignment_id: string;
  p_fleet_asset_id: string | null;
  p_job_id: string | null;
  p_job_name: string | null;
  p_reserved_from: string | null;
  p_reserved_until: string | null;
}

export type OpsEquipmentEventAction =
  | { action: 'skip'; reason: 'unhandled_event' | 'no_assignment_id' }
  | { action: 'apply'; args: OpsHoldRpcArgs };

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Decide what an Operations equipment event does to the reservation mirror.
 * A reserve event for a by-class request (no fleet_asset_id) or a downgrade
 * to 'requested' releases any existing mirror row — the RPC no-ops when
 * there's nothing to release, so this stays idempotent and echo-free.
 */
export function mapOpsEquipmentEvent(eventType: string, p: Record<string, unknown>): OpsEquipmentEventAction {
  if (eventType !== 'equipment.requested' && eventType !== 'equipment.released') {
    return { action: 'skip', reason: 'unhandled_event' };
  }

  const assignmentId = str(p.assignment_id);
  if (!assignmentId) return { action: 'skip', reason: 'no_assignment_id' };

  const fleetAssetId = str(p.fleet_asset_id);
  const holds = eventType === 'equipment.requested'
    && BLOCKING_HOLD_STATUSES.has(String(p.status ?? ''))
    && fleetAssetId != null;

  return {
    action: 'apply',
    args: {
      p_op: holds ? 'upsert' : 'release',
      p_assignment_id: assignmentId,
      p_fleet_asset_id: fleetAssetId,
      p_job_id: str(p.job_id),
      p_job_name: str(p.job_name),
      p_reserved_from: str(p.planned_start),
      p_reserved_until: str(p.planned_end),
    },
  };
}
