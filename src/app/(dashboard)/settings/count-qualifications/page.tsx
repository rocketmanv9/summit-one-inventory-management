'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { apiWrite, authenticatedFetch } from '@/lib/api-client';
import { getStoredAccessToken, parseJwtPayload } from '@/lib/auth-token';

interface RosterUser {
  user_id: string;
  name: string | null;
  email: string | null;
  role: string;
  is_active: boolean;
  location_id: string | null;
  location_name: string | null;
  qualified: boolean;
  notes: string | null;
}

export default function CountQualificationsPage() {
  const [users, setUsers] = useState<RosterUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'qualified' | 'active'>('all');

  useEffect(() => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
  }, []);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authenticatedFetch('/api/inventory/count-qualified');
      const { data } = await res.json();
      setUsers(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const toggleQualified = async (user: RosterUser) => {
    setSavingUserId(user.user_id);
    setError('');
    try {
      const res = await apiWrite('/api/inventory/count-qualified', {
        method: 'POST',
        body: { user_id: user.user_id, active: !user.qualified },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : data.error?.message || 'Update failed');
        return;
      }
      setUsers(prev => prev.map(u =>
        u.user_id === user.user_id ? { ...u, qualified: !user.qualified } : u
      ));
    } catch (err: any) {
      setError(err.message || 'Update failed');
    } finally {
      setSavingUserId(null);
    }
  };

  const qualifiedCount = users.filter(u => u.qualified).length;

  // Location options come from the data itself, so new HR locations appear automatically.
  const locations = [...new Map(
    users.filter(u => u.location_id).map(u => [u.location_id!, u.location_name || 'Unknown'])
  ).entries()].sort((a, b) => a[1].localeCompare(b[1]));

  const q = search.trim().toLowerCase();
  const filtered = users.filter(u => {
    if (q && !(`${u.name ?? ''} ${u.email ?? ''}`.toLowerCase().includes(q))) return false;
    if (locationFilter === 'none' && u.location_id) return false;
    if (locationFilter && locationFilter !== 'none' && u.location_id !== locationFilter) return false;
    if (statusFilter === 'qualified' && !u.qualified) return false;
    if (statusFilter === 'active' && !u.is_active) return false;
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Count Qualifications"
          description="Choose who is qualified to perform cycle counts — the AI scheduler only assigns counts to qualified people"
        />

        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
        )}

        {!isAdmin && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
            Viewing only — an admin role is required to change qualifications.
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-64 rounded-md border px-3 py-2 text-sm"
          />
          <select
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="">All locations</option>
            {locations.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            <option value="none">No location</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            className="rounded-md border px-3 py-2 text-sm"
          >
            <option value="all">Everyone</option>
            <option value="active">Active only</option>
            <option value="qualified">Qualified only</option>
          </select>
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {users.length} people · {qualifiedCount} qualified
          </span>
        </div>

        {loading ? (
          <div className="text-sm text-muted-foreground">Loading people…</div>
        ) : (
          <div className="border rounded-lg overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3 text-right">Qualified Counter</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.user_id} className={`border-b last:border-0 hover:bg-gray-50 ${u.is_active ? '' : 'opacity-60'}`}>
                    <td className="px-4 py-3 font-medium">
                      {u.name || '—'}
                      {!u.is_active && <span className="ml-2 text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded">inactive</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-500">{u.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{u.location_name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{u.role || 'employee'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => toggleQualified(u)}
                        disabled={!isAdmin || savingUserId === u.user_id}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                          u.qualified ? 'bg-green-500' : 'bg-gray-300'
                        }`}
                        title={u.qualified ? 'Qualified — click to remove' : 'Not qualified — click to add'}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            u.qualified ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      {users.length === 0 ? 'No people found for this tenant yet.' : 'Nobody matches these filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
