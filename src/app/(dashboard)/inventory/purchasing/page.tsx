'use client';

import { AppError } from '@rocketmanv9/chassis/errors';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { AppShell } from '@/components/layout/AppShell';
import { CapabilityGate } from '@/components/access/CapabilityGate';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { useUOMLabelMap, useUOMTerms } from '@/hooks/useGVTerms';
import { VendorModal } from '@/components/vendors/VendorModal';
import { updatePurchaseOrderStatus, deletePurchaseOrder, updatePurchaseOrder } from '@/lib/api/purchase-orders';
import { PlaceOrderModal } from '@/components/modals/PlaceOrderModal';
import { SendPOEmailModal } from '@/components/modals/SendPOEmailModal';
import { ReceivePOModal } from '@/components/modals/ReceivePOModal';
import { ReceiveMobileQRDialog } from '@/components/mobile/ReceiveMobileQRDialog';
import { RowActionMenu, type RowActionItem } from '@/components/ui/RowActionMenu';
import { PurchaseOrderActivity } from '@/components/purchasing/PurchaseOrderActivity';
import { PurchaseDocuments } from '@/components/purchasing/PurchaseDocuments';
import { PurchaseTimeline } from '@/components/purchasing/PurchaseTimeline';
import { DocumentSearchBar } from '@/components/purchasing/DocumentSearchBar';
import { MySpendCard } from '@/components/spend/MySpendCard';
import { useSession } from '@/hooks/useSession';
import {
  poBucket,
  poStatusChipLabel,
  poActions,
  INTEGRATION_VENDOR_CODES,
  type PoBucket,
} from '@/lib/po/po-status';
import { createBrowserAuthedClient } from '@/supabase/client';
import type { PurchaseOrder as POType } from '@/types/purchase-orders';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { Smartphone, FileSearch, MailCheck } from 'lucide-react';

interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id?: string;
  vendor_name_snapshot?: string;
  vendor_code_snapshot?: string;
  delivery_location_id?: string;
  status: string;
  expected_delivery_date?: string;
  notes?: string;
  created_at: string;
  last_event_id: string;
  purchase_order_lines?: Array<{
    id: string;
    catalog_item_id: string | null;
    item_description?: string | null;
    uom_term_id?: string | null;
    qty_ordered: number;
    qty_received: number;
    unit_cost: number;
    status: string;
  }>;
}

export default function PurchasingPage() {
  const help = useHowItWorks('inventory-purchasing-help');
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [locations, setLocations] = useState<Map<string, string>>(new Map());
  const [catalogItems, setCatalogItems] = useState<Map<string, any>>(new Map());
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [pendingVendorId, setPendingVendorId] = useState<string | null>(null);
  const [showPlaceOrderModal, setShowPlaceOrderModal] = useState(false);
  const [placeOrderPO, setPlaceOrderPO] = useState<PurchaseOrder | null>(null);
  // Send-confirm modal target (PO id) and receive-materials modal target.
  const [sendPoId, setSendPoId] = useState<string | null>(null);
  const [receivePO, setReceivePO] = useState<PurchaseOrder | null>(null);
  // QR modal for tokenized mobile receiving (tenant-wide, not tied to one PO).
  const [showReceiveQR, setShowReceiveQR] = useState(false);
  // "Create & Send" hands off here; once the new row loads we route it through
  // the vendor-aware send path (email vs. integration punchout).
  const [pendingSendPoId, setPendingSendPoId] = useState<string | null>(null);
  // One-click Amazon handoff: the create page starts the punchout, opens the
  // Amazon tab, then routes here with ?punchout=<id>&po=<poId>. We open the
  // PlaceOrderModal on that PO with the session already in flight.
  const [resumePunchoutId, setResumePunchoutId] = useState<string | null>(null);
  const [resumePoId, setResumePoId] = useState<string | null>(null);

  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const punchout = sp.get('punchout');
    const poId = sp.get('po');
    if (punchout && poId) {
      setResumePunchoutId(punchout);
      setResumePoId(poId);
      window.history.replaceState(null, '', '/inventory/purchasing');
    }
  }, []);

  useEffect(() => {
    if (!resumePoId) return;
    const row = orders.find((o) => o.id === resumePoId);
    if (row) {
      setResumePoId(null);
      setPlaceOrderPO(row);
      setShowPlaceOrderModal(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, resumePoId]);

  useEffect(() => {
    loadReferenceData();
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [filters]);

  // After "Create & Send", wait for the freshly-created PO to land in the list,
  // then trigger its vendor-aware send (email confirm or integration punchout).
  useEffect(() => {
    if (!pendingSendPoId) return;
    const row = orders.find((o) => o.id === pendingSendPoId);
    if (row) {
      setPendingSendPoId(null);
      handleSend(row);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, pendingSendPoId]);

  // user_id → display name for the Buyer filter (HR roster; best-effort).
  const [peopleNames, setPeopleNames] = useState<Record<string, string>>({});
  // POs waiting on ME (or all pending, for admins) — drives the inbox banner.
  const [approvalsCount, setApprovalsCount] = useState(0);

  const loadReferenceData = async () => {
    try {
      fetch('/api/inventory/purchasing/approvals', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : { data: { count: 0 } }))
        .then(({ data }) => setApprovalsCount(data?.count || 0))
        .catch(() => {});
      // Names for the Buyer filter — the count-qualified endpoint returns the
      // full HR roster (user_id, name, email) and is readable by anyone who
      // can see this page.
      fetch('/api/inventory/count-qualified', { credentials: 'include' })
        .then((res) => (res.ok ? res.json() : { data: [] }))
        .then(({ data }) => {
          const names: Record<string, string> = {};
          for (const u of data || []) {
            if (u.user_id) names[u.user_id] = u.name || u.email || u.user_id;
          }
          setPeopleNames(names);
        })
        .catch(() => {});

      // Load locations
      const locationData = await InventoryRPC.getLocations();
      const locationMap = new Map(locationData.map(loc => [loc.id, loc.name]));
      setLocations(locationMap);

      // Load catalog items
      const itemData = await InventoryRPC.getCatalogItems();
      const itemMap = new Map(itemData.map(item => [item.id, item]));
      setCatalogItems(itemMap);
    } catch (error) {
      console.error('Error loading reference data:', error);
    }
  };

  const fetchOrders = async () => {
    setLoading(true);
    try {
      // Load all POs; the status filter is applied client-side by display bucket
      // (a bucket spans several stored statuses).
      const data = await SupplyChainRPC.getPurchaseOrders();
      setOrders(data || []);
    } catch (error) {
      console.error('Error fetching purchase orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const { session: meSession } = useSession();
  const currentUserId = meSession?.userId;

  // Cancelled/voided POs are hidden from the active list unless explicitly filtered.
  const bucketFilter = (filters.status || '') as PoBucket | '';
  const buyerFilter = filters.buyer || '';
  const displayedOrders = orders.filter((o) => {
    const bucket = poBucket(o.status);
    const createdBy = (o as PurchaseOrder & { created_by_user_id?: string | null }).created_by_user_id;
    if (buyerFilter === 'mine' && createdBy !== currentUserId) return false;
    // Any other buyer value is a specific user id from the Buyer dropdown.
    if (buyerFilter && buyerFilter !== 'mine' && createdBy !== buyerFilter) return false;
    if (bucketFilter) return bucket === bucketFilter;
    return bucket !== 'cancelled';
  });

  // qty_ordered/qty_received/unit_cost are Postgres numeric → arrive as strings via
  // PostgREST; coerce with Number() before any arithmetic (string + string concatenates).
  const calculateTotal = (po: PurchaseOrder) => {
    return po.purchase_order_lines?.reduce((sum, line) => sum + (Number(line.qty_ordered) * Number(line.unit_cost || 0)), 0) || 0;
  };

  const calculateProgress = (po: PurchaseOrder) => {
    const totalQty = po.purchase_order_lines?.reduce((sum, line) => sum + Number(line.qty_ordered), 0) || 0;
    const receivedQty = po.purchase_order_lines?.reduce((sum, line) => sum + Number(line.qty_received), 0) || 0;
    return totalQty > 0 ? Math.round((receivedQty / totalQty) * 100) : 0;
  };

  // Flip a PO to 'sent' after it's been emailed. Fetches the current
  // last_event_id fresh so the optimistic-concurrency guard doesn't fail on a
  // stale row (the create-and-send path has no row in state yet).
  const markPoSent = async (poId: string) => {
    try {
      const supabase = createBrowserAuthedClient().schema('supply_chain');
      const { data } = await supabase
        .from('purchase_orders')
        .select('status, last_event_id')
        .eq('id', poId)
        .single();
      // Only advance from the draft bucket — never downgrade a received PO.
      if (data && poBucket(data.status) === 'draft') {
        await updatePurchaseOrderStatus(poId, 'sent', data.last_event_id);
      }
    } catch (error) {
      console.error('Error marking PO as sent:', error);
    } finally {
      fetchOrders();
    }
  };

  // "Send PO": integration vendors (Amazon punchout, Printify) go through their
  // own ordering modal; everyone else gets the email confirm-and-send step.
  const handleSend = (row: PurchaseOrder) => {
    const isIntegration =
      !!row.vendor_code_snapshot && INTEGRATION_VENDOR_CODES.includes(row.vendor_code_snapshot);
    if (isIntegration) {
      setPlaceOrderPO(row);
      setShowPlaceOrderModal(true);
    } else {
      setSendPoId(row.id);
    }
  };

  const handleReceive = (row: PurchaseOrder) => {
    setReceivePO(row);
  };

  const handleViewPdf = (row: PurchaseOrder) => {
    window.open(`/api/inventory/purchasing/po-pdf?po_id=${row.id}`, '_blank');
  };

  const handleCancel = async (row: PurchaseOrder) => {
    if (!confirm(`Cancel PO ${row.po_number}? This stops any further receiving.`)) {
      return;
    }
    try {
      const { error } = await updatePurchaseOrderStatus(row.id, 'cancelled', row.last_event_id);
      if (error) {
        alert(`Error: ${error.message}`);
        return;
      }
      setSelectedOrder(null);
      fetchOrders();
    } catch (error) {
      console.error('Error cancelling PO:', error);
      alert('Failed to cancel PO. Please try again.');
    }
  };

  const handleDeletePO = async (poId: string, poNumber: string, lastEventId: string) => {
    if (!confirm(`Delete draft PO ${poNumber}? This permanently voids it.`)) {
      return;
    }

    try {
      const { error } = await deletePurchaseOrder(poId, lastEventId);

      if (error) {
        alert(`Error: ${error.message}`);
        return;
      }

      setSelectedOrder(null);
      fetchOrders();
    } catch (error) {
      console.error('Error voiding PO:', error);
      alert('Failed to void PO. Please try again.');
    }
  };

  // Build the ⋮ menu items for a row from its display bucket.
  // Quote-flow drafts: once the vendor's prices are on the lines, this runs
  // the limit check — within limits → approved, over → the approvals inbox.
  const handleSubmitForApproval = async (row: PurchaseOrder) => {
    try {
      const result = await SupplyChainRPC.submitPoForApproval(row.id);
      alert(
        result.status === 'approved'
          ? `${row.po_number} approved — ready to send.`
          : `${row.po_number} sent for approval: ${result.reason || 'over limit'}.`
      );
    } catch (err: any) {
      alert(err.message || 'Price check failed');
    } finally {
      fetchOrders();
    }
  };

  const buildRowActions = (row: PurchaseOrder): RowActionItem[] => {
    const extra: RowActionItem[] =
      row.status === 'draft'
        ? [{
            key: 'submit_approval',
            label: 'Price check → approve',
            onClick: () => handleSubmitForApproval(row),
          }]
        : [];
    return extra.concat(poActions(poBucket(row.status)).map((a) => ({
      key: a.key,
      label: a.label,
      variant: a.variant,
      onClick: () => {
        switch (a.key) {
          case 'edit':
            setSelectedOrder(row);
            setShowEditModal(true);
            break;
          case 'send':
          case 'resend':
            handleSend(row);
            break;
          case 'delete':
            handleDeletePO(row.id, row.po_number, row.last_event_id);
            break;
          case 'receive':
            handleReceive(row);
            break;
          case 'view_pdf':
            handleViewPdf(row);
            break;
          case 'cancel':
            handleCancel(row);
            break;
        }
      },
    })));
  };

  const columns = [
    {
      key: 'po_number',
      header: 'PO Number',
      sortable: true,
      render: (row: PurchaseOrder) => (
        <span className="font-mono font-medium">{row.po_number}</span>
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      sortable: true,
      render: (row: PurchaseOrder) => (
        <div>
          <div className="font-medium">{row.vendor_name_snapshot || '-'}</div>
          {row.vendor_code_snapshot && (
            <div className="text-xs text-muted-foreground font-mono">{row.vendor_code_snapshot}</div>
          )}
        </div>
      ),
    },
    {
      key: 'lines',
      header: 'Lines',
      render: (row: PurchaseOrder) => (
        <div>
          <div>{row.purchase_order_lines?.length || 0} item(s)</div>
          <div className="text-xs text-muted-foreground">
            ${calculateTotal(row).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </div>
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Received',
      render: (row: PurchaseOrder) => {
        const progress = calculateProgress(row);
        return (
          <div className="w-24">
            <div className="flex items-center justify-between text-xs mb-1">
              <span>{progress}%</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${progress === 100 ? 'bg-green-500' : 'bg-blue-500'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        );
      },
    },
    {
      key: 'expected_delivery_date',
      header: 'Expected',
      sortable: true,
      render: (row: PurchaseOrder) => {
        if (!row.expected_delivery_date) return '-';
        const date = new Date(row.expected_delivery_date);
        const bucket = poBucket(row.status);
        const isLate = date < new Date() && bucket !== 'received' && bucket !== 'cancelled';
        return (
          <span className={isLate ? 'text-red-600 font-medium' : ''}>
            {date.toLocaleDateString()}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: PurchaseOrder) => (
        <StatusChip status={poStatusChipLabel(row.status)} />
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: PurchaseOrder) => (
        <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <RowActionMenu items={buildRowActions(row)} ariaLabel={`Actions for ${row.po_number}`} />
        </div>
      ),
    },
  ];

  // Buyer options: "me" plus every person who has actually created a PO,
  // labeled from the HR roster (falls back to a short id for unknowns).
  const buyerOptions = useMemo(() => {
    const creators = [...new Set(
      orders
        .map((o) => (o as PurchaseOrder & { created_by_user_id?: string | null }).created_by_user_id)
        .filter((id): id is string => !!id)
    )];
    return [
      { value: 'mine', label: 'Created by me' },
      ...creators
        .map((id) => ({ value: id, label: peopleNames[id] || `Unknown (${id.slice(0, 8)})` }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [orders, peopleNames]);

  const filterConfig = [
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'draft', label: 'Draft' },
        { value: 'sent', label: 'Sent' },
        { value: 'partially_received', label: 'Partially Received' },
        { value: 'received', label: 'Received' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
    {
      key: 'buyer',
      label: 'Buyer',
      type: 'select' as const,
      options: buyerOptions,
    },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Purchase Orders"
          description="Manage purchase orders and track vendor deliveries. Example: Create a PO for 500 tons of asphalt from Acme Materials, track delivery status, and receive partial shipments as they arrive at your yard."
          actions={
            <>
              {!help.show && <HowThisWorksButton onClick={help.open} />}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowReceiveQR(true)}
                  className="px-4 py-2 border border-primary text-primary rounded-md hover:bg-primary/10 transition-colors"
                >
                  Receive on Phone
                </button>
                <CapabilityGate capability="purchase_orders.manage">
                  <Link
                    href="/inventory/purchasing/create"
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
                  >
                    + Create PO
                  </Link>
                </CapabilityGate>
              </div>
            </>
          }
        />

        {help.show && (
          <HowItWorksCard
            title="How purchase orders work"
            onDismiss={help.dismiss}
            steps={[
              { title: 'Create the PO', body: 'Pick a vendor and ship-to location, then add lines — catalog items mapped to that vendor, or free-text items with a UOM. Save it as a draft or Create & Send in one step.' },
              { title: 'Send it to the vendor', body: 'Most vendors get a confirm-and-send email with the PO attached. Integration vendors (like Amazon Business) place the order through their own punchout flow instead. Either way the PO flips to Sent.' },
              { title: 'Receive deliveries', body: 'Log receipts as shipments arrive — partial deliveries are fine, the progress bar tracks received vs ordered. Use "Receive on Phone" to scan deliveries at the yard from a QR-linked mobile session.' },
              { title: 'Everything stays on record', body: 'Click any PO for its full story: line items, receipt history, collected documents (invoices, packing slips), AI-tracked vendor replies, and a lifecycle timeline.' },
            ]}
            legend={[
              { badge: <span className="rounded-full bg-gray-100 text-gray-700 px-2 py-0.5 text-xs font-medium">Draft</span>, text: 'not sent yet — still editable or deletable' },
              { badge: <span className="rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-xs font-medium">Sent</span>, text: 'with the vendor, awaiting delivery' },
              { badge: <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-xs font-medium">Partially Received</span>, text: 'some lines delivered, more expected' },
              { badge: <span className="rounded-full bg-green-100 text-green-700 px-2 py-0.5 text-xs font-medium">Received</span>, text: 'everything delivered' },
              { badge: <span className="rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-medium">Cancelled</span>, text: 'stopped — no further receiving' },
            ]}
            glossary={[
              { Icon: Smartphone, term: 'Receive on Phone', blurb: 'a QR code opens a tokenized mobile receiving session covering all open POs — no login needed at the dock' },
              { Icon: FileSearch, term: 'Document search', blurb: 'search the receipt repository across all POs by invoice number, tracking number, amount, or vendor' },
              { Icon: MailCheck, term: 'Vendor activity', blurb: 'AI reads vendor email replies — acknowledgements, ETAs, backorders — and pins them to the right PO' },
            ]}
          />
        )}

        <div className="max-w-md">
          <MySpendCard />
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="text-2xl font-bold text-gray-700">
              {orders.filter(o => poBucket(o.status) === 'draft').length}
            </div>
            <div className="text-sm text-gray-600">Draft</div>
          </div>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="text-2xl font-bold text-blue-700">
              {orders.filter(o => poBucket(o.status) === 'sent').length}
            </div>
            <div className="text-sm text-blue-600">Sent</div>
          </div>
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="text-2xl font-bold text-amber-700">
              {orders.filter(o => poBucket(o.status) === 'partially_received').length}
            </div>
            <div className="text-sm text-amber-600">Partially Received</div>
          </div>
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="text-2xl font-bold text-red-700">
              {orders.filter(o => {
                if (!o.expected_delivery_date) return false;
                const bucket = poBucket(o.status);
                return new Date(o.expected_delivery_date) < new Date() &&
                       bucket !== 'received' && bucket !== 'cancelled';
              }).length}
            </div>
            <div className="text-sm text-red-600">Late</div>
          </div>
        </div>

        {/* Approvals inbox banner — only when something is waiting on this user. */}
        {approvalsCount > 0 && (
          <button
            onClick={() => window.location.assign('/inventory/purchasing/approvals')}
            className="flex w-full items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-left transition-colors hover:bg-amber-100"
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
              {approvalsCount}
            </span>
            <span className="text-sm font-medium text-amber-900">
              {approvalsCount === 1 ? 'A purchase order is' : `${approvalsCount} purchase orders are`} waiting for your approval
            </span>
            <span className="ml-auto text-sm font-semibold text-amber-700">Open inbox →</span>
          </button>
        )}

        {/* Search the receipt repository (invoices, receipts, tracking, amount…). */}
        <DocumentSearchBar
          onOpenPo={(poId) => {
            const match = orders.find((o) => o.id === poId);
            if (match) setSelectedOrder(match);
          }}
        />

        <FilterBar
          filters={filterConfig}
          values={filters}
          onChange={(key, value) => setFilters((prev) => ({ ...prev, [key]: value }))}
          onClear={() => setFilters({})}
        />

        <DataTable
          data={displayedOrders}
          columns={columns}
          loading={loading}
          emptyMessage="No purchase orders found"
          rowKey={(row) => row.id}
          onRowClick={setSelectedOrder}
        />

        {selectedOrder && !showEditModal && (
          <PODetailPanel
            key={selectedOrder.id}
            po={selectedOrder}
            onClose={() => setSelectedOrder(null)}
            onChanged={fetchOrders}
            locations={locations}
            catalogItems={catalogItems}
            actions={buildRowActions(selectedOrder)}
          />
        )}

        {showCreateModal && (
          <CreatePOModal
            onClose={() => setShowCreateModal(false)}
            onCreated={() => {
              setShowCreateModal(false);
              fetchOrders();
            }}
            onCreatedAndSend={(poId) => {
              setShowCreateModal(false);
              // Hand off to the vendor-aware send path once the row loads.
              setPendingSendPoId(poId);
              fetchOrders();
            }}
            onAddVendor={() => setShowVendorModal(true)}
            newVendorId={pendingVendorId}
          />
        )}

        {showEditModal && selectedOrder && (
          <EditPOModal
            po={selectedOrder}
            onClose={() => {
              setShowEditModal(false);
              setSelectedOrder(null);
            }}
            onUpdated={() => {
              setShowEditModal(false);
              setSelectedOrder(null);
              fetchOrders();
            }}
            onAddVendor={() => setShowVendorModal(true)}
            newVendorId={pendingVendorId}
          />
        )}

        {showPlaceOrderModal && placeOrderPO && (
          <PlaceOrderModal
            open={showPlaceOrderModal}
            onClose={() => {
              setShowPlaceOrderModal(false);
              setPlaceOrderPO(null);
              setResumePunchoutId(null);
            }}
            po={placeOrderPO as unknown as POType}
            onSuccess={() => {
              setShowPlaceOrderModal(false);
              setPlaceOrderPO(null);
              setResumePunchoutId(null);
              fetchOrders();
            }}
            initialPunchoutOrderId={resumePunchoutId}
          />
        )}

        {/* Send-confirm step: emails the PO, then flips it to "Sent". Shared by
            the row/detail "Send PO" action and the create modal's Create & Send. */}
        <SendPOEmailModal
          open={!!sendPoId}
          poId={sendPoId}
          onClose={() => setSendPoId(null)}
          onSent={() => {
            if (sendPoId) markPoSent(sendPoId);
          }}
        />

        {/* QR for phone receiving — tenant-wide session covering all open POs. */}
        <ReceiveMobileQRDialog
          isOpen={showReceiveQR}
          onClose={() => setShowReceiveQR(false)}
        />

        <ReceivePOModal
          open={!!receivePO}
          po={receivePO}
          catalogItems={catalogItems}
          onClose={() => setReceivePO(null)}
          onReceived={() => {
            setSelectedOrder(null);
            fetchOrders();
          }}
        />

        <VendorModal
          open={showVendorModal}
          onClose={() => setShowVendorModal(false)}
          onSuccess={({ id }) => {
            setShowVendorModal(false);
            // The new vendor's id auto-selects it once the dropdown reloads.
            setPendingVendorId(id);
          }}
        />
      </div>
    </AppShell>
  );
}

function PODetailPanel({
  po,
  onClose,
  onChanged,
  locations,
  catalogItems,
  actions,
}: {
  po: PurchaseOrder;
  onClose: () => void;
  onChanged: () => void;
  locations: Map<string, string>;
  catalogItems: Map<string, any>;
  actions: RowActionItem[];
}) {
  const uomLabels = useUOMLabelMap();
  const [receipts, setReceipts] = useState<Array<{
    id: string;
    receipt_number: string;
    received_at: string;
    location_id?: string;
    locations?: { name: string };
    users?: { email: string };
    receipt_lines?: Array<{
      catalog_item_id: string;
      qty_received: number;
      catalog_items?: { name: string };
    }>;
  }>>([]);
  const [loadingReceipts, setLoadingReceipts] = useState(true);

  // The parent list is fetched once, but a PO's lines/status can change AFTER
  // the panel is open — most notably Amazon's order-confirmation webhook lands
  // server-to-server several minutes after the order is placed and reprices the
  // lines to Amazon's authoritative total. Re-read the header + lines on open
  // and poll while the order is still in a confirmable window so the panel shows
  // the corrected price instead of whatever was typed at creation.
  const [livePo, setLivePo] = useState<PurchaseOrder>(po);
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);

  useEffect(() => {
    setLivePo(po);
    setConfirmedTotal(null);
    setConfirmedAt(null);
    let alive = true;
    const client = createBrowserAuthedClient();
    const sc = client.schema('supply_chain');
    const inv = client.schema('inventory');

    const refetch = async () => {
      const [{ data: header }, { data: lines }, { data: order }] = await Promise.all([
        sc.from('purchase_orders').select('*').eq('id', po.id).maybeSingle(),
        sc.from('purchase_order_lines').select('*').eq('po_id', po.id).order('line_number'),
        inv
          .from('punchout_orders')
          .select('metadata')
          .eq('purchase_order_id', po.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (!alive) return;
      if (header) {
        setLivePo((prev) => ({
          ...prev,
          ...(header as PurchaseOrder),
          purchase_order_lines: (lines as PurchaseOrder['purchase_order_lines']) ?? prev.purchase_order_lines,
        }));
      }
      const conf = (order as any)?.metadata?.order_confirmation;
      if (conf && conf.rejected !== true && conf.items_total != null) {
        setConfirmedTotal(Number(conf.items_total));
        setConfirmedAt(conf.received_at ?? null);
      }
    };

    refetch();

    // Poll only while the order is still in a confirmable window — the
    // pre-receipt buckets (draft, sent). Once the PO is received (even
    // partially) or cancelled, Amazon can no longer re-confirm/reprice it,
    // so the single refetch on open above is enough.
    const bucket = poBucket(po.status);
    if (bucket !== 'draft' && bucket !== 'sent') return () => { alive = false; };
    const timer = setInterval(refetch, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [po.id, po.status]);

  useEffect(() => {
    fetchReceipts();
  }, [po.id]);

  const fetchReceipts = async () => {
    setLoadingReceipts(true);
    try {
      const data = await SupplyChainRPC.getReceipts({ po_id: po.id });
      setReceipts(data || []);
    } catch (error) {
      console.error('Error fetching receipts:', error);
    } finally {
      setLoadingReceipts(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-[28rem] bg-white shadow-xl border-l z-40 overflow-y-auto">
      <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-white">
        <h3 className="font-semibold">PO Details</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
      </div>

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium text-lg">{po.po_number}</span>
          <StatusChip status={poStatusChipLabel(livePo.status)} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Vendor</div>
            <div className="font-medium">{po.vendor_name_snapshot || '-'}</div>
            {po.vendor_code_snapshot && (
              <div className="text-xs text-muted-foreground font-mono">{po.vendor_code_snapshot}</div>
            )}
          </div>
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Ship To</div>
            <div className="font-medium">{locations.get(po.delivery_location_id || '') || po.delivery_location_id || 'N/A'}</div>
          </div>
        </div>

        {po.expected_delivery_date && (
          <div className="p-3 bg-muted/30 rounded-lg">
            <div className="text-xs text-muted-foreground">Expected Delivery</div>
            <div className="font-medium">{new Date(po.expected_delivery_date).toLocaleDateString()}</div>
          </div>
        )}

        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="font-medium">Line Items</h4>
            {confirmedTotal != null && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-xs text-green-700"
                title={confirmedAt ? `Confirmed ${new Date(confirmedAt).toLocaleString()}` : 'Confirmed by Amazon'}
              >
                ✓ Amazon confirmed ${confirmedTotal.toFixed(2)}
              </span>
            )}
          </div>
          <div className="space-y-2">
            {livePo.purchase_order_lines?.map((line) => {
              const item = line.catalog_item_id ? catalogItems.get(line.catalog_item_id) : undefined;
              return (
                <div key={line.id} className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center justify-between mb-1">
                    <div className="font-medium">{item?.name || line.item_description || 'Unknown Item'}</div>
                    <StatusChip status={line.status} size="sm" />
                  </div>
                  <div className="text-xs text-muted-foreground mb-2">
                    {item?.sku} | {uomLabels[(item as any)?.uom_term_id] || (item as any)?.uom_term_id || '-'}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Ordered</div>
                      <div className="font-mono">{line.qty_ordered}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Received</div>
                      <div className="font-mono">{line.qty_received}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Unit Cost</div>
                      <div className="font-mono">${Number(line.unit_cost || 0).toFixed(2)}</div>
                    </div>
                  </div>
                </div>
              );
            }) || <p className="text-muted-foreground text-sm">No items</p>}
          </div>
        </div>

        {po.notes && (
          <div className="border-t pt-4">
            <h4 className="font-medium mb-2">Notes</h4>
            <p className="text-sm text-muted-foreground">{po.notes}</p>
          </div>
        )}

        <div className="border-t pt-4">
          <h4 className="font-medium mb-3">Receipt History</h4>
          {loadingReceipts ? (
            <div className="p-3 bg-muted/30 rounded-lg animate-pulse">
              <div className="h-4 bg-muted rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-muted rounded w-1/2"></div>
            </div>
          ) : receipts.length > 0 ? (
            <div className="space-y-2">
              {receipts.map((receipt) => {
                const locationLabel =
                  receipt.locations?.name ||
                  (receipt.location_id
                    ? locations.get(receipt.location_id) || receipt.location_id
                    : 'Unknown');

                return (
                  <div key={receipt.id} className="p-3 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-sm font-medium">{receipt.receipt_number}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(receipt.received_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mb-2">
                      Location: {locationLabel}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No receipts yet</p>
          )}
        </div>

        {/* Unified lifecycle timeline: milestones, shipments, receipts, docs. */}
        <PurchaseTimeline poId={po.id} />

        {/* Receipt repository: collected receipts/invoices/shipping docs + reconcile. */}
        <PurchaseDocuments poId={po.id} onChanged={onChanged} />

        {/* AI-tracked vendor replies (acknowledgements, ETAs, backorders, …). */}
        <PurchaseOrderActivity poId={po.id} onChanged={onChanged} />

        <div className="border-t pt-4">
          <div className="flex flex-col gap-2">
            {actions.length === 0 ? (
              <div className="w-full px-4 py-2 text-center text-muted-foreground bg-muted/30 rounded-md">
                No actions available
              </div>
            ) : (
              actions.map((action) => (
                <button
                  key={action.key}
                  onClick={action.onClick}
                  className={
                    action.variant === 'danger'
                      ? 'w-full px-4 py-2 border border-red-300 text-red-700 rounded-md hover:bg-red-50'
                      : action.key === 'receive' || action.key === 'send' || action.key === 'resend'
                      ? 'w-full px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90'
                      : 'w-full px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50'
                  }
                >
                  {action.label}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function CreatePOModal({ onClose, onCreated, onCreatedAndSend, onAddVendor, newVendorId }: { onClose: () => void; onCreated: () => void; onCreatedAndSend: (poId: string) => void; onAddVendor: () => void; newVendorId?: string | null }) {
  const { terms: uomTerms, loading: uomLoading } = useUOMTerms();
  type POLine = { catalog_item_id: string; item_description: string; uom_term_id: string; qty: string; unit_cost: string };
  const emptyLine: POLine = { catalog_item_id: '', item_description: '', uom_term_id: '', qty: '', unit_cost: '' };
  // No expected-delivery input at create time — you can't know a delivery
  // date for an order you're placing right now; it's set on the PO later.
  const [form, setForm] = useState({
    vendor_id: '',
    ship_to_location_id: '',
    notes: '',
    lines: [{ ...emptyLine }],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [vendors, setVendors] = useState<Array<{ id: string; name: string; code: string | null; created_at: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; location_type?: { name: string } | null }>>([]);
  const [vendorItems, setVendorItems] = useState<Array<{ id: string; vendor_sku: string; unit_cost: number; catalog_items?: { id: string; sku: string; name: string } | null }>>([]);
  const [useFreetextLines, setUseFreetextLines] = useState(false);

  useEffect(() => {
    fetchVendors();
    fetchLocations();
  }, []);

  // When a new vendor is created inline, refresh and auto-select it
  useEffect(() => {
    if (!newVendorId) return;
    fetchVendors().then(() => {
      setForm((prev) => ({
        ...prev,
        vendor_id: newVendorId,
        lines: [{ ...emptyLine }],
      }));
    });
  }, [newVendorId]);

  useEffect(() => {
    if (form.vendor_id) {
      fetchVendorItems(form.vendor_id);
      setUseFreetextLines(false);
    } else {
      setVendorItems([]);
      setUseFreetextLines(false);
    }
  }, [form.vendor_id]);

  const fetchVendors = async () => {
    try {
      const data = await SupplyChainRPC.getVendors();
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchLocations = async () => {
    try {
      const data = await InventoryRPC.getLocations({ active: true });
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const fetchVendorItems = async (vendorId: string) => {
    try {
      const data = await SupplyChainRPC.getVendorItemsWithCatalog(vendorId);
      setVendorItems(data || []);
    } catch (error) {
      console.error('Error fetching vendor items:', error);
      setVendorItems([]);
    }
  };

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { ...emptyLine }],
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
    // Enter-to-submit saves a draft; "Create & Send" is an explicit button.
    await submit(false);
  };

  const submit = async (sendAfter: boolean) => {
    setSaving(true);
    setError('');

    try {
      let validLines: Array<{
        catalog_item_id?: string;
        item_description?: string;
        uom_term_id?: string;
        qty_ordered: number;
        unit_cost: number;
      }>;

      if (useFreetextLines) {
        // Free-text line items (non-catalog)
        validLines = form.lines
          .filter(l => l.item_description.trim() && l.qty)
          .map(l => ({
            item_description: l.item_description.trim(),
            uom_term_id: l.uom_term_id || undefined,
            qty_ordered: parseFloat(l.qty),
            unit_cost: parseFloat(l.unit_cost) || 0,
          }));
      } else {
        // Catalog-based line items
        validLines = form.lines
          .filter(l => l.catalog_item_id && l.qty)
          .map(l => ({
            catalog_item_id: l.catalog_item_id,
            qty_ordered: parseFloat(l.qty),
            unit_cost: parseFloat(l.unit_cost) || 0,
          }));
      }

      if (validLines.length === 0) {
        throw AppError.badRequest('Please add at least one line item');
      }

      const result = await SupplyChainRPC.createPurchaseOrder({
        vendor_id: form.vendor_id,
        delivery_location_id: form.ship_to_location_id,
        notes: form.notes || undefined,
        lines: validLines,
      });

      if (sendAfter && result?.po_id) {
        onCreatedAndSend(result.po_id);
      } else {
        onCreated();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Create Purchase Order</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">Vendor *</label>
                <button
                  type="button"
                  onClick={onAddVendor}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  + Add New
                </button>
              </div>
              <select
                value={form.vendor_id}
                onChange={(e) => {
                  if (e.target.value === '__create_new__') {
                    onAddVendor();
                    return;
                  }
                  setForm({
                    ...form,
                    vendor_id: e.target.value,
                    lines: [{ ...emptyLine }],
                  });
                }}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select a vendor...</option>
                {vendors.map(vendor => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.code ? `${vendor.code} - ${vendor.name}` : vendor.name}
                  </option>
                ))}
                <option value="__create_new__">+ Add New Vendor...</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ship To Location *</label>
              <select
                value={form.ship_to_location_id}
                onChange={(e) => setForm({ ...form, ship_to_location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select a location...</option>
                {locations.map(location => (
                  <option key={location.id} value={location.id}>
                    {location.name} ({location.location_type?.name || 'Unknown'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Line Items</h4>
              <div className="flex items-center gap-3">
                {form.vendor_id && vendorItems.length === 0 && !useFreetextLines && (
                  <span className="text-xs text-muted-foreground">No mapped items</span>
                )}
                {form.vendor_id && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseFreetextLines(!useFreetextLines);
                      setForm({ ...form, lines: [{ ...emptyLine }] });
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {useFreetextLines ? 'Use catalog items' : 'Use free-text items'}
                  </button>
                )}
                <button type="button" onClick={addLine} className="text-sm text-primary hover:underline">
                  + Add Line
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {!form.vendor_id && (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                  Select a vendor first to see available items
                </p>
              )}

              {form.vendor_id && !useFreetextLines && vendorItems.length === 0 && (
                <p className="text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded p-2">
                  No catalog items mapped to this vendor. Use &quot;free-text items&quot; to add items by description, or{' '}
                  <Link href="/inventory/vendor-items" className="font-medium underline hover:text-blue-700">
                    Map items for this vendor →
                  </Link>
                </p>
              )}

              {form.lines.map((line, index) => (
                <div key={index} className="flex gap-2 items-center">
                  {useFreetextLines ? (
                    <>
                      <input
                        type="text"
                        value={line.item_description}
                        onChange={(e) => updateLine(index, 'item_description', e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Item description..."
                      />
                      <select
                        value={line.uom_term_id}
                        onChange={(e) => updateLine(index, 'uom_term_id', e.target.value)}
                        className="w-24 shrink-0 px-2 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                      >
                        <option value="">UOM</option>
                        {uomLoading ? (
                          <option disabled>...</option>
                        ) : (
                          uomTerms.map((t) => (
                            <option key={t.term_id} value={t.term_id}>{t.label}</option>
                          ))
                        )}
                      </select>
                    </>
                  ) : (
                    <select
                      value={line.catalog_item_id}
                      onChange={(e) => {
                        const selectedItem = vendorItems.find(vi => vi.catalog_items?.id === e.target.value);

                        const newLines = [...form.lines];
                        newLines[index] = {
                          ...newLines[index],
                          catalog_item_id: e.target.value,
                          unit_cost: selectedItem?.unit_cost ? selectedItem.unit_cost.toString() : newLines[index].unit_cost,
                        };
                        setForm({ ...form, lines: newLines });
                      }}
                      className="flex-1 min-w-0 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={!form.vendor_id}
                    >
                      <option value="">Select an item...</option>
                      {vendorItems.map(vi => (
                        <option key={vi.id} value={vi.catalog_items?.id}>
                          {vi.vendor_sku} - {vi.catalog_items?.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="number"
                    value={line.qty}
                    onChange={(e) => updateLine(index, 'qty', e.target.value)}
                    className="w-20 shrink-0 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Qty"
                    min="0"
                    step="0.01"
                  />
                  <input
                    type="number"
                    value={line.unit_cost}
                    onChange={(e) => updateLine(index, 'unit_cost', e.target.value)}
                    className="w-24 shrink-0 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="$/unit"
                    step="0.01"
                    min="0"
                  />
                  {form.lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(index)} className="text-red-500 hover:text-red-700">
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
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 border border-primary text-primary rounded-md hover:bg-primary/10 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save as Draft'}
            </button>
            <button
              type="button"
              onClick={() => submit(true)}
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Creating…' : 'Create & Send →'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditPOModal({ po, onClose, onUpdated, onAddVendor, newVendorId }: { po: PurchaseOrder; onClose: () => void; onUpdated: () => void; onAddVendor: () => void; newVendorId?: string | null }) {
  const { terms: uomTerms, loading: uomLoading } = useUOMTerms();
  const emptyLine = { id: '', catalog_item_id: '', item_description: '', uom_term_id: '', qty: '', unit_cost: '' };
  const [form, setForm] = useState({
    vendor_id: po.vendor_id || '',
    ship_to_location_id: po.delivery_location_id || '',
    expected_delivery_date: po.expected_delivery_date || '',
    notes: po.notes || '',
    lines: po.purchase_order_lines?.map(line => ({
      id: line.id,
      catalog_item_id: line.catalog_item_id ?? '',
      item_description: line.item_description ?? '',
      uom_term_id: line.uom_term_id ?? '',
      qty: line.qty_ordered.toString(),
      unit_cost: line.unit_cost.toString(),
    })) || [{ ...emptyLine }],
  });
  // Free-text mode if any existing line has no catalog item. The PO builder
  // produces all-catalog or all-free-text POs, so this round-trips correctly.
  const [useFreetextLines, setUseFreetextLines] = useState(
    !!po.purchase_order_lines?.some(l => !l.catalog_item_id),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [vendors, setVendors] = useState<Array<{ id: string; name: string; code: string | null }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; location_type?: { name: string } | null }>>([]);
  const [vendorItems, setVendorItems] = useState<Array<{ id: string; vendor_sku: string; unit_cost: number; catalog_items?: { id: string; sku: string; name: string } | null }>>([]);

  useEffect(() => {
    fetchVendors();
    fetchLocations();
    if (form.vendor_id) {
      fetchVendorItems(form.vendor_id);
    }
  }, []);

  // Auto-select newly created vendor
  useEffect(() => {
    if (!newVendorId) return;
    fetchVendors().then(() => {
      setForm((prev) => ({
        ...prev,
        vendor_id: newVendorId,
        lines: [{ ...emptyLine }],
      }));
    });
  }, [newVendorId]);

  useEffect(() => {
    if (form.vendor_id && form.vendor_id !== po.vendor_id) {
      fetchVendorItems(form.vendor_id);
    }
  }, [form.vendor_id]);

  const fetchVendors = async () => {
    try {
      const data = await SupplyChainRPC.getVendors();
      setVendors(data || []);
    } catch (error) {
      console.error('Error fetching vendors:', error);
    }
  };

  const fetchLocations = async () => {
    try {
      const data = await InventoryRPC.getLocations({ active: true });
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  const fetchVendorItems = async (vendorId: string) => {
    try {
      const data = await SupplyChainRPC.getVendorItemsWithCatalog(vendorId);
      setVendorItems(data || []);
    } catch (error) {
      console.error('Error fetching vendor items:', error);
      setVendorItems([]);
    }
  };

  const addLine = () => {
    setForm({
      ...form,
      lines: [...form.lines, { ...emptyLine }],
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
      // Build either free-text lines (item_description + uom) or catalog lines,
      // matching how the order was originally created.
      let validLines: Array<{
        id?: string;
        catalog_item_id?: string;
        item_description?: string;
        uom_term_id?: string;
        qty_ordered: number;
        unit_cost: number;
      }>;

      if (useFreetextLines) {
        validLines = form.lines
          .filter(l => l.item_description.trim() && l.qty)
          .map(l => ({
            id: l.id || undefined,
            item_description: l.item_description.trim(),
            uom_term_id: l.uom_term_id || undefined,
            qty_ordered: parseFloat(l.qty),
            unit_cost: parseFloat(l.unit_cost) || 0,
          }));
      } else {
        validLines = form.lines
          .filter(l => l.catalog_item_id && l.qty)
          .map(l => ({
            id: l.id || undefined,
            catalog_item_id: l.catalog_item_id,
            qty_ordered: parseFloat(l.qty),
            unit_cost: parseFloat(l.unit_cost) || 0,
          }));
      }

      if (validLines.length === 0) {
        throw AppError.badRequest('Please add at least one line item');
      }

      const { error } = await updatePurchaseOrder(po.id, po.last_event_id, {
        vendor_id: form.vendor_id,
        delivery_location_id: form.ship_to_location_id,
        needed_by_date: form.expected_delivery_date || null,
        notes: form.notes || null,
        lines: validLines,
      });

      if (error) {
        throw AppError.internal(error.message);
      }

      onUpdated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">Edit PO - {po.po_number}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">Vendor *</label>
                <button
                  type="button"
                  onClick={onAddVendor}
                  className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  + Add New
                </button>
              </div>
              <select
                value={form.vendor_id}
                onChange={(e) => {
                  if (e.target.value === '__create_new__') {
                    onAddVendor();
                    return;
                  }
                  setForm({
                    ...form,
                    vendor_id: e.target.value,
                    lines: [{ ...emptyLine }]
                  });
                }}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select a vendor...</option>
                {vendors.map(vendor => (
                  <option key={vendor.id} value={vendor.id}>
                    {vendor.code ? `${vendor.code} - ${vendor.name}` : vendor.name}
                  </option>
                ))}
                <option value="__create_new__">+ Add New Vendor...</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Ship To Location *</label>
              <select
                value={form.ship_to_location_id}
                onChange={(e) => setForm({ ...form, ship_to_location_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                required
              >
                <option value="">Select a location...</option>
                {locations.map(location => (
                  <option key={location.id} value={location.id}>
                    {location.name} ({location.location_type?.name || 'Unknown'})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Expected Delivery <span className="text-gray-400 font-normal">(optional)</span></label>
            <input
              type="date"
              value={form.expected_delivery_date}
              onChange={(e) => setForm({ ...form, expected_delivery_date: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium">Line Items</h4>
              <div className="flex items-center gap-3">
                {form.vendor_id && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseFreetextLines(!useFreetextLines);
                      setForm({ ...form, lines: [{ ...emptyLine }] });
                    }}
                    className="text-xs text-blue-600 hover:text-blue-700 font-medium"
                  >
                    {useFreetextLines ? 'Use catalog items' : 'Use free-text items'}
                  </button>
                )}
                <button type="button" onClick={addLine} className="text-sm text-primary hover:underline">
                  + Add Line
                </button>
              </div>
            </div>
            <div className="space-y-2">
              {!form.vendor_id && (
                <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded p-2">
                  Select a vendor first to see available items
                </p>
              )}

              {form.vendor_id && !useFreetextLines && vendorItems.length === 0 && (
                <p className="text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded p-2">
                  No catalog items mapped to this vendor. Use &quot;free-text items&quot; to add items by description, or{' '}
                  <Link href="/inventory/vendor-items" className="font-medium underline hover:text-blue-700">
                    Map items for this vendor →
                  </Link>
                </p>
              )}

              {form.lines.map((line, index) => (
                <div key={index} className="flex gap-2 items-center">
                  {useFreetextLines ? (
                    <>
                      <input
                        type="text"
                        value={line.item_description}
                        onChange={(e) => updateLine(index, 'item_description', e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                        placeholder="Item description..."
                      />
                      <select
                        value={line.uom_term_id}
                        onChange={(e) => updateLine(index, 'uom_term_id', e.target.value)}
                        className="w-24 shrink-0 px-2 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                      >
                        <option value="">UOM</option>
                        {uomLoading ? (
                          <option disabled>...</option>
                        ) : (
                          uomTerms.map((t) => (
                            <option key={t.term_id} value={t.term_id}>{t.label}</option>
                          ))
                        )}
                      </select>
                    </>
                  ) : (
                    <select
                      value={line.catalog_item_id}
                      onChange={(e) => {
                        const selectedItem = vendorItems.find(vi => vi.catalog_items?.id === e.target.value);
                        updateLine(index, 'catalog_item_id', e.target.value);
                        if (selectedItem?.unit_cost && !line.unit_cost) {
                          updateLine(index, 'unit_cost', selectedItem.unit_cost.toString());
                        }
                      }}
                      className="flex-1 min-w-0 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                      disabled={!form.vendor_id}
                    >
                      <option value="">Select an item...</option>
                      {vendorItems.map(vi => (
                        <option key={vi.id} value={vi.catalog_items?.id}>
                          {vi.vendor_sku} - {vi.catalog_items?.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <input
                    type="number"
                    value={line.qty}
                    onChange={(e) => updateLine(index, 'qty', e.target.value)}
                    className="w-20 shrink-0 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Qty"
                    min="0"
                    step="0.01"
                  />
                  <input
                    type="number"
                    value={line.unit_cost}
                    onChange={(e) => updateLine(index, 'unit_cost', e.target.value)}
                    className="w-24 shrink-0 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="$/unit"
                    step="0.01"
                    min="0"
                  />
                  {form.lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(index)} className="text-red-500 hover:text-red-700">
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
            />
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">
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
        </form>
      </div>
    </div>
  );
}
