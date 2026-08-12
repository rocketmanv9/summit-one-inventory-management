import { describe, expect, it } from 'vitest';
import { mapOpsMaterialEvent } from '@/lib/integrations/ops-material-mirror';

const base = {
  need_id: 'need-1',
  job_id: 'job-1',
  job_name: 'Wednesday Paving',
  inventory_item_id: 'item-1',
  quantity: 14,
  planned_start: '2026-08-05T07:00:00Z',
  planned_end: '2026-08-05T17:00:00Z',
};

describe('mapOpsMaterialEvent', () => {
  it('mapped need with qty upserts a hold with the job window', () => {
    const d = mapOpsMaterialEvent('material.requested', base);
    expect(d).toEqual({
      action: 'apply',
      args: {
        p_op: 'upsert',
        p_need_id: 'need-1',
        p_catalog_item_id: 'item-1',
        p_qty: 14,
        p_job_id: 'job-1',
        p_job_name: 'Wednesday Paving',
        p_reserved_from: '2026-08-05T07:00:00Z',
        p_reserved_until: '2026-08-05T17:00:00Z',
      },
    });
  });

  it('numeric strings (PostgREST numerics) coerce', () => {
    const d = mapOpsMaterialEvent('material.requested', { ...base, quantity: '14.5000' });
    expect(d.action).toBe('apply');
    if (d.action === 'apply') expect(d.args.p_qty).toBe(14.5);
  });

  it('unmapped or qty-less needs release instead of holding', () => {
    const unmapped = mapOpsMaterialEvent('material.requested', { ...base, inventory_item_id: null });
    expect(unmapped.action === 'apply' && unmapped.args.p_op).toBe('release');
    const noQty = mapOpsMaterialEvent('material.requested', { ...base, quantity: 0 });
    expect(noQty.action === 'apply' && noQty.args.p_op).toBe('release');
  });

  it('material.released releases; other events and missing need_id skip', () => {
    const released = mapOpsMaterialEvent('material.released', { need_id: 'need-1' });
    expect(released.action === 'apply' && released.args.p_op).toBe('release');
    expect(mapOpsMaterialEvent('equipment.requested', base)).toEqual({ action: 'skip', reason: 'unhandled_event' });
    expect(mapOpsMaterialEvent('material.requested', { ...base, need_id: undefined })).toEqual({ action: 'skip', reason: 'no_need_id' });
  });
});
