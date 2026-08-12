import { describe, it, expect } from 'vitest';
import { mapOpsEquipmentEvent } from '@/lib/integrations/ops-equipment-mirror';

const BASE = {
  job_id: 'job-1',
  assignment_id: 'assign-1',
  job_name: 'Maple Ave Repave',
  tenant_id: 'tenant-1',
  fleet_asset_id: 'fleet-1',
  gv_equipment_class_id: null as unknown,
  quantity: 1,
  status: 'reserved',
  planned_start: '2026-07-18T07:00:00Z',
  planned_end: '2026-07-20T17:00:00Z',
};

describe('mapOpsEquipmentEvent (ops equipment holds → reservation mirror)', () => {
  it('reserved/confirmed holds with a fleet asset upsert an active mirror reservation', () => {
    for (const status of ['reserved', 'confirmed']) {
      const a = mapOpsEquipmentEvent('equipment.requested', { ...BASE, status });
      expect(a).toEqual({
        action: 'apply',
        args: {
          p_op: 'upsert',
          p_assignment_id: 'assign-1',
          p_fleet_asset_id: 'fleet-1',
          p_job_id: 'job-1',
          p_job_name: 'Maple Ave Repave',
          p_reserved_from: '2026-07-18T07:00:00Z',
          p_reserved_until: '2026-07-20T17:00:00Z',
        },
      });
    }
  });

  it('soft "requested" holds release the mirror (they hold nothing)', () => {
    const a = mapOpsEquipmentEvent('equipment.requested', { ...BASE, status: 'requested' });
    expect(a.action).toBe('apply');
    if (a.action === 'apply') expect(a.args.p_op).toBe('release');
  });

  it('by-class requests (no fleet_asset_id) release any stale mirror instead of upserting', () => {
    const a = mapOpsEquipmentEvent('equipment.requested', { ...BASE, fleet_asset_id: null, gv_equipment_class_id: 'class-1' });
    expect(a.action).toBe('apply');
    if (a.action === 'apply') {
      expect(a.args.p_op).toBe('release');
      expect(a.args.p_fleet_asset_id).toBeNull();
    }
  });

  it('equipment.released releases the mirror by assignment id', () => {
    const a = mapOpsEquipmentEvent('equipment.released', {
      job_id: 'job-1', assignment_id: 'assign-1', fleet_asset_id: 'fleet-1',
    });
    expect(a).toEqual({
      action: 'apply',
      args: {
        p_op: 'release',
        p_assignment_id: 'assign-1',
        p_fleet_asset_id: 'fleet-1',
        p_job_id: 'job-1',
        p_job_name: null,
        p_reserved_from: null,
        p_reserved_until: null,
      },
    });
  });

  it('tolerates undated hold windows (nulls ride through to the RPC)', () => {
    const a = mapOpsEquipmentEvent('equipment.requested', { ...BASE, planned_start: null, planned_end: null });
    expect(a.action).toBe('apply');
    if (a.action === 'apply') {
      expect(a.args.p_op).toBe('upsert');
      expect(a.args.p_reserved_from).toBeNull();
      expect(a.args.p_reserved_until).toBeNull();
    }
  });

  it('skips unhandled events and payloads without an assignment id', () => {
    expect(mapOpsEquipmentEvent('equipment.driver_assigned', { ...BASE }))
      .toEqual({ action: 'skip', reason: 'unhandled_event' });
    expect(mapOpsEquipmentEvent('equipment.requested', { ...BASE, assignment_id: undefined }))
      .toEqual({ action: 'skip', reason: 'no_assignment_id' });
  });
});
