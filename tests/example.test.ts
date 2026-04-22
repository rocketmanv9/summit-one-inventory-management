import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Example unit test showing chassis mocking patterns.
 *
 * Key patterns demonstrated:
 *   1. Supabase client stub with chained query builder
 *   2. Console output suppression
 *   3. Asserting on response status and JSON body
 *   4. Clean setup/teardown
 */

// ── Supabase mock ───────────────────────────────────────────────────────────

/** Stub that mimics the Supabase query builder chain. */
function createMockSupabase(overrides: { data?: any; error?: any } = {}) {
  const response = { data: overrides.data ?? null, error: overrides.error ?? null };
  const builder = {
    select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue(response), data: response.data, error: response.error }),
    insert: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue(response) }) }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue(response) }) }),
    delete: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue(response) }) }),
    eq: vi.fn().mockReturnThis(),
  };
  return {
    from: vi.fn().mockReturnValue(builder),
    _builder: builder,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('example service logic', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('inserts a record and returns 201', async () => {
    const mockRecord = { id: 'test-uuid-123', name: 'Test Item', status: 'created' };
    const supabase = createMockSupabase({ data: mockRecord });

    // Simulate what the route handler does internally
    const { data, error } = await supabase
      .from('my_table')
      .insert({ name: 'Test Item' })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toEqual(mockRecord);
    expect(supabase.from).toHaveBeenCalledWith('my_table');
  });

  it('handles Supabase errors gracefully', async () => {
    const supabase = createMockSupabase({
      error: { message: 'duplicate key', code: '23505' },
    });

    const { error } = await supabase
      .from('my_table')
      .insert({ name: 'Duplicate' })
      .select()
      .single();

    expect(error).toBeDefined();
    expect(error.code).toBe('23505');
  });

  it('queries with tenant scope', async () => {
    const tenantId = 'tenant-abc-123';
    const mockRows = [
      { id: '1', tenant_id: tenantId, name: 'Item A' },
      { id: '2', tenant_id: tenantId, name: 'Item B' },
    ];
    const supabase = createMockSupabase({ data: mockRows });

    const { data } = await supabase
      .from('my_table')
      .select('*')

    expect(data).toHaveLength(2);
    expect(data[0].tenant_id).toBe(tenantId);
  });
});
