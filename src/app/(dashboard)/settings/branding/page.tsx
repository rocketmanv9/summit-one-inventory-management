'use client';

import { useState, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { getStoredAccessToken, parseJwtPayload, getTenantIdFromToken } from '@/lib/auth-token';
import { applyCssVariables, fallbackBranding, type TenantBranding } from '@/lib/tenant-branding';

// ---------------------------------------------------------------------------
// Color field definitions organized by section
// ---------------------------------------------------------------------------

interface ColorField {
  key: string;
  label: string;
  required?: boolean;
}

interface ColorSection {
  title: string;
  fields: ColorField[];
}

const COLOR_SECTIONS: ColorSection[] = [
  {
    title: 'Brand Colors',
    fields: [
      { key: 'primary_color', label: 'Primary', required: true },
      { key: 'secondary_color', label: 'Secondary', required: true },
      { key: 'tertiary_color', label: 'Tertiary', required: true },
      { key: 'accent_color', label: 'Accent', required: true },
      { key: 'text_color', label: 'Text', required: true },
      { key: 'background_color', label: 'Background', required: true },
    ],
  },
  {
    title: 'Buttons & CTA',
    fields: [
      { key: 'button_color', label: 'Button' },
      { key: 'button_text_color', label: 'Button Text' },
      { key: 'button_hover_color', label: 'Button Hover' },
      { key: 'button_active_color', label: 'Button Active' },
      { key: 'call_to_action_color', label: 'Call to Action' },
      { key: 'call_to_action_hover_color', label: 'CTA Hover' },
      { key: 'disabled_color', label: 'Disabled' },
      { key: 'disabled_text_color', label: 'Disabled Text' },
    ],
  },
  {
    title: 'Surfaces & Backgrounds',
    fields: [
      { key: 'surface_color', label: 'Surface' },
      { key: 'surface_alt_color', label: 'Surface Alt' },
      { key: 'overlay_color', label: 'Overlay' },
    ],
  },
  {
    title: 'Text Variants',
    fields: [
      { key: 'text_muted_color', label: 'Muted Text' },
      { key: 'text_disabled_color', label: 'Disabled Text' },
      { key: 'text_on_primary_color', label: 'Text on Primary' },
      { key: 'text_on_surface_color', label: 'Text on Surface' },
    ],
  },
  {
    title: 'Borders',
    fields: [
      { key: 'border_color', label: 'Border' },
      { key: 'border_subtle_color', label: 'Subtle Border' },
      { key: 'border_focus_color', label: 'Focus Border' },
    ],
  },
  {
    title: 'Primary & Secondary Variants',
    fields: [
      { key: 'primary_hover_color', label: 'Primary Hover' },
      { key: 'primary_active_color', label: 'Primary Active' },
      { key: 'primary_disabled_color', label: 'Primary Disabled' },
      { key: 'primary_focus_color', label: 'Primary Focus' },
      { key: 'secondary_hover_color', label: 'Secondary Hover' },
    ],
  },
  {
    title: 'Status Colors',
    fields: [
      { key: 'success_color', label: 'Success' },
      { key: 'success_hover_color', label: 'Success Hover' },
      { key: 'warning_color', label: 'Warning' },
      { key: 'warning_hover_color', label: 'Warning Hover' },
      { key: 'error_color', label: 'Error' },
      { key: 'error_hover_color', label: 'Error Hover' },
      { key: 'info_color', label: 'Info' },
      { key: 'info_hover_color', label: 'Info Hover' },
    ],
  },
];

// All editable color keys
const ALL_COLOR_KEYS = COLOR_SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

type ColorForm = Record<string, string>;

function buildFormFromBranding(b: TenantBranding | null): ColorForm {
  const form: ColorForm = {};
  const source = b ?? fallbackBranding;
  for (const key of ALL_COLOR_KEYS) {
    const value = (source as unknown as Record<string, unknown>)[key];
    form[key] = typeof value === 'string' ? value : '';
  }
  return form;
}

function buildBrandingPreview(form: ColorForm): TenantBranding {
  const preview: Record<string, unknown> = { ...fallbackBranding };
  for (const key of ALL_COLOR_KEYS) {
    if (form[key]) {
      preview[key] = form[key];
    }
  }
  return preview as unknown as TenantBranding;
}

const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

export default function BrandingPage() {
  const [form, setForm] = useState<ColorForm>({});
  const [savedForm, setSavedForm] = useState<ColorForm>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({ 0: true });

  useEffect(() => {
    const token = getStoredAccessToken();
    const payload = token ? parseJwtPayload(token) : null;
    setIsAdmin(payload?.app_metadata?.role === 'admin');
    if (token) {
      setTenantId(getTenantIdFromToken(token));
    }
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
      const initial = buildFormFromBranding(json.data);
      setForm(initial);
      setSavedForm(initial);
    } catch (err) {
      console.error('Error fetching branding:', err);
      const initial = buildFormFromBranding(null);
      setForm(initial);
      setSavedForm(initial);
    } finally {
      setLoading(false);
    }
  };

  const applyPreview = useCallback((currentForm: ColorForm) => {
    const preview = buildBrandingPreview(currentForm);
    applyCssVariables(preview);
  }, []);

  const handleColorChange = (key: string, value: string) => {
    const updated = { ...form, [key]: value };
    setForm(updated);
    applyPreview(updated);
  };

  const handleClear = (key: string) => {
    const updated = { ...form, [key]: '' };
    setForm(updated);
    applyPreview(updated);
  };

  const handleReset = () => {
    setForm(savedForm);
    applyPreview(savedForm);
    setError('');
    setSuccess('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isAdmin) {
      setError('You must be an admin to update branding');
      return;
    }

    // Validate required fields
    const requiredKeys = COLOR_SECTIONS[0].fields
      .filter((f) => f.required)
      .map((f) => f.key);

    for (const key of requiredKeys) {
      if (!form[key] || !HEX_REGEX.test(form[key])) {
        setError(`"${key.replace(/_/g, ' ')}" is required and must be a valid hex color`);
        return;
      }
    }

    // Validate any filled optional fields
    for (const key of ALL_COLOR_KEYS) {
      if (form[key] && !HEX_REGEX.test(form[key])) {
        setError(`"${key.replace(/_/g, ' ')}" must be a valid hex color or empty`);
        return;
      }
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const payload: Record<string, string | null> = {};
      for (const key of ALL_COLOR_KEYS) {
        payload[key] = form[key] || null;
      }

      const res = await fetch('/api/settings/branding', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error?.message || 'Failed to save branding');
      }

      // Clear localStorage cache so the provider picks up the new values
      if (tenantId) {
        try {
          localStorage.removeItem(`branding_${tenantId}`);
        } catch {
          // non-critical
        }
      }

      setSavedForm({ ...form });
      setSuccess('Branding saved successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      console.error('Error saving branding:', err);
      setError(err instanceof Error ? err.message : 'Failed to save branding');
    } finally {
      setSaving(false);
    }
  };

  const toggleSection = (index: number) => {
    setExpandedSections((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const hasChanges = JSON.stringify(form) !== JSON.stringify(savedForm);

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
        title="Branding Colors"
        description="Customize which colors are used across the UI for your organization"
      />

      {!isAdmin && (
        <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-800 font-medium">Admin Access Required</p>
          <p className="text-yellow-700 text-sm mt-1">
            You are viewing branding in read-only mode. Only administrators can modify these settings.
          </p>
        </div>
      )}

      <div className="max-w-5xl">
        <form onSubmit={handleSave} className="space-y-4">
          {COLOR_SECTIONS.map((section, sectionIdx) => {
            const isExpanded = expandedSections[sectionIdx] ?? false;

            return (
              <div key={section.title} className="bg-white rounded-lg border">
                <button
                  type="button"
                  onClick={() => toggleSection(sectionIdx)}
                  className="w-full flex items-center justify-between px-6 py-4 text-left"
                >
                  <h3 className="text-base font-semibold">{section.title}</h3>
                  <svg
                    className={`h-5 w-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {isExpanded && (
                  <div className="px-6 pb-6 border-t">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
                      {section.fields.map((field) => {
                        const value = form[field.key] || '';
                        const isValid = !value || HEX_REGEX.test(value);

                        return (
                          <div key={field.key} className="space-y-1">
                            <label className="block text-sm font-medium text-gray-700">
                              {field.label}
                              {field.required && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                type="color"
                                value={value || '#000000'}
                                onChange={(e) => handleColorChange(field.key, e.target.value)}
                                disabled={!isAdmin}
                                className="h-9 w-12 cursor-pointer rounded border border-gray-300 p-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
                              />
                              <input
                                type="text"
                                value={value}
                                onChange={(e) => handleColorChange(field.key, e.target.value)}
                                placeholder={field.required ? '#000000' : 'inherit'}
                                disabled={!isAdmin}
                                maxLength={7}
                                className={`flex-1 px-3 py-2 text-sm font-mono border rounded-md focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed ${
                                  !isValid ? 'border-red-400' : ''
                                }`}
                              />
                              {!field.required && value && isAdmin && (
                                <button
                                  type="button"
                                  onClick={() => handleClear(field.key)}
                                  className="text-gray-400 hover:text-gray-600 text-sm px-1"
                                  title="Clear"
                                >
                                  x
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Error/Success Messages */}
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {success && (
            <div className="p-3 bg-green-50 border border-green-200 rounded-md">
              <p className="text-sm text-green-800">{success}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              type="submit"
              disabled={!isAdmin || saving || !hasChanges}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Colors'}
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
