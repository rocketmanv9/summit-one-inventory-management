'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { SettingsNav } from '@/components/settings/SettingsNav';
import { getStoredAccessToken, parseJwtPayload, getTenantIdFromToken } from '@/lib/auth-token';
import {
  useTenantBranding,
  applyCssVariables,
  PALETTE_OPTIONS,
  UI_ROLES,
  DEFAULT_ASSIGNMENTS,
  type PaletteKey,
  type ColorAssignments,
  type TenantBranding,
} from '@/lib/tenant-branding';

export default function BrandingPage() {
  const { branding: providerBranding } = useTenantBranding();
  const [palette, setPalette] = useState<Record<string, string>>({});
  const [assignments, setAssignments] = useState<ColorAssignments>({ ...DEFAULT_ASSIGNMENTS });
  const [savedAssignments, setSavedAssignments] = useState<ColorAssignments>({ ...DEFAULT_ASSIGNMENTS });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
    if (token) setTenantId(getTenantIdFromToken(token));
  }, []);

  useEffect(() => {
    fetchBranding();
  }, []);

  const fetchBranding = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/settings/branding');
      if (!res.ok) throw new Error('Failed to fetch branding');
      const json = await res.json();
      const data = json.data;

      if (data) {
        // Extract palette colors from the API response (Core-merged)
        const p: Record<string, string> = {};
        for (const opt of PALETTE_OPTIONS) {
          if (typeof data[opt.key] === 'string') {
            p[opt.key] = data[opt.key];
          }
        }
        setPalette(p);

        // Extract saved assignments
        if (data.theme_config?.assignments) {
          const saved = { ...DEFAULT_ASSIGNMENTS, ...data.theme_config.assignments };
          setAssignments(saved);
          setSavedAssignments(saved);
        }
      }
    } catch (err) {
      console.error('Error fetching branding:', err);
    } finally {
      setLoading(false);
    }
  };

  const paletteHex = (key: PaletteKey): string =>
    palette[key] || (providerBranding as unknown as Record<string, string>)[key] || '#000000';

  const applyPreview = useCallback((currentAssignments: ColorAssignments) => {
    // Build a branding object with the Core palette colors for CSS variable application
    const preview: TenantBranding = {
      ...providerBranding,
      ...Object.fromEntries(
        PALETTE_OPTIONS.map((opt) => [opt.key, paletteHex(opt.key)])
      ),
      theme_config: { assignments: currentAssignments },
    };
    applyCssVariables(preview);
  }, [providerBranding, palette]);

  const handleAssignmentChange = (roleKey: string, paletteKey: PaletteKey) => {
    const updated = { ...assignments, [roleKey]: paletteKey };
    setAssignments(updated);
    applyPreview(updated);
  };

  const handleReset = () => {
    setAssignments(savedAssignments);
    applyPreview(savedAssignments);
    setError('');
    setSuccess('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) { setError('You must be an admin to update branding'); return; }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const res = await fetch('/api/settings/branding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ assignments }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || 'Failed to save branding');
      }

      if (tenantId) {
        try { localStorage.removeItem(`branding_${tenantId}`); } catch { /* ok */ }
      }

      setSavedAssignments({ ...assignments });
      setSuccess('Branding saved!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error saving branding:', err);
      setError(err instanceof Error ? err.message : 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = JSON.stringify(assignments) !== JSON.stringify(savedAssignments);

  if (loading) {
    return (
      <AppShell>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading branding...</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Branding"
        description="Assign your brand palette colors to different parts of the UI"
      />

      <SettingsNav />

      {!isAdmin && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 font-medium">Admin Access Required</p>
          <p className="text-yellow-700 text-sm mt-1">
            You are viewing branding in read-only mode. Only administrators can modify these settings.
          </p>
        </div>
      )}

      <div className="max-w-3xl">
        {/* Palette Preview */}
        <div className="bg-white rounded-lg border p-6 mb-6">
          <h3 className="text-base font-semibold mb-3">Your Brand Palette</h3>
          <p className="text-sm text-gray-500 mb-4">
            These are your organization&apos;s core colors. Use the assignments below to control where each one appears.
          </p>
          <div className="flex flex-wrap gap-4">
            {PALETTE_OPTIONS.map((opt) => {
              const hex = paletteHex(opt.key);
              return (
                <div key={opt.key} className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-md border border-gray-300"
                    style={{ backgroundColor: hex }}
                  />
                  <div>
                    <div className="text-sm font-medium">{opt.label}</div>
                    <div className="text-xs text-gray-400 font-mono">{hex}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Assignments */}
        <form onSubmit={handleSave}>
          <div className="bg-white rounded-lg border p-6 space-y-5">
            <h3 className="text-base font-semibold">Color Assignments</h3>
            <p className="text-sm text-gray-500">
              Choose which palette color to use for each UI role. Changes preview instantly.
            </p>

            {UI_ROLES.map((uiRole) => {
              const currentKey = assignments[uiRole.key] || uiRole.defaultPaletteKey;
              const currentHex = paletteHex(currentKey as PaletteKey);

              return (
                <div key={uiRole.key} className="flex items-center gap-4">
                  <div
                    className="w-6 h-6 rounded border border-gray-300 flex-shrink-0"
                    style={{ backgroundColor: currentHex }}
                  />
                  <div className="flex-1 min-w-0">
                    <label className="block text-sm font-medium">{uiRole.label}</label>
                    <p className="text-xs text-gray-400">{uiRole.description}</p>
                  </div>
                  <select
                    value={currentKey}
                    onChange={(e) => handleAssignmentChange(uiRole.key, e.target.value as PaletteKey)}
                    disabled={!isAdmin}
                    className="w-40 px-3 py-1.5 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {PALETTE_OPTIONS.map((opt) => (
                      <option key={opt.key} value={opt.key}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}
          {success && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}

          <div className="flex gap-3 pt-6">
            <button
              type="submit"
              disabled={!isAdmin || saving || !hasChanges}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Assignments'}
            </button>
            {hasChanges && (
              <button
                type="button"
                onClick={handleReset}
                disabled={!isAdmin}
                className="px-6 py-2 border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reset
              </button>
            )}
          </div>
        </form>
      </div>
    </AppShell>
  );
}
