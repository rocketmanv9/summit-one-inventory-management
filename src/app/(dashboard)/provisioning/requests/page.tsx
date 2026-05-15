'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { ProvisioningRPC } from '@/lib/rpc/provisioning';
import { ClipboardList, Clock, CheckCircle, AlertTriangle } from 'lucide-react';

interface ProvisioningRequest {
  id: string;
  employee_id: string;
  employee_name: string | null;
  trigger_event: string | null;
  status: string | null;
  priority: number | null;
  needed_by: string | null;
  delivery_method: string | null;
  employee_attributes: Record<string, unknown> | null;
  lines?: Array<Record<string, unknown>>;
  line_count?: number;
  created_at: string;
}

export default function ProvisioningRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ProvisioningRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchRequests();
  }, [filters]);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const data = await ProvisioningRPC.getRequests({
        status: filters.status || undefined,
        employee_id: filters.employee_id || undefined,
      });
      setRequests(data?.data || data || []);
    } catch (error) {
      console.error('Error fetching provisioning requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const countByStatus = (status: string) =>
    requests.filter((r) => r.status === status).length;

  const summaryCards = [
    { label: 'Pending', count: countByStatus('pending'), icon: Clock, bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', subtext: 'text-yellow-600' },
    { label: 'Provisioning', count: countByStatus('provisioning'), icon: ClipboardList, bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', subtext: 'text-blue-600' },
    { label: 'Fulfilled', count: countByStatus('fulfilled'), icon: CheckCircle, bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', subtext: 'text-green-600' },
    { label: 'Failed', count: countByStatus('failed'), icon: AlertTriangle, bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', subtext: 'text-red-600' },
  ];

  const columns = [
    {
      key: 'employee_name',
      header: 'Employee',
      sortable: true,
      render: (row: ProvisioningRequest) => (
        <div className="font-medium">{row.employee_name || row.employee_id}</div>
      ),
    },
    {
      key: 'trigger_event',
      header: 'Trigger Event',
      render: (row: ProvisioningRequest) => (
        <span className="inline-flex px-2 py-1 text-xs font-medium rounded bg-indigo-100 text-indigo-700">
          {row.trigger_event?.replace(/_/g, ' ') || '-'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: ProvisioningRequest) => <StatusChip status={row.status} />,
    },
    {
      key: 'line_count',
      header: 'Lines',
      className: 'text-center',
      render: (row: ProvisioningRequest) => (
        <span className="font-mono">{row.line_count ?? row.lines?.length ?? 0}</span>
      ),
    },
    {
      key: 'priority',
      header: 'Priority',
      sortable: true,
      render: (row: ProvisioningRequest) => {
        const p = row.priority ?? 0;
        const color = p >= 8 ? 'text-red-600 font-semibold' : p >= 5 ? 'text-yellow-600' : 'text-gray-600';
        return <span className={color}>{p}</span>;
      },
    },
    {
      key: 'needed_by',
      header: 'Needed By',
      sortable: true,
      render: (row: ProvisioningRequest) => {
        if (!row.needed_by) return <span className="text-muted-foreground">-</span>;
        const date = new Date(row.needed_by);
        const isOverdue = date < new Date() && row.status !== 'fulfilled' && row.status !== 'cancelled';
        return (
          <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
            {date.toLocaleDateString()}
          </span>
        );
      },
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: ProvisioningRequest) => new Date(row.created_at).toLocaleDateString(),
    },
  ];

  const filterConfig = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'pending', label: 'Pending' },
        { value: 'awaiting_approval', label: 'Awaiting Approval' },
        { value: 'approved', label: 'Approved' },
        { value: 'provisioning', label: 'Provisioning' },
        { value: 'fulfilled', label: 'Fulfilled' },
        { value: 'failed', label: 'Failed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
    {
      key: 'employee_id',
      label: 'Employee',
      type: 'search' as const,
      placeholder: 'Employee ID...',
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Provisioning Requests"
          description="Track and manage employee provisioning requests"
        />

        <div className="grid grid-cols-4 gap-4">
          {summaryCards.map((card) => (
            <div key={card.label} className={`p-4 ${card.bg} border ${card.border} rounded-lg`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className={`text-2xl font-bold ${card.text}`}>{card.count}</div>
                  <div className={`text-sm ${card.subtext}`}>{card.label}</div>
                </div>
                <card.icon className={`h-8 w-8 ${card.subtext} opacity-50`} />
              </div>
            </div>
          ))}
        </div>

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={requests}
          columns={columns}
          loading={loading}
          emptyMessage="No provisioning requests found"
          rowKey={(row) => row.id}
          onRowClick={(row) => router.push(`/provisioning/requests/${row.id}`)}
        />
      </div>
    </AppShell>
  );
}
