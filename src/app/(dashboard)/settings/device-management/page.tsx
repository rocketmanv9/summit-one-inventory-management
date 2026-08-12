'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createBrowserAuthedClient } from '@/supabase/client';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { AppError } from '@rocketmanv9/chassis/errors';

interface DeviceRow {
  id: string;
  name: string | null;
  device_code: string;
  device_type: string;
  status: string;
  role: string | null;
  scopes: string[];
  hardware_model: string | null;
  firmware_version: string | null;
  app_version: string | null;
  last_ip_address: string | null;
  heartbeat_count: number | null;
  installed_location_id: string | null;
  installed_location: { id: string; name: string } | null;
  installation_notes: string | null;
  last_seen_at: string | null;
  current_config_version: number | null;
  last_event_id: string;
  created_at: string;
}

interface LocationOption {
  id: string;
  name: string;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  unassigned: 'bg-amber-100 text-amber-800',
  suspended: 'bg-orange-100 text-orange-800',
  disabled: 'bg-gray-100 text-gray-700',
  retired: 'bg-gray-100 text-gray-600',
};

const DEVICE_TYPE_LABELS: Record<string, string> = {
  handheld_cycle_count: 'Handheld (cycle count)',
  portal_reader_entry: 'Portal reader (entry)',
  portal_reader_exit: 'Portal reader (exit)',
  portal_reader_bidirectional: 'Portal reader (both ways)',
  desktop_capture: 'Desktop capture',
};

/** Online indicator buckets from last_seen_at. */
function presence(lastSeen: string | null): { dot: string; label: string } {
  if (!lastSeen) return { dot: 'bg-gray-300', label: 'Never seen' };
  const ageMs = Date.now() - new Date(lastSeen).getTime();
  if (Number.isNaN(ageMs)) return { dot: 'bg-gray-300', label: 'Unknown' };
  const mins = ageMs / 60_000;
  if (mins <= 10) return { dot: 'bg-green-500', label: 'Online' };
  if (mins <= 60 * 24) return { dot: 'bg-amber-400', label: relativeTime(ageMs) };
  return { dot: 'bg-red-400', label: relativeTime(ageMs) };
}

function relativeTime(ageMs: number): string {
  const mins = Math.floor(ageMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function DeviceManagementPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [configs, setConfigs] = useState<Record<string, unknown>>({});
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const [claimCode, setClaimCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [role, setRole] = useState('handheld_scanner');
  const [claiming, setClaiming] = useState(false);
  const [claimMessage, setClaimMessage] = useState('');

  useEffect(() => {
    fetchDevices();
    fetchLocations();
  }, []);

  const fetchDevices = async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createBrowserAuthedClient().schema('inventory');
      const { data, error: queryError } = await supabase
        .from('rfid_devices')
        .select(
          'id, name, device_code, device_type, status, role, scopes, hardware_model, firmware_version, app_version, last_ip_address, heartbeat_count, installed_location_id, installed_location:installed_location_id(id, name), installation_notes, last_seen_at, current_config_version, last_event_id, created_at, tenant_id'
        )
        .not('tenant_id', 'is', null)
        .order('last_seen_at', { ascending: false, nullsFirst: false })
        .limit(200);

      if (queryError) {
        throw queryError;
      }

      setDevices((data || []) as unknown as DeviceRow[]);
    } catch (err) {
      console.error('Error loading devices:', err);
      setError('Failed to load devices.');
    } finally {
      setLoading(false);
    }
  };

  const fetchLocations = async () => {
    try {
      const locs = await InventoryRPC.getLocations({ active: true });
      setLocations((locs || []).map((l: any) => ({ id: l.id, name: l.name })));
    } catch {
      // location picker degrades to read-only display
    }
  };

  const fetchConfig = async (device: DeviceRow) => {
    if (configs[device.id] !== undefined) return;
    try {
      const supabase = createBrowserAuthedClient().schema('inventory');
      const { data } = await supabase
        .from('rfid_device_configs')
        .select('version, config, published_at')
        .eq('device_id', device.id)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      setConfigs((prev) => ({ ...prev, [device.id]: data?.config ?? null }));
    } catch {
      setConfigs((prev) => ({ ...prev, [device.id]: null }));
    }
  };

  const toggleExpand = (device: DeviceRow) => {
    const next = expandedId === device.id ? null : device.id;
    setExpandedId(next);
    setActionError('');
    if (next) fetchConfig(device);
  };

  const patchDevice = async (device: DeviceRow, updates: Record<string, unknown>, verb: string) => {
    setActionBusy(device.id);
    setActionError('');
    try {
      const res = await fetch(`/api/inventory/rfid-devices/${device.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-idempotency-key': crypto.randomUUID(),
        },
        credentials: 'include',
        body: JSON.stringify({ expected_last_event_id: device.last_event_id, ...updates }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw AppError.internal(json?.error?.message || `Failed to ${verb} device (${res.status})`);
      }
      await fetchDevices();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : `Failed to ${verb} device`);
    } finally {
      setActionBusy(null);
    }
  };

  const handleClaim = async (event: FormEvent) => {
    event.preventDefault();
    setClaimMessage('');

    if (!claimCode.trim()) {
      setClaimMessage('Enter a claim code from the device screen.');
      return;
    }

    if (!deviceName.trim()) {
      setClaimMessage('Provide a device name for tracking.');
      return;
    }

    setClaiming(true);
    try {
      const supabase = createBrowserAuthedClient();
      const { data, error: claimError } = await supabase.rpc('rpc_claim_device', {
        p_claim_code: claimCode.trim(),
        p_device_name: deviceName.trim(),
        p_role: role,
      });

      if (claimError) {
        throw claimError;
      }

      const claimed = Array.isArray(data) ? data[0] : null;
      setClaimMessage(
        claimed?.device_id
          ? `Device claimed: ${claimed.name || claimed.device_id}`
          : 'Device claimed.'
      );
      setClaimCode('');
      setDeviceName('');
      await fetchDevices();
    } catch (err) {
      console.error('Error claiming device:', err);
      const message =
        typeof err === 'object' && err
          ? ((err as { message?: string; details?: string }).message ||
              (err as { details?: string }).details ||
              'Unknown error')
          : 'Unknown error';
      setClaimMessage(`Claim failed: ${message}`);
    } finally {
      setClaiming(false);
    }
  };

  const renderExpanded = (device: DeviceRow) => {
    const config = configs[device.id];
    const busy = actionBusy === device.id;
    return (
      <tr key={`${device.id}-detail`} className="bg-gray-50/70">
        <td colSpan={8} className="px-4 py-4">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Hardware & connectivity */}
            <div className="rounded-md border bg-white p-3 text-sm space-y-1.5">
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Hardware</div>
              <div>Model: <span className="text-muted-foreground">{device.hardware_model || '—'}</span></div>
              <div>Firmware: <span className="text-muted-foreground">{device.firmware_version || '—'}</span></div>
              <div>App: <span className="text-muted-foreground">{device.app_version || '—'}</span></div>
              <div>Last IP: <span className="text-muted-foreground font-mono text-xs">{device.last_ip_address || '—'}</span></div>
              <div>Heartbeats: <span className="text-muted-foreground">{device.heartbeat_count ?? 0}</span></div>
              <div>Claimed: <span className="text-muted-foreground">{new Date(device.created_at).toLocaleDateString()}</span></div>
            </div>

            {/* Permissions & config */}
            <div className="rounded-md border bg-white p-3 text-sm space-y-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">What this device can do</div>
              <div className="flex flex-wrap gap-1">
                {(device.scopes || []).length > 0 ? device.scopes.map((s) => (
                  <span key={s} className="inline-flex px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-xs font-mono">{s}</span>
                )) : <span className="text-muted-foreground">No scopes granted</span>}
              </div>
              <div className="text-xs font-semibold uppercase text-muted-foreground pt-1">
                Config (v{device.current_config_version ?? 0})
              </div>
              {config === undefined ? (
                <div className="text-xs text-muted-foreground">Loading…</div>
              ) : config === null ? (
                <div className="text-xs text-muted-foreground">No published config.</div>
              ) : (
                <pre className="max-h-40 overflow-auto rounded bg-gray-900 text-gray-100 p-2 text-xs">
                  {JSON.stringify(config, null, 2)}
                </pre>
              )}
            </div>

            {/* Installation + lifecycle actions */}
            <div className="rounded-md border bg-white p-3 text-sm space-y-3">
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-1">Installed at</div>
                <select
                  value={device.installed_location_id || ''}
                  disabled={busy || locations.length === 0}
                  onChange={(e) => patchDevice(device, { installed_location_id: e.target.value || null }, 'relocate')}
                  className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-sm"
                >
                  <option value="">— No fixed location —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-muted-foreground mb-1.5">Lifecycle</div>
                <div className="flex flex-wrap gap-2">
                  {device.status !== 'active' && device.status !== 'retired' && (
                    <Button size="sm" variant="outline" disabled={busy}
                      onClick={() => patchDevice(device, { status: 'active' }, 'enable')}>
                      Enable
                    </Button>
                  )}
                  {device.status === 'active' && (
                    <Button size="sm" variant="outline" disabled={busy}
                      onClick={() => patchDevice(device, { status: 'suspended' }, 'suspend')}>
                      Suspend
                    </Button>
                  )}
                  {device.status !== 'retired' && (
                    <Button size="sm" variant="outline" disabled={busy}
                      className="text-red-600 hover:text-red-700"
                      onClick={() => {
                        if (confirm(`Retire "${device.name || device.device_code}"? A retired device can no longer sync. This is meant to be permanent.`)) {
                          patchDevice(device, { status: 'retired' }, 'retire');
                        }
                      }}>
                      Retire
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Suspended devices are blocked from syncing until re-enabled.
                </p>
              </div>
              {actionError && expandedId === device.id && (
                <div className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">{actionError}</div>
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <AppShell>
      <PageHeader
        title="Device Management"
        description="Claim and monitor RFID devices for your tenant"
        actions={
          <Button variant="outline" onClick={fetchDevices} disabled={loading}>
            Refresh list
          </Button>
        }
      />


      <div className="grid gap-6 lg:grid-cols-[1.05fr_1.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Claim a Device</CardTitle>
            <CardDescription>
              On the device, open Settings &gt; Claim to display a one-time claim code, then enter it
              here to attach the device to your organization. Codes expire, so claim promptly.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleClaim} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Claim Code</label>
                <Input
                  value={claimCode}
                  onChange={(event) => setClaimCode(event.target.value.toUpperCase())}
                  placeholder="ABCD-1234"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Device Name</label>
                <Input
                  value={deviceName}
                  onChange={(event) => setDeviceName(event.target.value)}
                  placeholder="Handheld Scanner 01"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Role</label>
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                  className="mt-1 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="handheld_scanner">Handheld Scanner</option>
                  <option value="portal_reader">Portal Reader</option>
                  <option value="desktop_capture">Desktop Capture</option>
                </select>
                <p className="mt-1 text-xs text-muted-foreground">
                  How you&apos;ll use the device. The hardware type (entry/exit portal, handheld, …) is
                  reported by the device itself and shown in the list.
                </p>
              </div>
              {claimMessage && (
                <div className="rounded-md border border-muted bg-muted/40 px-3 py-2 text-sm">
                  {claimMessage}
                </div>
              )}
              <Button type="submit" disabled={claiming} className="w-full">
                {claiming ? 'Claiming...' : 'Claim Device'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Devices</CardTitle>
            <CardDescription>
              Devices claimed by your organization. Click a row for hardware details, permissions,
              config, and lifecycle actions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-muted-foreground">Loading devices...</div>
            ) : error ? (
              <div className="text-sm text-red-600">{error}</div>
            ) : devices.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                No claimed devices yet. Claim your first device using the form on the left.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th className="pb-2 w-6" />
                      <th className="pb-2 pr-3">Name</th>
                      <th className="pb-2 pr-3">Type</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Connectivity</th>
                      <th className="pb-2 pr-3">Location</th>
                      <th className="pb-2 pr-3">Code</th>
                      <th className="pb-2">Config</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {devices.map((device) => {
                      const statusClass =
                        STATUS_STYLES[device.status] || 'bg-gray-100 text-gray-700';
                      const p = presence(device.last_seen_at);
                      const expanded = expandedId === device.id;
                      return [
                        <tr
                          key={device.id}
                          className="align-top cursor-pointer hover:bg-gray-50"
                          onClick={() => toggleExpand(device)}
                        >
                          <td className="py-3 pr-1 text-muted-foreground">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </td>
                          <td className="py-3 pr-3 font-medium">
                            {device.name || 'Unnamed device'}
                            <div className="text-xs font-normal text-muted-foreground">{device.role || ''}</div>
                          </td>
                          <td className="py-3 pr-3">{DEVICE_TYPE_LABELS[device.device_type] || device.device_type}</td>
                          <td className="py-3 pr-3">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass}`}
                            >
                              {device.status}
                            </span>
                          </td>
                          <td className="py-3 pr-3">
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`h-2 w-2 rounded-full ${p.dot}`} />
                              <span className="text-muted-foreground">{p.label}</span>
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-muted-foreground">
                            {device.installed_location?.name || '—'}
                          </td>
                          <td className="py-3 pr-3 text-muted-foreground font-mono text-xs">
                            {device.device_code}
                          </td>
                          <td className="py-3 text-muted-foreground">
                            v{device.current_config_version ?? 0}
                          </td>
                        </tr>,
                        ...(expanded ? [renderExpanded(device)] : []),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
