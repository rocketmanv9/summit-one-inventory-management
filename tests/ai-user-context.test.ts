/**
 * getAiUserContext / formatUserContextForPrompt tests
 * Verifies Isabelle's who-am-I-talking-to block: mirror lookups, ALL-CAPS HR
 * name cleanup, graceful degradation, and the 5-minute cache.
 */

import { describe, it, expect, vi } from 'vitest';
import { getAiUserContext, formatUserContextForPrompt } from '../src/lib/ai/user-context';

// Minimal chainable stub: .from(table).select().eq().eq().maybeSingle()
function stubSupabase(rows: Record<string, any>) {
  return {
    from: vi.fn((table: string) => {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: rows[table] ?? null }),
      };
      return chain;
    }),
  };
}

describe('getAiUserContext', () => {
  it('resolves name, position, and role from the mirrors (and fixes SHOUTY HR names)', async () => {
    const supabase = stubSupabase({
      local_users: {
        name: 'Grant Anderson',
        email: 'grant@acmoate.com',
        role: 'admin',
        spending_limit: null,
        position_id: 'pos-1',
        hr_person_id: 'hr-1',
      },
      positions: { title: 'General Manager', name: 'General Manager', role_level: 'Manager' },
      hr_people: { first_name: 'GRANT', preferred_name: 'GRANT', last_name: 'ANDERSON' },
    });

    const ctx = await getAiUserContext(supabase, 'user-ctx-1', 'tenant-ctx-1');
    expect(ctx).toMatchObject({
      name: 'Grant Anderson',
      firstName: 'Grant',
      email: 'grant@acmoate.com',
      role: 'admin',
      positionTitle: 'General Manager',
      roleLevel: 'Manager',
    });
  });

  it('degrades to null when the user row is missing', async () => {
    const ctx = await getAiUserContext(stubSupabase({}), 'user-ctx-2', 'tenant-ctx-2');
    expect(ctx).toBeNull();
  });

  it('caches per user — second call skips the DB', async () => {
    const supabase = stubSupabase({
      local_users: { name: 'Tyler Harris', email: 't@x.com', role: 'authenticated', position_id: null, hr_person_id: null },
    });
    await getAiUserContext(supabase, 'user-ctx-3', 'tenant-ctx-3');
    const callsAfterFirst = supabase.from.mock.calls.length;
    await getAiUserContext(supabase, 'user-ctx-3', 'tenant-ctx-3');
    expect(supabase.from.mock.calls.length).toBe(callsAfterFirst);
  });
});

describe('formatUserContextForPrompt', () => {
  it('renders the identity block', () => {
    const block = formatUserContextForPrompt({
      name: 'Grant Anderson',
      firstName: 'Grant',
      email: 'grant@acmoate.com',
      role: 'admin',
      positionTitle: 'General Manager',
      roleLevel: 'Manager',
      spendingLimit: null,
    });
    expect(block).toContain('WHO YOU ARE TALKING TO');
    expect(block).toContain('Grant Anderson');
    expect(block).toContain('General Manager (Manager level)');
    expect(block).toContain('App role: admin');
    expect(block).not.toContain('spending limit');
  });

  it('returns empty for null/anonymous context', () => {
    expect(formatUserContextForPrompt(null)).toBe('');
    expect(formatUserContextForPrompt({
      name: null, firstName: null, email: null, role: 'member',
      positionTitle: null, roleLevel: null, spendingLimit: null,
    })).toBe('');
  });
});
