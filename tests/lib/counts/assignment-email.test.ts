import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for notifyCountAssignment — specifically the task creation / reassignment
 * and the self-assignment notify/email rules added for the mobile push pipeline.
 */

// ── Module mocks ─────────────────────────────────────────────────────────────
const insertNotification = vi.fn().mockResolvedValue(undefined);
const sendEmail = vi.fn().mockResolvedValue(undefined);
let emailConfigured = false;

vi.mock('@/lib/notifications', () => ({
  insertNotification: (...args: any[]) => insertNotification(...args),
}));
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: any[]) => sendEmail(...args),
  isEmailConfigured: () => emailConfigured,
}));

import { notifyCountAssignment } from '@/lib/counts/assignment-email';

// ── Supabase stub ────────────────────────────────────────────────────────────
// Supports the two access patterns the helper uses:
//   tasks: .select().eq().eq().maybeSingle()  /  .upsert()  /  .update().eq().eq()
//   local_users (email lookup): .select().eq().in().limit()
function createSupabase(opts: { existingTask?: any; users?: any[] } = {}) {
  const calls = { upsert: [] as any[], update: [] as any[] };
  const tasksBuilder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: opts.existingTask ?? null, error: null }),
    upsert: vi.fn().mockImplementation((row: any) => { calls.upsert.push(row); return Promise.resolve({ error: null }); }),
    update: vi.fn().mockImplementation((patch: any) => {
      calls.update.push(patch);
      return { eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) };
    }),
  };
  const usersBuilder: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: opts.users ?? [], error: null }),
  };
  return {
    _calls: calls,
    from: vi.fn().mockImplementation((t: string) => (t === 'tasks' ? tasksBuilder : usersBuilder)),
  };
}

const log = { info: vi.fn(), warn: vi.fn() };
const baseCount = { templateName: 'Count CC-1', locationName: 'Yard', countType: 'spot_check', countNumber: 'CC-1', cycleCountId: 'cc-1' };

describe('notifyCountAssignment', () => {
  beforeEach(() => { emailConfigured = false; });
  afterEach(() => vi.clearAllMocks());

  it('self-assign with alwaysNotify: creates task + notification, no email', async () => {
    const supabase = createSupabase();
    await notifyCountAssignment({
      fetchImpl: fetch, supabase, log,
      tenantId: 't1', assigneeUserId: 'u1', actorUserId: 'u1',
      alwaysNotify: true, counts: [baseCount],
    });
    expect(supabase._calls.upsert).toHaveLength(1);
    expect(supabase._calls.upsert[0]).toMatchObject({ assigned_to_user_id: 'u1', related_entity_id: 'cc-1', last_event_id: 'cycle_count_cc-1' });
    expect(insertNotification).toHaveBeenCalledTimes(1);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('self-assign without alwaysNotify: task only, no notification', async () => {
    const supabase = createSupabase();
    await notifyCountAssignment({
      fetchImpl: fetch, supabase, log,
      tenantId: 't1', assigneeUserId: 'u1', actorUserId: 'u1',
      counts: [baseCount],
    });
    expect(supabase._calls.upsert).toHaveLength(1);
    expect(insertNotification).not.toHaveBeenCalled();
  });

  it('assign to another user: task + notification + email when configured', async () => {
    emailConfigured = true;
    const supabase = createSupabase({ users: [{ user_id: 'u2', name: 'Pat', email: 'pat@x.com' }, { user_id: 'u1', name: 'Sam' }] });
    await notifyCountAssignment({
      fetchImpl: fetch, supabase, log,
      tenantId: 't1', assigneeUserId: 'u2', actorUserId: 'u1',
      counts: [baseCount],
    });
    expect(supabase._calls.upsert[0]).toMatchObject({ assigned_to_user_id: 'u2' });
    expect(insertNotification).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);
  });

  it('reassignment (task already exists): updates assignee, does not insert', async () => {
    const supabase = createSupabase({ existingTask: { id: 'task-1', assigned_to_user_id: 'u1', status: 'open' } });
    await notifyCountAssignment({
      fetchImpl: fetch, supabase, log,
      tenantId: 't1', assigneeUserId: 'u2', actorUserId: 'u3', delegated: true,
      counts: [baseCount],
    });
    expect(supabase._calls.upsert).toHaveLength(0);
    expect(supabase._calls.update).toHaveLength(1);
    expect(supabase._calls.update[0]).toMatchObject({ assigned_to_user_id: 'u2' });
  });

  it('no cycleCountId (schedule entry): notification only, no task', async () => {
    const supabase = createSupabase();
    await notifyCountAssignment({
      fetchImpl: fetch, supabase, log,
      tenantId: 't1', assigneeUserId: 'u2', actorUserId: 'u1',
      counts: [{ templateName: 'Weekly count', scheduledDate: '2026-07-01' }],
    });
    expect(supabase._calls.upsert).toHaveLength(0);
    expect(supabase._calls.update).toHaveLength(0);
    expect(insertNotification).toHaveBeenCalledTimes(1);
  });
});
