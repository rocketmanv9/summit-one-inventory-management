import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Unit tests for the nightly cycle-count materializer
 * (src/lib/counts/materialize-counts.ts).
 *
 * The admin Supabase client is stubbed with a thenable query builder so we
 * can script per-table responses. Email sending is mocked at the module
 * boundary.
 */

const sendEmailMock = vi.fn().mockResolvedValue({ id: 'email-1' });
const isEmailConfiguredMock = vi.fn().mockReturnValue(true);
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: any[]) => sendEmailMock(...args),
  isEmailConfigured: () => isEmailConfiguredMock(),
}));

const getAdminClientMock = vi.fn();
vi.mock('@/utils/supabase/admin', () => ({
  getAdminClient: () => getAdminClientMock(),
}));

import { materializeDueCounts } from '@/lib/counts/materialize-counts';

/** Thenable query builder: every chained call returns itself, awaiting it resolves the scripted response. */
function makeBuilder(response: { data?: any; error?: any }) {
  const builder: any = {};
  for (const m of ['select', 'update', 'eq', 'lte', 'order', 'limit', 'maybeSingle', 'single']) {
    builder[m] = vi.fn().mockReturnValue(builder);
  }
  builder.then = (resolve: any, reject: any) =>
    Promise.resolve({ data: response.data ?? null, error: response.error ?? null }).then(resolve, reject);
  return builder;
}

const TEMPLATE = {
  id: 'tmpl-1',
  name: 'Main Yard Quarterly',
  location_id: 'loc-1',
  count_type: 'partial',
  is_blind: false,
  catalog_item_ids: null,
  location: { name: 'Main Yard' },
};

function makeAdmin(opts: {
  dueEntries: any[];
  rpcResult?: { data?: any; error?: any };
  user?: any;
}) {
  const rpc = vi.fn().mockResolvedValue(opts.rpcResult ?? { data: 'count-1', error: null });
  // Responses keyed by table; cycle_count_schedule first serves the due-list
  // read, then entry updates (which resolve through the same builder).
  const fromImpl = (table: string) => {
    if (table === 'cycle_count_schedule') {
      const calls = fromCalls.filter(c => c === table).length;
      return calls === 1
        ? makeBuilder({ data: opts.dueEntries })
        : makeBuilder({ data: null });
    }
    if (table === 'cycle_counts') return makeBuilder({ data: { count_number: 'CC-0042' } });
    if (table === 'local_users') return makeBuilder({ data: opts.user ?? { name: 'Grant Anderson', email: 'grant@acmoate.com' } });
    return makeBuilder({ data: null });
  };
  const fromCalls: string[] = [];
  const schemaClient = {
    from: vi.fn().mockImplementation((table: string) => {
      fromCalls.push(table);
      return fromImpl(table);
    }),
    rpc,
  };
  const admin = {
    schema: vi.fn().mockReturnValue(schemaClient),
    from: vi.fn().mockImplementation((table: string) => fromImpl(table)),
    _rpc: rpc,
  };
  return admin;
}

const log = { info: vi.fn(), warn: vi.fn() };

describe('materializeDueCounts', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    sendEmailMock.mockClear().mockResolvedValue({ id: 'email-1' });
    isEmailConfiguredMock.mockReturnValue(true);
    log.info.mockClear();
    log.warn.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('materializes a due assigned entry and emails the assignee', async () => {
    const admin = makeAdmin({
      dueEntries: [{
        id: 'entry-1',
        tenant_id: 'tenant-1',
        scheduled_date: '2026-06-12',
        assigned_to_user_id: 'user-1',
        template: TEMPLATE,
      }],
    });
    getAdminClientMock.mockReturnValue(admin);

    const result = await materializeDueCounts({ fetchImpl: vi.fn() as any, log });

    expect(result.entriesDue).toBe(1);
    expect(result.countsCreated).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(result.emailsSent).toBe(1);

    // RPC called with the exact param set that selects the right overload.
    // 'partial' with no item scope maps to 'full' — the RPC rejects
    // scopeless partial counts (verified against stage).
    expect(admin._rpc).toHaveBeenCalledWith('rpc_inv_cycle_count_start', {
      p_tenant_id: 'tenant-1',
      p_location_id: 'loc-1',
      p_count_type: 'full',
      p_catalog_item_ids: null,
      p_counted_by_user_id: 'user-1',
      p_last_event_id: 'cron_count_entry-1',
    });

    const [, emailParams] = sendEmailMock.mock.calls[0];
    expect(emailParams.to).toBe('grant@acmoate.com');
    expect(emailParams.subject).toContain('ready to start');
  });

  it('keeps count_type partial when the template has an item scope', async () => {
    const admin = makeAdmin({
      dueEntries: [{
        id: 'entry-scoped',
        tenant_id: 'tenant-1',
        scheduled_date: '2026-06-12',
        assigned_to_user_id: null,
        template: { ...TEMPLATE, catalog_item_ids: ['item-1', 'item-2'] },
      }],
    });
    getAdminClientMock.mockReturnValue(admin);

    await materializeDueCounts({ fetchImpl: vi.fn() as any, log });

    expect(admin._rpc).toHaveBeenCalledWith('rpc_inv_cycle_count_start', expect.objectContaining({
      p_count_type: 'partial',
      p_catalog_item_ids: ['item-1', 'item-2'],
    }));
  });

  it('skips the email for unassigned entries but still creates the count', async () => {
    const admin = makeAdmin({
      dueEntries: [{
        id: 'entry-2',
        tenant_id: 'tenant-1',
        scheduled_date: '2026-06-10',
        assigned_to_user_id: null,
        template: TEMPLATE,
      }],
    });
    getAdminClientMock.mockReturnValue(admin);

    const result = await materializeDueCounts({ fetchImpl: vi.fn() as any, log });

    expect(result.countsCreated).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsSkipped).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('isolates per-entry failures so one bad entry never aborts the rest', async () => {
    const admin = makeAdmin({
      dueEntries: [
        { id: 'entry-broken', tenant_id: 'tenant-1', scheduled_date: '2026-06-11', assigned_to_user_id: null, template: null },
        { id: 'entry-good', tenant_id: 'tenant-1', scheduled_date: '2026-06-12', assigned_to_user_id: null, template: TEMPLATE },
      ],
    });
    getAdminClientMock.mockReturnValue(admin);

    const result = await materializeDueCounts({ fetchImpl: vi.fn() as any, log });

    expect(result.entriesDue).toBe(2);
    expect(result.countsCreated).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].entryId).toBe('entry-broken');
  });

  it('records an error when the RPC fails', async () => {
    const admin = makeAdmin({
      dueEntries: [{
        id: 'entry-3',
        tenant_id: 'tenant-1',
        scheduled_date: '2026-06-12',
        assigned_to_user_id: 'user-1',
        template: TEMPLATE,
      }],
      rpcResult: { data: null, error: { message: 'function does not exist' } },
    });
    getAdminClientMock.mockReturnValue(admin);

    const result = await materializeDueCounts({ fetchImpl: vi.fn() as any, log });

    expect(result.countsCreated).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error).toContain('function does not exist');
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('skips emails entirely when Resend is not configured', async () => {
    isEmailConfiguredMock.mockReturnValue(false);
    const admin = makeAdmin({
      dueEntries: [{
        id: 'entry-4',
        tenant_id: 'tenant-1',
        scheduled_date: '2026-06-12',
        assigned_to_user_id: 'user-1',
        template: TEMPLATE,
      }],
    });
    getAdminClientMock.mockReturnValue(admin);

    const result = await materializeDueCounts({ fetchImpl: vi.fn() as any, log });

    expect(result.countsCreated).toBe(1);
    expect(result.emailsSent).toBe(0);
    expect(result.emailsSkipped).toBe(1);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
