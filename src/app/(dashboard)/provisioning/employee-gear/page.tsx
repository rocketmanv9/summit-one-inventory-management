'use client';

import { useState } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { StatusChip } from '@/components/ui/StatusChip';
import { ProvisioningRPC } from '@/lib/rpc/provisioning';
import { Search, RotateCcw } from 'lucide-react';

interface Provision {
  id: string;
  catalog_item_id: string;
  catalog_item_name?: string;
  qty: number;
  status: string | null;
  issued_at: string | null;
  returned_at: string | null;
  request_id: string | null;
  notes: string | null;
  created_at: string;
}

interface PendingRequest {
  id: string;
  trigger_event: string | null;
  status: string | null;
  line_count?: number;
  created_at: string;
}

export default function EmployeeGearPage() {
  const [employeeId, setEmployeeId] = useState('');
  const [searchId, setSearchId] = useState('');
  const [activeProvisions, setActiveProvisions] = useState<Provision[]>([]);
  const [pastProvisions, setPastProvisions] = useState<Provision[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    if (!employeeId.trim()) return;
    setSearchId(employeeId.trim());
    setLoading(true);
    setSearched(true);
    try {
      const [activeData, pastData, requestData] = await Promise.all([
        ProvisioningRPC.getEmployeeProvisions(employeeId.trim(), { status: 'active' }),
        ProvisioningRPC.getEmployeeProvisions(employeeId.trim()),
        ProvisioningRPC.getRequests({ employee_id: employeeId.trim() }),
      ]);
      const active = activeData?.data || activeData || [];
      const all = pastData?.data || pastData || [];
      const requests = requestData?.data || requestData || [];
      setActiveProvisions(active);
      setPastProvisions(all.filter((p: Provision) => p.status !== 'active'));
      setPendingRequests(requests.filter((r: PendingRequest) => r.status !== 'fulfilled' && r.status !== 'cancelled'));
    } catch (error) {
      console.error('Error fetching employee data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReturn = async (provision: Provision) => {
    const notes = prompt('Return notes (optional):');
    if (notes === null) return;
    try {
      await ProvisioningRPC.returnProvision(searchId, provision.id, notes || undefined);
      handleSearch();
    } catch (error) {
      console.error('Error recording return:', error);
      alert('Failed to record return');
    }
  };

  const activeColumns = [
    {
      key: 'catalog_item_name',
      header: 'Item',
      render: (row: Provision) => <span className="font-medium">{row.catalog_item_name || row.catalog_item_id}</span>,
    },
    { key: 'qty', header: 'Qty', className: 'text-center font-mono', render: (row: Provision) => row.qty },
    {
      key: 'status',
      header: 'Status',
      render: (row: Provision) => <StatusChip status={row.status} />,
    },
    {
      key: 'issued_at',
      header: 'Issued',
      render: (row: Provision) => row.issued_at ? new Date(row.issued_at).toLocaleDateString() : '-',
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: Provision) => (
        <button
          onClick={(e) => { e.stopPropagation(); handleReturn(row); }}
          className="px-3 py-1 text-sm rounded bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1"
        >
          <RotateCcw className="h-3 w-3" />
          Record Return
        </button>
      ),
    },
  ];

  const pastColumns = [
    {
      key: 'catalog_item_name',
      header: 'Item',
      render: (row: Provision) => <span className="font-medium">{row.catalog_item_name || row.catalog_item_id}</span>,
    },
    { key: 'qty', header: 'Qty', className: 'text-center font-mono', render: (row: Provision) => row.qty },
    { key: 'status', header: 'Status', render: (row: Provision) => <StatusChip status={row.status} /> },
    { key: 'issued_at', header: 'Issued', render: (row: Provision) => row.issued_at ? new Date(row.issued_at).toLocaleDateString() : '-' },
    { key: 'returned_at', header: 'Returned', render: (row: Provision) => row.returned_at ? new Date(row.returned_at).toLocaleDateString() : '-' },
  ];

  const requestColumns = [
    { key: 'id', header: 'Request', render: (row: PendingRequest) => <span className="font-mono text-sm">{row.id.slice(0, 8)}...</span> },
    {
      key: 'trigger_event',
      header: 'Trigger',
      render: (row: PendingRequest) => (
        <span className="inline-flex px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-700">
          {row.trigger_event?.replace(/_/g, ' ') || '-'}
        </span>
      ),
    },
    { key: 'status', header: 'Status', render: (row: PendingRequest) => <StatusChip status={row.status} /> },
    { key: 'line_count', header: 'Lines', className: 'text-center', render: (row: PendingRequest) => <span className="font-mono">{row.line_count ?? '-'}</span> },
    { key: 'created_at', header: 'Created', render: (row: PendingRequest) => new Date(row.created_at).toLocaleDateString() },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Employee Gear"
          description="Look up an employee to view their active provisions, past gear, and pending requests"
        />

        {/* Search */}
        <div className="flex gap-3">
          <input
            type="text"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            className="flex-1 max-w-md px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Enter employee ID..."
          />
          <button
            onClick={handleSearch}
            disabled={loading || !employeeId.trim()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 flex items-center gap-2 disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>

        {searched && !loading && (
          <>
            {/* Active provisions */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Active Provisions ({activeProvisions.length})</h3>
              <DataTable data={activeProvisions} columns={activeColumns} emptyMessage="No active provisions" rowKey={(row) => row.id} />
            </div>

            {/* Pending requests */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Pending Requests ({pendingRequests.length})</h3>
              <DataTable data={pendingRequests} columns={requestColumns} emptyMessage="No pending requests" rowKey={(row) => row.id} />
            </div>

            {/* Past provisions */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Past Provisions ({pastProvisions.length})</h3>
              <DataTable data={pastProvisions} columns={pastColumns} emptyMessage="No past provisions" rowKey={(row) => row.id} />
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
