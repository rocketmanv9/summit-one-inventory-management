'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { AddVendorModal } from '@/components/modals/AddVendorModal';
import type { Database } from 'types/supabase';

type Vendor = Database['supply_chain']['Tables']['vendors']['Row'];

export default function VendorsPage() {
  const router = useRouter();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);

  useEffect(() => {
    fetchVendors();
  }, []);

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const data = await SupplyChainRPC.getVendors();
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Vendor',
      sortable: true,
      render: (row: Vendor) => (
        <div>
          <div className="font-medium">{row.name}</div>
          {row.code && <div className="text-xs text-muted-foreground font-mono">{row.code}</div>}
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (row: Vendor) => (
        <div>
          {row.contact_name && <div>{row.contact_name}</div>}
          {row.contact_email && <div className="text-xs text-muted-foreground">{row.contact_email}</div>}
        </div>
      ),
    },
    {
      key: 'contact_phone',
      header: 'Phone',
      render: (row: Vendor) => row.contact_phone || '-',
    },
    {
      key: 'payment_terms',
      header: 'Payment Terms',
      render: (row: Vendor) => row.payment_terms || '-',
    },
    {
      key: 'lead_time_days',
      header: 'Lead Time',
      className: 'text-right',
      render: (row: Vendor) => row.lead_time_days ? `${row.lead_time_days} days` : '-',
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Vendor) => (
        <StatusChip status={row.active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: Vendor) => (
        <div className="flex gap-2">
          <button
            onClick={() => router.push(`/inventory/vendors/${row.id}/items`)}
            className="text-sm text-green-600 hover:text-green-700"
          >
            Items
          </button>
          <button
            onClick={() => setEditingVendor(row)}
            className="text-sm text-blue-600 hover:text-blue-700"
          >
            Edit
          </button>
          <button
            onClick={() => handleDelete(row)}
            className="text-sm text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  const handleDelete = async (vendor: Vendor) => {
    if (!confirm(`Delete vendor "${vendor.name}"?`)) {
      return;
    }

    try {
      if (!vendor.last_event_id) {
        throw new Error('Missing last_event_id for this vendor. Please refresh and try again.');
      }

      await SupplyChainRPC.deleteVendor(vendor.id, vendor.last_event_id);

      fetchVendors();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const filterConfig = [
    {
      key: 'search',
      label: 'Search',
      type: 'search' as const,
      placeholder: 'Vendor name...',
    },
  ];

  const filteredVendors = vendors.filter((vendor) => {
    if (filters.search) {
      const term = filters.search.toLowerCase();
      const nameMatch = vendor.name.toLowerCase().includes(term);
      const codeMatch = (vendor.code || '').toLowerCase().includes(term);
      return nameMatch || codeMatch;
    }
    return true;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Vendors"
          description="Manage your suppliers and vendors. Example: Maintain vendor records for 'Acme Asphalt Supply', 'Riverside Ready-Mix', or 'Steel Rebar Distributors' with contact info, pricing, and delivery locations for easy PO creation."
          actions={
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              + Add Vendor
            </button>
          }
        />

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={filteredVendors}
          columns={columns}
          loading={loading}
          emptyMessage="No vendors found"
          rowKey={(row) => row.id}
        />

        <AddVendorModal
          open={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            setShowCreateModal(false);
            fetchVendors();
          }}
        />

        <AddVendorModal
          open={!!editingVendor}
          onClose={() => setEditingVendor(null)}
          onSuccess={() => {
            setEditingVendor(null);
            fetchVendors();
          }}
          vendor={editingVendor ?? undefined}
        />
      </div>
    </AppShell>
  );
}
