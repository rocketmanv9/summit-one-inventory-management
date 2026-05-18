import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'log').mockImplementation(() => {});

import {
  createNotification,
  getNotifications,
  getUnreadCount,
  markRead,
  markAllRead,
} from '../../src/lib/provisioning/notifications';

function createMockSupabase(overrides: Record<string, any> = {}) {
  const chainable: any = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  return { schema: vi.fn().mockReturnValue(chainable), _chainable: chainable } as any;
}

describe('createNotification', () => {
  it('inserts and returns notification', async () => {
    const notif = { id: 'n1', title: 'Test', severity: 'info' };
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({ data: notif, error: null }),
    });
    const result = await createNotification(sb, 'tenant1', {
      notificationType: 'request.created',
      title: 'Test',
    }, 'evt-1');
    expect(result).toEqual(notif);
    expect(sb._chainable.upsert).toHaveBeenCalled();
  });

  it('applies default severity and recipient_role', async () => {
    const sb = createMockSupabase({
      single: vi.fn().mockResolvedValue({ data: { id: 'n1' }, error: null }),
    });
    await createNotification(sb, 'tenant1', {
      notificationType: 'request.created',
      title: 'Test',
    }, 'evt-1');
    const upsertCall = sb._chainable.upsert.mock.calls[0][0];
    expect(upsertCall.severity).toBe('info');
    expect(upsertCall.recipient_role).toBe('all');
  });
});

describe('getNotifications', () => {
  it('returns notifications ordered by date', async () => {
    const notifs = [{ id: 'n1' }, { id: 'n2' }];
    const sb = createMockSupabase();
    sb._chainable.limit = vi.fn().mockResolvedValue({ data: notifs, error: null });
    const result = await getNotifications(sb, 'tenant1');
    expect(result).toEqual(notifs);
  });

  it('filters unread when unreadOnly is true', async () => {
    // The code builds a query, optionally chains .eq, then awaits.
    // .limit() must return a thenable that also has .eq()
    const eqCalls: any[] = [];
    const chainable: any = {};
    chainable.from = vi.fn(() => chainable);
    chainable.select = vi.fn(() => chainable);
    chainable.order = vi.fn(() => chainable);
    chainable.limit = vi.fn(() => chainable);
    chainable.eq = vi.fn((...args: any[]) => { eqCalls.push(args); return chainable; });
    chainable.then = vi.fn((resolve: any) => resolve({ data: [], error: null }));
    const sb = { schema: vi.fn().mockReturnValue(chainable) } as any;
    await getNotifications(sb, 'tenant1', { unreadOnly: true });
    expect(eqCalls.some(c => c[0] === 'is_read' && c[1] === false)).toBe(true);
  });
});

describe('getUnreadCount', () => {
  it('returns count of unread notifications', async () => {
    const sb = createMockSupabase();
    sb._chainable.eq = vi.fn().mockReturnThis();
    // Override the last .eq() call to return count
    const originalEq = sb._chainable.eq;
    let eqCallCount = 0;
    sb._chainable.eq = vi.fn((...args: any[]) => {
      eqCallCount++;
      if (eqCallCount >= 2) {
        return Promise.resolve({ count: 5, error: null });
      }
      return sb._chainable;
    });
    sb._chainable.select = vi.fn().mockReturnValue(sb._chainable);
    const result = await getUnreadCount(sb, 'tenant1');
    expect(result).toBe(5);
  });
});

describe('markRead', () => {
  it('updates notification is_read to true', async () => {
    const sb = createMockSupabase();
    sb._chainable.eq = vi.fn().mockReturnThis();
    // Last eq returns the update result
    let eqCount = 0;
    sb._chainable.eq = vi.fn(() => {
      eqCount++;
      if (eqCount >= 2) return Promise.resolve({ error: null });
      return sb._chainable;
    });
    await markRead(sb, 'tenant1', 'n1');
    expect(sb._chainable.update).toHaveBeenCalled();
  });
});

describe('markAllRead', () => {
  it('updates all unread notifications', async () => {
    const sb = createMockSupabase();
    sb._chainable.eq = vi.fn().mockReturnThis();
    let eqCount = 0;
    sb._chainable.eq = vi.fn(() => {
      eqCount++;
      if (eqCount >= 2) return Promise.resolve({ error: null });
      return sb._chainable;
    });
    await markAllRead(sb, 'tenant1');
    expect(sb._chainable.update).toHaveBeenCalled();
  });
});
