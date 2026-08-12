'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { Suspense, useState, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { Truck, PackageCheck, Undo2, ScanLine } from 'lucide-react';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap } from '@/hooks/useGVTerms';

type TransferLine = {
  id: string;
  catalog_item_id: string;
  qty: number | null;
  qty_shipped: number | null;
  qty_received: number | null;
  line_number: number | null;
  last_event_id: string | null;
  catalog_items?: { id: string; name: string; sku: string; tracking_mode?: string | null } | null;
};

type Transfer = {
  id: string;
  status: string | null;
  notes: string | null;
  created_at: string;
  initiated_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  last_event_id: string | null;
  assigned_to_user_ids?: string[] | null;
  from_location?: { id: string; name: string; location_type?: { name?: string } | null } | null;
  to_location?: { id: string; name: string; location_type?: { name?: string } | null } | null;
  transfer_lines?: TransferLine[];
};

type AssignableUser = { user_id: string; name: string; email: string | null; role: string | null };

type LocationOption = {
  id: string;
  name: string;
  location_type?: { name?: string } | null;
};

type CatalogItemOption = {
  id: string;
  name: string;
  sku: string;
  uom_term_id?: string | null;
  tracking_mode?: string | null;
};

type CreatePrefill = {
  fromLocationId?: string;
  toLocationId?: string;
  itemId?: string;
  qty?: number;
};

export default function TransfersPage() {
  return (
    <Suspense fallback={
      <AppShell>
        <div className="py-8 text-center text-muted-foreground">Loading...</div>
      </AppShell>
    }>
      <TransfersPageContent />
    </Suspense>
  );
}

function TransfersPageContent() {
  const help = useHowItWorks('inventory-transfers-help');
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingTransfer, setEditingTransfer] = useState<Transfer | null>(null);
  const [selectedTransfer, setSelectedTransfer] = useState<Transfer | null>(null);
  const [showPartialReceiveModal, setShowPartialReceiveModal] = useState(false);
  const [partialReceiveTransfer, setPartialReceiveTransfer] = useState<Transfer | null>(null);
  const [showFixMistakeModal, setShowFixMistakeModal] = useState(false);
  const [fixMistakeTransfer, setFixMistakeTransfer] = useState<Transfer | null>(null);
  const [assignTransfer, setAssignTransfer] = useState<Transfer | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([]);
  const [createPrefill, setCreatePrefill] = useState<CreatePrefill | null>(null);
  const consumedCreateParams = useRef(false);

  // Auto-open the create modal once when arriving with ?create=1 (e.g. from the
  // Transfer Suggestions widget), then clear the params so refresh doesn't re-open it.
  useEffect(() => {
    if (consumedCreateParams.current) return;
    if (searchParams.get('create') !== '1') return;
    consumedCreateParams.current = true;

    const from = searchParams.get('from') || undefined;
    const to = searchParams.get('to') || undefined;
    const item = searchParams.get('item') || undefined;
    const qtyParam = searchParams.get('qty');
    const qty = qtyParam !== null && Number.isFinite(Number(qtyParam)) && Number(qtyParam) > 0
      ? Number(qtyParam)
      : undefined;

    setCreatePrefill({ fromLocationId: from, toLocationId: to, itemId: item, qty });
    setShowCreateModal(true);
    router.replace(pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  useEffect(() => {
    fetchTransfers();
  }, [filters.status]); // Only depend on the specific filter value, not the whole object

  // Roster for the assign picker + chip labels (names for assigned_to_user_ids).
  useEffect(() => {
    InventoryRPC.getAssignableUsers()
      .then(setAssignableUsers)
      .catch(() => setAssignableUsers([]));
  }, []);

  const userNameById = (id: string) =>
    assignableUsers.find((u) => u.user_id === id)?.name || `${id.slice(0, 8)}…`;

  const fetchTransfers = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.status) params.set('status', filters.status);

      const data = await InventoryRPC.getTransfers({
        status: filters.status || undefined,
      });
      setTransfers(data || []);
    } catch (error) {
      console.error('Error fetching transfers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleShip = async (transferId: string) => {
    if (!confirm('Ship this transfer?')) return;

    try {
      const transfer = transfers.find(t => t.id === transferId);
      if (!transfer?.last_event_id) {
        alert('Missing last_event_id. Please refresh and try again.');
        return;
      }

      await InventoryRPC.shipTransfer(transferId, transfer.last_event_id);
      fetchTransfers();
    } catch (error: any) {
      console.error('Error shipping transfer:', error);
      alert(`Failed to ship transfer: ${error.message || 'Unknown error'}`);
    }
  };

  const handleReceive = async (transferId: string, overrideReason?: string) => {
    if (!overrideReason && !confirm('Confirm full receipt of this transfer?')) return;

    try {
      const result = await InventoryRPC.receiveTransferFull(transferId, overrideReason);

      if (!result.success && result.error) {
        if (result.error.code === 'OVERRIDE_REASON_REQUIRED') {
          const reason = prompt(
            `${result.error.message}\n\nEnter an override reason to proceed:`
          );
          if (reason && reason.trim()) {
            return handleReceive(transferId, reason.trim());
          }
          return;
        }
        // Hard block
        alert(`Blocked: ${result.error.message}${result.error.action ? '\n\n' + result.error.action : ''}`);
        return;
      }

      if (result.override_logged) {
        alert('Transfer received. Override has been logged for audit.');
      }

      fetchTransfers();
    } catch (error: any) {
      console.error('Error receiving transfer:', error);
      alert(`Failed to receive transfer: ${error.message || 'Unknown error'}`);
    }
  };

  const handlePartialReceive = async (transferId: string) => {
    const transfer = transfers.find(t => t.id === transferId);
    if (!transfer) return;
    
    setPartialReceiveTransfer(transfer);
    setShowPartialReceiveModal(true);
  };

  const handleFixMistake = (transferId: string) => {
    const transfer = transfers.find(t => t.id === transferId);
    if (!transfer) return;
    
    setFixMistakeTransfer(transfer);
    setShowFixMistakeModal(true);
  };

  const handleReturn = async (transferId: string) => {
    if (!confirm('Create a return transfer (physical movement back)? This creates a new transfer in the opposite direction.')) return;

    try {
      await InventoryRPC.createTransferReversal(transferId);
      alert('Return transfer created in draft status. Ship and receive it to complete the physical return.');
      fetchTransfers();
    } catch (error: any) {
      console.error('Error creating return transfer:', error);
      alert(`Failed to create return transfer: ${error.message || 'Unknown error'}`);
    }
  };

  const handleCancel = async (transferId: string) => {
    if (!confirm('Cancel this transfer?')) return;

    try {
      const transfer = transfers.find(t => t.id === transferId);
      if (!transfer?.last_event_id) {
        alert('Missing last_event_id. Please refresh and try again.');
        return;
      }

      await InventoryRPC.cancelTransfer(transferId, transfer.last_event_id);
      fetchTransfers();
    } catch (error: any) {
      console.error('Error cancelling transfer:', error);
      alert(`Failed to cancel transfer: ${error.message || 'Unknown error'}`);
    }
  };

  const handleUndoCancel = async (transferId: string) => {
    if (!confirm('Undo cancellation? This will restore the transfer to draft status.')) return;

    try {
      await InventoryRPC.undoCancelTransfer(transferId);
      alert('Cancellation reversed successfully!');
      fetchTransfers();
    } catch (error) {
      console.error('Error undoing cancellation:', error);
      alert('Failed to undo cancellation. Please try again.');
    }
  };

  const isSerializedTransfer = (transfer: Transfer) =>
    (transfer.transfer_lines || []).some((line) => {
      const mode = line.catalog_items?.tracking_mode || '';
      return mode === 'serialized' || mode === 'both' || mode === 'hybrid';
    });

  const columns = [
    {
      key: 'id',
      header: 'Transfer #',
      render: (row: Transfer) => (
        <span className="font-mono text-sm">{row.id.slice(0, 8).toUpperCase()}</span>
      ),
    },
    {
      key: 'from_location',
      header: 'From',
      render: (row: Transfer) => (
        <div>
          <div className="font-medium">{row.from_location?.name || '-'}</div>
          <div className="text-xs text-muted-foreground capitalize">
            {row.from_location?.location_type?.name?.replace('_', ' ') || ''}
          </div>
        </div>
      ),
    },
    {
      key: 'to_location',
      header: 'To',
      render: (row: Transfer) => (
        <div>
          <div className="font-medium">{row.to_location?.name || '-'}</div>
          <div className="text-xs text-muted-foreground capitalize">
            {row.to_location?.location_type?.name?.replace('_', ' ') || ''}
          </div>
        </div>
      ),
    },
    {
      key: 'items',
      header: 'Items',
      render: (row: Transfer) => (
        <div>
          <div>{row.transfer_lines?.length || 0} line(s)</div>
          <div className="text-xs text-muted-foreground">
            {row.transfer_lines?.reduce((sum, line) => sum + (line.qty ?? 0), 0) || 0} units
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Transfer) => (
        <StatusChip status={row.status} />
      ),
    },
    {
      key: 'assigned',
      header: 'Assigned',
      render: (row: Transfer) => {
        const ids = row.assigned_to_user_ids || [];
        if (ids.length === 0) {
          return <span className="text-xs text-muted-foreground">Unassigned</span>;
        }
        return (
          <div className="flex flex-wrap gap-1">
            {ids.slice(0, 3).map((id) => (
              <span
                key={id}
                className="px-2 py-0.5 text-xs rounded-full bg-indigo-100 text-indigo-800"
                title={userNameById(id)}
              >
                {userNameById(id)}
              </span>
            ))}
            {ids.length > 3 && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-700">
                +{ids.length - 3}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'created_at',
      header: 'Created',
      sortable: true,
      render: (row: Transfer) => new Date(row.created_at).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: '',
      render: (row: Transfer) => (
        <div className="flex gap-2">
          {row.status !== 'completed' && row.status !== 'cancelled' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setAssignTransfer(row);
              }}
              className="px-2 py-1 text-xs bg-indigo-100 text-indigo-800 rounded hover:bg-indigo-200"
              title="Assign this transfer to one or more people"
            >
              {(row.assigned_to_user_ids || []).length > 0 ? 'Reassign' : 'Assign'}
            </button>
          )}
          {row.status === 'draft' && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingTransfer(row);
                  setShowEditModal(true);
                }}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
              >
                Edit
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleShip(row.id);
                }}
                className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
              >
                Ship
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancel(row.id);
                }}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
            </>
          )}
          {row.status === 'in_transit' && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleReceive(row.id);
                }}
                className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded hover:bg-green-200"
              >
                Full Receive
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isSerializedTransfer(row)) {
                    handlePartialReceive(row.id);
                  }
                }}
                className={`px-2 py-1 text-xs rounded ${
                  isSerializedTransfer(row)
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
                }`}
                title={isSerializedTransfer(row) ? 'Partial receive disabled for serialized asset transfers' : 'Partial receive'}
                disabled={isSerializedTransfer(row)}
              >
                Partial
              </button>
            </>
          )}
          {(row.status === 'partially_received') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!isSerializedTransfer(row)) {
                  handlePartialReceive(row.id);
                }
              }}
              className={`px-2 py-1 text-xs rounded ${
                isSerializedTransfer(row)
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-100 text-blue-800 hover:bg-blue-200'
              }`}
              title={isSerializedTransfer(row) ? 'Partial receive disabled for serialized asset transfers' : 'Receive more'}
              disabled={isSerializedTransfer(row)}
            >
              Receive More
            </button>
          )}
          {(row.status === 'in_transit' || row.status === 'partially_received' || row.status === 'completed') && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleFixMistake(row.id);
              }}
              className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200"
            >
              Fix Mistake
            </button>
          )}
          {row.status === 'completed' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleReturn(row.id);
              }}
              className="px-2 py-1 text-xs bg-orange-100 text-orange-800 rounded hover:bg-orange-200"
            >
              Return
            </button>
          )}
          {row.status === 'cancelled' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleUndoCancel(row.id);
              }}
              className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
              title="Restore to draft status"
            >
              Undo Cancel
            </button>
          )}
        </div>
      ),
    },
  ];

  const filterConfig = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'in_transit', label: 'In Transit' },
        { value: 'partially_received', label: 'Partially Received' },
        { value: 'completed', label: 'Completed' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Transfers"
          description="Manage inventory transfers between locations. Example: Transfer 50 tons of aggregate from Main Yard to Truck #7 for delivery to the I-95 paving project, or move excess rebar from Job Site A back to the warehouse."
          actions={
            <>
              {!help.show && <HowThisWorksButton onClick={help.open} />}
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Create Transfer
              </button>
            </>
          }
        />

        {help.show && (
          <HowItWorksCard
            title="How transfers work"
            onDismiss={help.dismiss}
            steps={[
              { title: 'Create a draft', body: 'Pick a from-location and a to-location, then add line items. Stock items take a quantity; serialized items have you pick the specific assets by tag.' },
              { title: 'Ship it', body: 'Shipping moves the transfer to In Transit — the stock leaves the from-location. Drafts can still be edited or cancelled before this point.' },
              { title: 'Receive it', body: 'Full Receive lands everything at the destination in one step. Partial receive takes deliveries in batches until every line is complete (not available for serialized assets).' },
              { title: 'Fix mistakes', body: 'Undo a shipment that never happened, reverse a wrong receipt, or create a return transfer for stock that physically needs to go back. Overrides are logged for audit.' },
            ]}
            legend={[
              { badge: <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">Draft</span>, text: 'being set up — editable' },
              { badge: <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">In Transit</span>, text: 'shipped, awaiting receipt' },
              { badge: <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">Partially Received</span>, text: 'some lines still outstanding' },
              { badge: <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Completed</span>, text: 'fully received' },
              { badge: <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Cancelled</span>, text: 'voided — can be undone back to draft' },
            ]}
            glossary={[
              { Icon: Truck, term: 'Ship / Receive', blurb: 'the two physical halves of a transfer — stock leaves the source when shipped and lands at the destination when received' },
              { Icon: PackageCheck, term: 'Partial receive', blurb: 'receive line quantities in multiple batches when a shipment arrives in pieces' },
              { Icon: ScanLine, term: 'Serialized items', blurb: 'tracked as individual assets by tag/serial — you select exact units and they move as a whole' },
              { Icon: Undo2, term: 'Fix Mistake', blurb: 'accounting corrections (undo ship, reverse receipt) vs. a return transfer, which physically moves stock back' },
            ]}
          />
        )}

        <div className="grid grid-cols-5 gap-4">
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-2xl font-bold text-gray-700">
              {transfers.filter(t => t.status === 'draft').length}
            </div>
            <div className="text-sm text-gray-600">Draft</div>
          </div>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {transfers.filter(t => t.status === 'in_transit').length}
            </div>
            <div className="text-sm text-blue-600">In Transit</div>
          </div>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="text-2xl font-bold text-amber-700">
              {transfers.filter(t => t.status === 'partially_received').length}
            </div>
            <div className="text-sm text-amber-600">Partially Received</div>
          </div>
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="text-2xl font-bold text-green-700">
              {transfers.filter(t => t.status === 'completed').length}
            </div>
            <div className="text-sm text-green-600">Completed</div>
          </div>
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-2xl font-bold text-red-700">
              {transfers.filter(t => t.status === 'cancelled').length}
            </div>
            <div className="text-sm text-red-600">Cancelled</div>
          </div>
        </div>

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={transfers}
          columns={columns}
          loading={loading}
          emptyMessage="No transfers found"
          rowKey={(row) => row.id}
          onRowClick={setSelectedTransfer}
        />

        {selectedTransfer && (
          <TransferDetailPanel
            transfer={selectedTransfer}
            onClose={() => setSelectedTransfer(null)}
          />
        )}

        {showCreateModal && (
          <CreateTransferModal
            initialFromLocationId={createPrefill?.fromLocationId}
            initialToLocationId={createPrefill?.toLocationId}
            initialItemId={createPrefill?.itemId}
            initialQty={createPrefill?.qty}
            onClose={() => {
              setShowCreateModal(false);
              setCreatePrefill(null);
            }}
            onCreated={() => {
              setShowCreateModal(false);
              setCreatePrefill(null);
              fetchTransfers();
            }}
          />
        )}

        {showEditModal && editingTransfer && (
          <EditTransferModal
            transfer={editingTransfer}
            onClose={() => {
              setShowEditModal(false);
              setEditingTransfer(null);
            }}
            onUpdated={() => {
              setShowEditModal(false);
              setEditingTransfer(null);
              fetchTransfers();
            }}
          />
        )}

        {showPartialReceiveModal && partialReceiveTransfer && (
          <PartialReceiveModal
            transfer={partialReceiveTransfer}
            onClose={() => {
              setShowPartialReceiveModal(false);
              setPartialReceiveTransfer(null);
            }}
            onReceived={() => {
              setShowPartialReceiveModal(false);
              setPartialReceiveTransfer(null);
              fetchTransfers();
            }}
          />
        )}

        {showFixMistakeModal && fixMistakeTransfer && (
          <FixMistakeModal
            transfer={fixMistakeTransfer}
            onClose={() => {
              setShowFixMistakeModal(false);
              setFixMistakeTransfer(null);
            }}
            onFixed={() => {
              setShowFixMistakeModal(false);
              setFixMistakeTransfer(null);
              fetchTransfers();
            }}
          />
        )}
        {assignTransfer && (
          <AssignTransferModal
            transfer={assignTransfer}
            users={assignableUsers}
            onClose={() => setAssignTransfer(null)}
            onAssigned={() => {
              setAssignTransfer(null);
              fetchTransfers();
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

function AssignTransferModal({
  transfer,
  users,
  onClose,
  onAssigned,
}: {
  transfer: Transfer;
  users: AssignableUser[];
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(transfer.assigned_to_user_ids || []),
  );
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      u.name.toLowerCase().includes(q) ||
      (u.email || '').toLowerCase().includes(q) ||
      (u.role || '').toLowerCase().includes(q)
    );
  });

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await InventoryRPC.assignTransfer(transfer.id, [...selected]);
      onAssigned();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign transfer.');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="border-b px-5 py-4">
          <h3 className="text-lg font-semibold">Assign transfer</h3>
          <p className="text-sm text-muted-foreground">
            {transfer.from_location?.name} → {transfer.to_location?.name}
            {' · '}
            Everyone selected gets it on their My Day.
          </p>
        </div>
        <div className="px-5 py-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search people by name, email, or role…"
            className="mb-3 w-full rounded border px-3 py-2 text-sm"
          />
          {error && <div className="mb-2 text-sm text-red-600">{error}</div>}
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">No people found.</div>
            ) : (
              filtered.map((u) => {
                const on = selected.has(u.user_id);
                return (
                  <label
                    key={u.user_id}
                    className="flex cursor-pointer items-center gap-3 rounded px-2 py-2 hover:bg-gray-50"
                  >
                    <input type="checkbox" checked={on} onChange={() => toggle(u.user_id)} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{u.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[u.email, u.role].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>
        <div className="flex items-center justify-between border-t px-5 py-3">
          <span className="text-sm text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100"
              disabled={saving}
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save assignment'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PartialReceiveModal({ transfer, onClose, onReceived }: { transfer: Transfer; onClose: () => void; onReceived: () => void }) {
  const [currentTransfer, setCurrentTransfer] = useState(transfer);
  const [loading, setLoading] = useState(true);
  const [lineQuantities, setLineQuantities] = useState<Record<number, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const hasSerializedLines = (currentTransfer.transfer_lines || []).some((line) => {
    const mode = line.catalog_items?.tracking_mode || '';
    return mode === 'serialized' || mode === 'both' || mode === 'hybrid';
  });

  // Fetch fresh transfer data to get current qty_received values
  useEffect(() => {
    const fetchTransferData = async () => {
      try {
        const data = await InventoryRPC.getTransfer(transfer.id);
        if (data) {
          setCurrentTransfer(data);
          const initialQuantities = (data.transfer_lines || []).reduce((acc: Record<number, number>, line) => {
            if (line.line_number == null) {
              return acc;
            }
            const shipped = line.qty_shipped ?? line.qty ?? 0;
            const received = line.qty_received ?? 0;
            const remaining = shipped - received;
            acc[line.line_number] = remaining > 0 ? remaining : 0;
            return acc;
          }, {});
          setLineQuantities(initialQuantities);
        } else {
          setCurrentTransfer(transfer);
        }
      } catch (err) {
        console.error('Error fetching transfer:', err);
        // Fallback to using provided transfer data
        setCurrentTransfer(transfer);
        const initialQuantities = (transfer.transfer_lines || []).reduce((acc: Record<number, number>, line) => {
          if (line.line_number == null) {
            return acc;
          }
          const shipped = line.qty_shipped ?? line.qty ?? 0;
          const received = line.qty_received ?? 0;
          const remaining = shipped - received;
          acc[line.line_number] = remaining > 0 ? remaining : 0;
          return acc;
        }, {});
        setLineQuantities(initialQuantities);
      } finally {
        setLoading(false);
      }
    };
    fetchTransferData();
  }, [transfer.id, transfer.transfer_lines]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (hasSerializedLines) {
        setError('Partial receive is disabled for serialized asset transfers. Use Full Receive instead.');
        setSaving(false);
        return;
      }

      // Filter out lines with 0 quantity
      const quantities = Object.entries(lineQuantities)
        .filter(([_, qty]) => qty > 0)
        .map(([lineNumber, qty]) => ({
          line_number: Number(lineNumber),
          qty_received: qty,
        }));

      if (quantities.length === 0) {
        setError('Please enter at least one quantity to receive');
        setSaving(false);
        return;
      }

      await InventoryRPC.receiveTransferPartial(transfer.id, quantities);

      onReceived();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const updateQuantity = (lineNumber: number, value: string) => {
    const numValue = value === '' ? 0 : parseInt(value);
    setLineQuantities({ ...lineQuantities, [lineNumber]: numValue });
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold">Receive Transfer Partially</h3>
          <p className="text-sm text-gray-600 mt-1">
            Enter the quantity received for each line. You can receive in multiple batches.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading transfer data...</div>
          ) : (
            <div className="space-y-3">
              {hasSerializedLines && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-700">
                  This transfer includes serialized assets. Use Full Receive to complete the move.
                </div>
              )}
              <h4 className="font-medium text-sm text-gray-700">Line Items</h4>
              {(currentTransfer.transfer_lines || []).map((line) => {
                const shipped = line.qty_shipped ?? line.qty ?? 0;
                const alreadyReceived = line.qty_received ?? 0;
                const remaining = shipped - alreadyReceived;
                const lineNumber = line.line_number ?? 0;
              
              return (
                <div key={line.id} className="p-3 bg-gray-50 rounded-md">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex-1">
                      <div className="font-medium text-sm">
                        {line.catalog_items?.name || 'Unknown Item'}
                      </div>
                      <div className="text-xs text-gray-600">
                        SKU: {line.catalog_items?.sku || '-'}
                      </div>
                    </div>
                    <div className="text-right text-xs text-gray-600">
                      <div>Shipped: {shipped}</div>
                      <div>Already Received: {alreadyReceived}</div>
                      <div className="font-medium text-gray-900">Remaining: {remaining}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-gray-700">Receive now:</label>
                    <input
                      type="number"
                      value={lineNumber ? lineQuantities[lineNumber] || '' : ''}
                      onChange={(e) => lineNumber && updateQuantity(lineNumber, e.target.value)}
                      className="w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                      min="0"
                      max={remaining}
                      placeholder="0"
                      disabled={!lineNumber}
                    />
                    <span className="text-xs text-gray-500">/ {remaining} remaining</span>
                  </div>
                </div>
              );
            })}
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Receiving...' : 'Receive Items'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FixMistakeModal({ transfer, onClose, onFixed }: { transfer: Transfer; onClose: () => void; onFixed: () => void }) {
  const [mode, setMode] = useState<'select' | 'undo-ship' | 'reverse-receipt' | 'return'>('select');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reasons = {
    'undo-ship': [
      'Accidentally clicked Ship',
      'Wrong transfer shipped',
      'Items not actually shipped',
      'Other'
    ],
    'reverse-receipt': [
      'Wrong quantity received',
      'Wrong location',
      'Wrong item',
      'Duplicate entry',
      'Items not actually received',
      'Other'
    ]
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) {
      setError('Please select a reason');
      return;
    }

    setSaving(true);
    setError('');

    try {
      let successMessage = '';

      if (mode === 'undo-ship') {
        await InventoryRPC.undoTransferShipment(transfer.id, reason, notes || null);
        successMessage = 'Shipment undone. Transfer reverted to draft.';
      } else if (mode === 'reverse-receipt') {
        await InventoryRPC.reverseTransferReceipt(transfer.id, reason, notes || null);
        successMessage = 'Receipt reversed. Stock corrected and transfer reverted to in-transit.';
      }

      alert(successMessage);
      onFixed();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'select') {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
          <div className="p-6 border-b border-gray-200">
            <h3 className="text-lg font-semibold">Fix Mistake</h3>
            <p className="text-sm text-gray-600 mt-1">
              Transfer #{transfer.id.slice(0, 8)} - Status: {transfer.status}
            </p>
          </div>

          <div className="p-6">
            <div className="mb-6">
              <h4 className="font-medium text-gray-900 mb-2">Did the inventory physically move?</h4>
              <p className="text-sm text-gray-600 mb-4">
                Choose the correct action based on what actually happened in the real world.
              </p>
            </div>

            <div className="space-y-3">
              {transfer.status === 'in_transit' && (
                <button
                  onClick={() => setMode('undo-ship')}
                  className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-yellow-500 hover:bg-yellow-50 text-left transition-colors"
                >
                  <div className="font-medium text-gray-900">❌ No - Undo Shipment (Correction)</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Items were never physically shipped. Reverts to draft status.
                  </div>
                  <div className="text-xs text-yellow-700 mt-2 font-medium">
                    ⚠️ Accounting correction only - does not move inventory
                  </div>
                </button>
              )}

              {(transfer.status === 'completed' || transfer.status === 'partially_received') && (
                <button
                  onClick={() => setMode('reverse-receipt')}
                  className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-yellow-500 hover:bg-yellow-50 text-left transition-colors"
                >
                  <div className="font-medium text-gray-900">❌ No - Reverse Receipt (Correction)</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Items were never physically received (wrong qty/location/item/duplicate).
                  </div>
                  <div className="text-xs text-yellow-700 mt-2 font-medium">
                    ⚠️ Creates corrective stock movements - does not create physical shipment
                  </div>
                </button>
              )}

              {transfer.status === 'completed' && (
                <button
                  onClick={() => {
                    onClose();
                    // Trigger return directly
                    if (confirm('Create a return transfer (physical movement back)? This creates a new transfer in the opposite direction.')) {
                      InventoryRPC.createTransferReversal(transfer.id)
                        .then(() => {
                          alert('Return transfer created in draft status. Ship and receive it to complete the physical return.');
                          onFixed();
                        })
                        .catch((err) => {
                          console.error('Error creating return transfer:', err);
                          alert('Failed to create return transfer. Please try again.');
                        });
                    }
                  }}
                  className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 text-left transition-colors"
                >
                  <div className="font-medium text-gray-900">✅ Yes - Return Inventory (Physical Move)</div>
                  <div className="text-sm text-gray-600 mt-1">
                    Items physically went from A → B, now need to physically return B → A.
                  </div>
                  <div className="text-xs text-blue-700 mt-2 font-medium">
                    📦 Creates a new transfer for the physical return shipment
                  </div>
                </button>
              )}
            </div>
          </div>

          <div className="p-6 border-t flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold">
            {mode === 'undo-ship' ? 'Undo Shipment' : 'Reverse Receipt'}
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            Transfer #{transfer.id.slice(0, 8)}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-sm text-yellow-800 font-medium">
              ⚠️ {mode === 'undo-ship' ? 'Accounting correction only. Does not move inventory.' : 'Creates corrective stock movements. Does not create physical shipment.'}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Reason *</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              <option value="">Select reason...</option>
              {reasons[mode as keyof typeof reasons]?.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Additional Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3}
              placeholder="Optional: Provide additional details about this correction..."
            />
          </div>

          <div className="flex gap-3 pt-4 border-t">
            <button
              type="button"
              onClick={() => setMode('select')}
              className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 disabled:opacity-50"
            >
              {saving ? 'Processing...' : mode === 'undo-ship' ? 'Undo Shipment' : 'Reverse Receipt'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function TransferDetailPanel({ transfer, onClose }: { transfer: Transfer; onClose: () => void }) {
  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-white shadow-xl border-l z-40 overflow-y-auto">
      <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white">
        <h3 className="font-semibold">Transfer Details</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="font-mono">{transfer.id.slice(0, 8).toUpperCase()}</span>
          <StatusChip status={transfer.status} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">From</div>
            <div className="font-medium">{transfer.from_location?.name}</div>
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">To</div>
            <div className="font-medium">{transfer.to_location?.name}</div>
          </div>
        </div>

        <div className="border-t pt-4">
          <h4 className="font-medium mb-2">Line Items</h4>
          <div className="space-y-2">
            {transfer.transfer_lines?.map((line) => (
              <div key={line.id} className="flex items-center justify-between p-2 bg-muted/30 rounded">
                <div>
                  <div className="font-medium">{line.catalog_items?.name || 'Unknown Item'}</div>
                  <div className="text-xs text-muted-foreground">{line.catalog_items?.sku}</div>
                </div>
                <div className="font-mono">{line.qty}</div>
              </div>
            )) || <p className="text-muted-foreground text-sm">No items</p>}
          </div>
        </div>

        {transfer.notes && (
          <div className="border-t pt-4">
            <h4 className="font-medium mb-2">Notes</h4>
            <p className="text-sm text-muted-foreground">{transfer.notes}</p>
          </div>
        )}

        <div className="border-t pt-4">
          <h4 className="font-medium mb-2">Timeline</h4>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-gray-400 rounded-full" />
              <span>Created: {new Date(transfer.created_at).toLocaleString()}</span>
            </div>
            {transfer.initiated_at && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-400 rounded-full" />
                <span>Shipped: {new Date(transfer.initiated_at).toLocaleString()}</span>
              </div>
            )}
            {transfer.completed_at && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-400 rounded-full" />
                <span>Received: {new Date(transfer.completed_at).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateTransferModal({
  onClose,
  onCreated,
  initialFromLocationId,
  initialToLocationId,
  initialItemId,
  initialQty,
}: {
  onClose: () => void;
  onCreated: () => void;
  initialFromLocationId?: string;
  initialToLocationId?: string;
  initialItemId?: string;
  initialQty?: number;
}) {
  const uomLabels = useUOMLabelMap();
  const [form, setForm] = useState({
    from_location_id: initialFromLocationId || '',
    to_location_id: initialToLocationId || '',
    notes: '',
    lines: [{
      catalog_item_id: initialItemId || '',
      qty: initialQty != null ? String(initialQty) : '',
      asset_ids: [] as string[],
    }],
  });
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [items, setItems] = useState<Array<{
    catalog_item_id: string;
    qty_available: number | null;
    asset_count?: number | null;
    catalog_items?: CatalogItemOption | null;
  }>>([]);
  const [assetsByLine, setAssetsByLine] = useState<Record<number, Array<{ id: string; asset_tag: string; serial_number: string | null }>>>({});
  const [loadingData, setLoadingData] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const prefillReconciled = useRef(!initialItemId);

  // Load locations on mount
  useEffect(() => {
    const loadLocations = async () => {
      try {
        const data = await InventoryRPC.getLocations({ active: true });
        setLocations(data || []);
      } catch (err) {
        console.error('[CreateTransferModal] Error loading locations:', err);
      } finally {
        setLoadingData(false);
      }
    };
    loadLocations();
  }, []);

  // Load items when from_location changes
  useEffect(() => {
    const loadItemsAtLocation = async () => {
      if (!form.from_location_id) {
        setItems([]);
        setAssetsByLine({});
        return;
      }

      setLoadingItems(true);
      try {
        const data = await InventoryRPC.getItemsAtLocation(form.from_location_id);
        const loaded = ((data || []) as any[]);
        setItems(loaded as any);

        // Reconcile a prefilled item once options are loaded (e.g. opened from
        // the Transfer Suggestions widget): clear it if it isn't stocked at the
        // from-location, or load assets if it's serialized.
        if (!prefillReconciled.current && initialItemId) {
          prefillReconciled.current = true;
          const match = loaded.find((it) => it.catalog_item_id === initialItemId);
          if (!match) {
            setForm((prev) => ({
              ...prev,
              lines: prev.lines.map((line, idx) =>
                idx === 0 && line.catalog_item_id === initialItemId
                  ? { ...line, catalog_item_id: '', qty: '' }
                  : line
              ),
            }));
          } else if (isSerializedMode(match.catalog_items?.tracking_mode)) {
            // Serialized items select assets instead of a free qty
            setForm((prev) => ({
              ...prev,
              lines: prev.lines.map((line, idx) =>
                idx === 0 && line.catalog_item_id === initialItemId
                  ? { ...line, qty: '', asset_ids: [] }
                  : line
              ),
            }));
            loadAssetsForLine(0, initialItemId);
          }
        }
      } catch (err) {
        console.error('[CreateTransferModal] Error loading items:', err);
        setItems([]);
      } finally {
        setLoadingItems(false);
      }
    };
    loadItemsAtLocation();
  }, [form.from_location_id]);

  const isSerializedMode = (mode?: string | null) => {
    const value = mode || 'stock';
    return value === 'serialized' || value === 'both' || value === 'hybrid';
  };

  const getItemMeta = (catalogItemId: string) => items.find((item) => item.catalog_item_id === catalogItemId);

  const loadAssetsForLine = async (index: number, catalogItemId: string) => {
    if (!form.from_location_id || !catalogItemId) return;
    try {
      const assets = await InventoryRPC.getAssetsForTransfer({
        location_id: form.from_location_id,
        catalog_item_id: catalogItemId,
      });
      setAssetsByLine((prev) => ({
        ...prev,
        [index]: assets.map((asset) => ({
          id: asset.id,
          asset_tag: asset.asset_tag,
          serial_number: asset.serial_number,
        })),
      }));
    } catch (err) {
      console.error('[CreateTransferModal] Error loading assets:', err);
      setAssetsByLine((prev) => ({ ...prev, [index]: [] }));
    }
  };

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { catalog_item_id: '', qty: '', asset_ids: [] }],
    });
  };

  const removeLine = (index: number) => {
    setForm({
      ...form,
      lines: form.lines.filter((_, i) => i !== index),
    });
    setAssetsByLine((prev) => {
      const entries = Object.entries(prev)
        .filter(([key]) => Number(key) !== index)
        .map(([key, value]) => ({ key: Number(key), value }))
        .sort((a, b) => a.key - b.key);

      const next: Record<number, Array<{ id: string; asset_tag: string; serial_number: string | null }>> = {};
      entries.forEach((entry, idx) => {
        next[idx] = entry.value;
      });
      return next;
    });
  };

  const updateLine = (index: number, field: string, value: string) => {
    const newLines = [...form.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setForm({ ...form, lines: newLines });
  };

  const handleCatalogItemChange = (index: number, catalogItemId: string) => {
    const newLines = [...form.lines];
    newLines[index] = {
      ...newLines[index],
      catalog_item_id: catalogItemId,
      qty: '',
      asset_ids: [],
    };
    setForm({ ...form, lines: newLines });

    const trackingMode = getItemMeta(catalogItemId)?.catalog_items?.tracking_mode || 'stock';
    if (isSerializedMode(trackingMode)) {
      loadAssetsForLine(index, catalogItemId);
    } else {
      setAssetsByLine((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Prevent double submission
    if (saving) return;
    
    setSaving(true);
    setError('');

    try {
      const normalizedLines = form.lines
        .filter((line) => line.catalog_item_id)
        .map((line) => {
          const trackingMode = getItemMeta(line.catalog_item_id)?.catalog_items?.tracking_mode || 'stock';
          if (isSerializedMode(trackingMode)) {
            if (line.asset_ids.length === 0) {
              throw AppError.badRequest('Select at least one asset for serialized items.');
            }
            return {
              catalog_item_id: line.catalog_item_id,
              qty: line.asset_ids.length,
              asset_ids: line.asset_ids,
            };
          }

          if (!line.qty) {
            throw AppError.badRequest('Enter a quantity for each stock line.');
          }

          return {
            catalog_item_id: line.catalog_item_id,
            qty: parseInt(line.qty, 10),
          };
        });

      await InventoryRPC.createTransfer({
        from_location_id: form.from_location_id,
        to_location_id: form.to_location_id,
        notes: form.notes || null,
        lines: normalizedLines,
      });

      onCreated();
    } catch (err: any) {
      setError(err.message);
      setSaving(false); // Re-enable form on error
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Create Transfer</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          {loadingData ? (
            <div className="py-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading locations...</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">From Location *</label>
                  <select
                    value={form.from_location_id}
                    onChange={(e) => {
                      setForm({ 
                        ...form, 
                        from_location_id: e.target.value,
                        lines: [{ catalog_item_id: '', qty: '', asset_ids: [] }] // Reset lines when location changes
                      });
                      setAssetsByLine({});
                    }}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select location...</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({loc.location_type?.name || ''})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">To Location *</label>
                  <select
                    value={form.to_location_id}
                    onChange={(e) => setForm({ ...form, to_location_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select location...</option>
                    {locations.filter(loc => loc.id !== form.from_location_id).map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({loc.location_type?.name || ''})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">Line Items *</h4>
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-sm text-primary hover:underline"
                    disabled={!form.from_location_id || loadingItems}
                  >
                    + Add Line
                  </button>
                </div>
                <div className="space-y-3">
                  {form.lines.map((line, index) => {
                    const lineItem = getItemMeta(line.catalog_item_id);
                    const lineTrackingMode = lineItem?.catalog_items?.tracking_mode || 'stock';
                    const lineIsSerialized = isSerializedMode(lineTrackingMode);
                    const assets = assetsByLine[index] || [];

                    return (
                      <div key={index} className="space-y-2">
                        <div className="flex gap-2 items-center">
                          <select
                            value={line.catalog_item_id}
                            onChange={(e) => handleCatalogItemChange(index, e.target.value)}
                            className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                            required
                            disabled={!form.from_location_id || loadingItems}
                          >
                            <option value="">
                              {!form.from_location_id 
                                ? 'Select from location first...' 
                                : loadingItems 
                                ? 'Loading items...' 
                                : items.length === 0 
                                ? 'No items at this location' 
                                : 'Select item...'}
                            </option>
                            {items.map((item) => {
                              const trackingMode = item.catalog_items?.tracking_mode || 'stock';
                              const serialized = isSerializedMode(trackingMode);
                              const availableCount = serialized
                                ? (item.asset_count ?? item.qty_available ?? 0)
                                : (item.qty_available ?? 0);
                              return (
                                <option key={item.catalog_item_id} value={item.catalog_item_id}>
                                  {item.catalog_items?.name} ({item.catalog_items?.sku}) - {serialized ? 'Assets' : 'Available'}: {availableCount} {serialized ? '' : uomLabels[(item.catalog_items as any)?.uom_term_id] || ''}
                                </option>
                              );
                            })}
                          </select>
                          <input
                            type="number"
                            value={lineIsSerialized ? String(line.asset_ids.length) : line.qty}
                            onChange={(e) => updateLine(index, 'qty', e.target.value)}
                            className="w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                            placeholder="Qty"
                            min="1"
                            required
                            readOnly={lineIsSerialized}
                          />
                          {form.lines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeLine(index)}
                              className="text-red-500 hover:text-red-700 px-2"
                            >
                              ✕
                            </button>
                          )}
                        </div>

                        {lineIsSerialized && line.catalog_item_id && (
                          <div className="rounded-md border p-2 max-h-40 overflow-y-auto">
                            {assets.length === 0 && (
                              <div className="text-xs text-muted-foreground">
                                No available assets found at this location.
                              </div>
                            )}
                            {assets.map((asset) => {
                              const checked = line.asset_ids.includes(asset.id);
                              return (
                                <label key={asset.id} className="flex items-center gap-2 text-sm py-0.5">
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? [...line.asset_ids, asset.id]
                                        : line.asset_ids.filter((id) => id !== asset.id);
                                      const newLines = [...form.lines];
                                      newLines[index] = { ...line, asset_ids: next, qty: String(next.length) };
                                      setForm({ ...form, lines: newLines });
                                    }}
                                  />
                                  <span>
                                    {asset.asset_tag}
                                    {asset.serial_number && ` - ${asset.serial_number}`}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  placeholder="Optional notes about this transfer..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Creating...' : 'Create Transfer'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}

function EditTransferModal({ transfer, onClose, onUpdated }: { transfer: Transfer; onClose: () => void; onUpdated: () => void }) {
  const uomLabels = useUOMLabelMap();
  const [form, setForm] = useState<{
    from_location_id: string;
    to_location_id: string;
    notes: string;
    lines: Array<{ id?: string; last_event_id?: string | null; catalog_item_id: string; qty: string }>;
  }>({
    from_location_id: transfer.from_location?.id || '',
    to_location_id: transfer.to_location?.id || '',
    notes: transfer.notes || '',
    lines: transfer.transfer_lines?.map(line => ({
      id: line.id,
      last_event_id: line.last_event_id,
      catalog_item_id: line.catalog_item_id,
      qty: line.qty?.toString() ?? '',
    })) || [{ catalog_item_id: '', qty: '' }],
  });
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [items, setItems] = useState<Array<{
    catalog_item_id: string;
    qty_available: number | null;
    catalog_items?: CatalogItemOption | null;
  }>>([]);
  const [loadingData, setLoadingData] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Load locations on mount
  useEffect(() => {
    const loadLocations = async () => {
      try {
        const data = await InventoryRPC.getLocations({ active: true });
        setLocations(data || []);
      } catch (err) {
        console.error('Error loading locations:', err);
      } finally {
        setLoadingData(false);
      }
    };
    loadLocations();
  }, []);

  // Load items when from_location changes
  useEffect(() => {
    const loadItemsAtLocation = async () => {
      if (!form.from_location_id) {
        setItems([]);
        return;
      }

      setLoadingItems(true);
      try {
        const data = await InventoryRPC.getItemsAtLocation(form.from_location_id);
        setItems((data || []) as any);
      } catch (err) {
        console.error('Error loading items:', err);
        setItems([]);
      } finally {
        setLoadingItems(false);
      }
    };
    loadItemsAtLocation();
  }, [form.from_location_id]);

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { catalog_item_id: '', qty: '' }],
    });
  };

  const removeLine = (index: number) => {
    setForm({
      ...form,
      lines: form.lines.filter((_, i) => i !== index),
    });
  };

  const updateLine = (index: number, field: string, value: string) => {
    const newLines = [...form.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setForm({ ...form, lines: newLines });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      if (!transfer.last_event_id) {
        throw AppError.badRequest('Missing last_event_id. Please refresh and try again.');
      }

      await InventoryRPC.updateTransfer(transfer.id, transfer.last_event_id, {
        from_location_id: form.from_location_id,
        to_location_id: form.to_location_id,
        notes: form.notes || null,
        lines: form.lines
          .filter(l => l.catalog_item_id && l.qty)
          .map(l => ({
            ...(l.id && { id: l.id }),
            catalog_item_id: l.catalog_item_id,
            qty: parseInt(l.qty),
            last_event_id: l.last_event_id || undefined,
          })),
      });

      onUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Edit Transfer</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          {loadingData ? (
            <div className="py-8 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
              <p className="mt-2 text-sm text-gray-500">Loading locations and items...</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">From Location *</label>
                  <select
                    value={form.from_location_id}
                    onChange={(e) => setForm({ ...form, from_location_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select location...</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({loc.location_type?.name || ''})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">To Location *</label>
                  <select
                    value={form.to_location_id}
                    onChange={(e) => setForm({ ...form, to_location_id: e.target.value })}
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  >
                    <option value="">Select location...</option>
                    {locations.filter(loc => loc.id !== form.from_location_id).map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.name} ({loc.location_type?.name || ''})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">Line Items *</h4>
                  <button
                    type="button"
                    onClick={addLine}
                    className="text-sm text-primary hover:underline"
                  >
                    + Add Line
                  </button>
                </div>
                <div className="space-y-2">
                  {form.lines.map((line, index) => (
                    <div key={index} className="flex gap-2 items-center">
                      <select
                        value={line.catalog_item_id}
                        onChange={(e) => updateLine(index, 'catalog_item_id', e.target.value)}
                        className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        required
                      >
                        <option value="">Select item...</option>
                        {items.map((item) => (
                          <option key={item.catalog_item_id} value={item.catalog_item_id}>
                            {item.catalog_items?.name} ({item.catalog_items?.sku}) - {uomLabels[(item.catalog_items as any)?.uom_term_id] || ''}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={line.qty}
                        onChange={(e) => updateLine(index, 'qty', e.target.value)}
                        className="w-24 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Qty"
                        min="1"
                        required
                      />
                      {form.lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="text-red-500 hover:text-red-700 px-2"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  placeholder="Optional notes about this transfer..."
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
