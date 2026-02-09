'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
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

interface DeviceRow {
  id: string;
  name: string | null;
  device_code: string;
  device_type: string;
  status: string;
  role: string | null;
  last_seen_at: string | null;
  current_config_version: number | null;
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  unassigned: 'bg-amber-100 text-amber-800',
  suspended: 'bg-orange-100 text-orange-800',
  disabled: 'bg-gray-100 text-gray-700',
  retired: 'bg-gray-100 text-gray-600',
};

export default function DeviceManagementPage() {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [claimCode, setClaimCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [role, setRole] = useState('handheld_scanner');
  const [claiming, setClaiming] = useState(false);
  const [claimMessage, setClaimMessage] = useState('');

  useEffect(() => {
    fetchDevices();
  }, []);

  const fetchDevices = async () => {
    setLoading(true);
    setError('');
    try {
      const supabase = createBrowserAuthedClient().schema('inventory');
      const { data, error: queryError } = await supabase
        .from('rfid_devices')
        .select(
          'id, name, device_code, device_type, status, role, last_seen_at, current_config_version, tenant_id'
        )
        .not('tenant_id', 'is', null)
        .order('last_seen_at', { ascending: false });

      if (queryError) {
        throw queryError;
      }

      setDevices((data || []) as DeviceRow[]);
    } catch (err) {
      console.error('Error loading devices:', err);
      setError('Failed to load devices.');
    } finally {
      setLoading(false);
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

  const formatLastSeen = (value: string | null) => {
    if (!value) {
      return 'Never';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return value;
    }
    return date.toLocaleString();
  };

  return (
    <AppShell>
      <PageHeader
        title="Device Management"
        description="Claim and monitor RFID devices for your tenant"
        actions={
          <Button variant="outline" onClick={fetchDevices} disabled={loading}>
            Refresh
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.05fr_1.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Claim a Device</CardTitle>
            <CardDescription>
              Enter the claim code shown on the device screen to assign it to your
              tenant.
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
              Only devices already claimed by your tenant appear here.
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
                      <th className="pb-2 pr-3">Name</th>
                      <th className="pb-2 pr-3">Code</th>
                      <th className="pb-2 pr-3">Type</th>
                      <th className="pb-2 pr-3">Role</th>
                      <th className="pb-2 pr-3">Status</th>
                      <th className="pb-2 pr-3">Last Seen</th>
                      <th className="pb-2">Config</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {devices.map((device) => {
                      const statusClass =
                        STATUS_STYLES[device.status] || 'bg-gray-100 text-gray-700';
                      return (
                        <tr key={device.id} className="align-top">
                          <td className="py-3 pr-3 font-medium">
                            {device.name || 'Unnamed device'}
                          </td>
                          <td className="py-3 pr-3 text-muted-foreground">
                            {device.device_code}
                          </td>
                          <td className="py-3 pr-3">{device.device_type}</td>
                          <td className="py-3 pr-3">{device.role || '-'}</td>
                          <td className="py-3 pr-3">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusClass}`}
                            >
                              {device.status}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-muted-foreground">
                            {formatLastSeen(device.last_seen_at)}
                          </td>
                          <td className="py-3 text-muted-foreground">
                            v{device.current_config_version ?? 0}
                          </td>
                        </tr>
                      );
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
