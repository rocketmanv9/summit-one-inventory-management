'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppError } from '@rocketmanv9/chassis/errors';
import { AppShell } from '@/components/layout/AppShell';
import { CapabilityGate } from '@/components/access/CapabilityGate';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageHeader } from '@/components/ui/PageHeader';
import { SubTabs } from '@/components/ui/SubTabs';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { geocodeAddress } from '@/lib/geocode';
import { apiErrorMessage, errMessage } from '@/lib/client-errors';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { VendorModal } from '@/components/vendors/VendorModal';
import { VendorQuickAddModal } from '@/components/vendors/VendorQuickAddModal';
import { VendorLocationsMap } from '@/components/vendors/VendorLocationsMap';
import type { VendorDraft } from '@/lib/vendor-draft';
import { HowItWorksCard, HowThisWorksButton, useHowItWorks } from '@/components/ui/HowItWorksCard';
import { Globe, Library, MapPin, Sparkles } from 'lucide-react';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

interface Vendor {
  id: string;
  name: string;
  vendor_type_id: string | null;
  account_number: string | null;
  payment_terms: string | null;
  description: string | null;
  notes: string | null;
  is_active: boolean;
  is_custom: boolean;
  tags: string[] | null;
  metadata?: Record<string, unknown> | null;
  code?: string | null;
  // 'gv' = global-values catalog vendor (editable here); 'supply_chain' =
  // inventory/PO + integration vendor (e.g. Amazon Business) shown read-only.
  __source?: 'gv' | 'supply_chain';
}

interface VendorAddress {
  id: string;
  vendor_id: string;
  address_type: 'billing' | 'shipping' | 'general';
  label: string | null;
  street1: string | null;
  street2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface VendorContact {
  id: string;
  vendor_id: string;
  is_primary: boolean;
  name: string | null;
  email: string | null;
  phone: string | null;
  title: string | null;
}

/** A tenant location ("my location") in the proximity picker. */
interface MyLocation {
  id: string;
  name: string;
  latitude?: number | null;
  longitude?: number | null;
  location_type?: { name: string } | null;
}

/** A vendor address ranked by distance from a chosen tenant location. */
interface RankedAddress extends VendorAddress {
  latitude: number | null;
  longitude: number | null;
  distance_mi: number | null;
}

interface VendorWithRelations extends Vendor {
  contacts: VendorContact[];
  addresses: VendorAddress[];
}

interface CatalogVendor {
  id: string;
  name: string;
  description: string | null;
  metadata?: Record<string, unknown> | null;
  industry_tags?: string[];
}

type ActiveTab = 'my-vendors' | 'catalog';

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

export default function VendorsPage() {
  const help = useHowItWorks('inventory-vendors-help');
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ActiveTab>('my-vendors');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [catalogVendors, setCatalogVendors] = useState<CatalogVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  // Default to active — inactive vendors are one filter flip away, with a
  // Reactivate action ("Remove" only deactivates, nothing is ever deleted).
  const [filters, setFilters] = useState<Record<string, string>>({ status: 'active' });
  const [industryFilter, setIndustryFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showQuickAdd, setShowQuickAdd] = useState(false);
  // Draft handed off from discovery's "Review & edit" → opens the full form.
  const [draftVendor, setDraftVendor] = useState<VendorDraft | null>(null);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [adopting, setAdopting] = useState(false);
  const [notesVendor, setNotesVendor] = useState<Vendor | null>(null);
  const [detailVendorId, setDetailVendorId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Vendor | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState('');

  /* ---- Fetching ---- */

  const fetchVendors = async () => {
    setLoading(true);
    try {
      // Unified: the tenant's own vendors live in supply_chain.vendors (used by
      // items/POs). GV is just the browse catalog (the Catalog tab + adopt).
      // active_only=false so the Status filter can surface inactive vendors
      // for reactivation ("Remove" is a soft-deactivate, not a delete).
      const res = await fetch('/api/inventory/vendors?active_only=false');
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to fetch vendors'));
      const json = await res.json();
      setVendors(json.data || []);
    } catch (err) {
      console.error('Error fetching vendors:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCatalog = async () => {
    setCatalogLoading(true);
    try {
      const params = new URLSearchParams();
      if (industryFilter) params.set('industry', industryFilter);
      const res = await fetch(`/api/gv/vendors/catalog?${params.toString()}`);
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to fetch catalog'));
      const json = await res.json();
      setCatalogVendors(json.data || []);
    } catch (err) {
      console.error('Error fetching catalog:', err);
    } finally {
      setCatalogLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'my-vendors') {
      fetchVendors();
    } else {
      fetchCatalog();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'catalog') {
      fetchCatalog();
    }
  }, [industryFilter]);

  /* ---- Handlers ---- */

  const handleRemove = (vendor: Vendor) => {
    setRemoveError('');
    setRemoveTarget(vendor);
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError('');

    try {
      const res = await fetch(`/api/inventory/vendors/${removeTarget.id}`, {
        method: 'DELETE',
        headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      });
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to remove vendor'));
      setRemoveTarget(null);
      await fetchVendors();
    } catch (err) {
      console.error('Error removing vendor:', err);
      setRemoveError(errMessage(err, 'Failed to remove vendor'));
    } finally {
      setRemoving(false);
    }
  };

  // Bring a deactivated vendor back — "Remove" is a soft-deactivate, so
  // reactivation is just flipping active on the same row.
  const handleReactivate = async (vendor: Vendor) => {
    try {
      const res = await fetch(`/api/inventory/vendors/${vendor.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ is_active: true }),
      });
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to reactivate vendor'));
      await fetchVendors();
    } catch (err) {
      console.error('Error reactivating vendor:', err);
      alert(errMessage(err, 'Failed to reactivate vendor'));
    }
  };

  const handleAdopt = async () => {
    if (selectedCatalogIds.size === 0) return;
    setAdopting(true);

    try {
      const res = await fetch('/api/inventory/vendors/adopt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify({ catalogVendorIds: Array.from(selectedCatalogIds) }),
      });
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to adopt vendors'));

      setSelectedCatalogIds(new Set());
      setActiveTab('my-vendors');
    } catch (err) {
      console.error('Error adopting vendors:', err);
      alert(errMessage(err, 'Failed to adopt selected vendors'));
    } finally {
      setAdopting(false);
    }
  };

  const toggleCatalogSelection = (id: string) => {
    setSelectedCatalogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ---- Collect unique industry tags for filter ---- */

  const allIndustryTags = Array.from(
    new Set(catalogVendors.flatMap((v) => v.industry_tags || []))
  ).sort();

  /* ---- Table config ---- */

  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: Vendor) => <span className="font-medium">{row.name}</span>,
    },
    {
      key: 'description',
      header: 'Description',
      render: (row: Vendor) => (
        <span className="text-sm text-muted-foreground truncate max-w-[250px] block">
          {row.description || '-'}
        </span>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      render: (row: Vendor) => (
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
          row.code === 'AMAZON-BIZ' ? 'bg-amber-100 text-amber-800' : 'bg-purple-100 text-purple-800'
        }`}>
          {row.code === 'AMAZON-BIZ' ? 'Amazon' : 'Vendor'}
        </span>
      ),
    },
    {
      key: 'notes',
      header: 'Notes',
      render: (row: Vendor) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {row.notes || '-'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: Vendor) => (
        <StatusChip status={row.is_active ? 'active' : 'inactive'} />
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row: Vendor) => (
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setDetailVendorId(row.id); }}
            className="px-2 py-1 text-xs bg-slate-50 text-slate-700 rounded hover:bg-slate-100"
          >
            View
          </button>
          <CapabilityGate capability="vendors.manage">
            <button
              onClick={(e) => { e.stopPropagation(); setEditingVendor(row); }}
              className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100"
            >
              Edit
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setNotesVendor(row); }}
              className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
            >
              Notes
            </button>
            {row.is_active ? (
              <button
                onClick={(e) => { e.stopPropagation(); handleRemove(row); }}
                className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
              >
                Remove
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); handleReactivate(row); }}
                className="px-2 py-1 text-xs bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100"
              >
                Reactivate
              </button>
            )}
          </CapabilityGate>
        </div>
      ),
    },
  ];

  const filterConfig = [
    { key: 'search', label: 'Search', type: 'search' as const, placeholder: 'Vendor name...' },
    {
      key: 'status',
      label: 'Status',
      type: 'select' as const,
      options: [
        { value: 'active', label: 'Active' },
        { value: 'inactive', label: 'Inactive' },
        { value: 'all', label: 'All' },
      ],
    },
  ];

  const filteredVendors = vendors.filter((vendor) => {
    const status = filters.status || 'active';
    if (status === 'active' && !vendor.is_active) return false;
    if (status === 'inactive' && vendor.is_active) return false;
    if (filters.search) return vendor.name.toLowerCase().includes(filters.search.toLowerCase());
    return true;
  });

  /* ---- Render ---- */

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title="Vendors"
          description="Browse and adopt vendors from the shared platform catalog, or add custom vendor entries."
          actions={
            <>
              {!help.show && <HowThisWorksButton onClick={help.open} />}
              {activeTab === 'my-vendors' ? (
              <CapabilityGate capability="vendors.manage">
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="px-4 py-2 border border-primary text-primary rounded-md hover:bg-primary/5 transition-colors"
                  >
                    + Add Custom
                  </button>
                  <button
                    onClick={() => setShowQuickAdd(true)}
                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="h-4 w-4" /> Quick Add
                  </button>
                </div>
              </CapabilityGate>
            ) : selectedCatalogIds.size > 0 ? (
              <CapabilityGate capability="vendors.manage">
                <button
                  onClick={handleAdopt}
                  disabled={adopting}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {adopting ? 'Adding...' : `Add Selected (${selectedCatalogIds.size})`}
                </button>
              </CapabilityGate>
              ) : null}
            </>
          }
        />

        {help.show && (
          <HowItWorksCard
            title="How vendors work"
            onDismiss={help.dismiss}
            steps={[
              { title: 'Build your vendor list', body: 'Quick Add is the fastest path: type a vendor name (or paste their website) and AI fills in the whole record — code, website, email domains, type, and description — ready to save in one click. Don’t know who sells it? Same box: describe what you need ("sealcoat supplier near Salem") and Search the web returns real suppliers to pick from. You can also adopt ready-made vendors from the shared Catalog tab (contacts and addresses come along), or add a fully custom entry.' },
              { title: 'Fill in the details', body: 'Each vendor holds contacts, notes, and one or more addresses. Addresses are geocoded automatically so they show on the map and can be ranked by distance.' },
              { title: 'Put them to work', body: 'Your vendors power the rest of purchasing — they appear in PO creation, vendor item pricing, and performance analytics. Click a row for the full vendor profile.' },
              { title: 'Find the closest branch', body: 'The Proximity tab ranks a vendor’s locations against one of your own sites, so you always order from the nearest plant or store.' },
            ]}
            legendTitle="Badges"
            legend={[
              { badge: <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">Vendor</span>, text: 'a regular vendor you added or adopted' },
              { badge: <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">Amazon</span>, text: 'the Amazon Business integration vendor — orders go through punchout' },
            ]}
            glossary={[
              { Icon: Sparkles, term: 'Quick Add', blurb: 'type a vendor name or paste their website — AI fills in the record, including the email domains that match incoming vendor emails to item suggestions' },
              { Icon: Globe, term: 'Search the web', blurb: 'inside Quick Add: describe what you need in plain language and AI searches the web for matching suppliers to pick from' },
              { Icon: Library, term: 'Catalog', blurb: 'the shared platform catalog of known suppliers — adopt them into your list with one click' },
              { Icon: MapPin, term: 'Proximity', blurb: 'distance ranking between a vendor’s addresses and your own locations — requires geocoded addresses' },
            ]}
          />
        )}

        {/* Tabs */}
        <SubTabs
          value={activeTab}
          onChange={setActiveTab}
          tabs={[
            { value: 'my-vendors', label: 'My Vendors' },
            { value: 'catalog', label: 'Catalog' },
          ]}
        />

        {/* My Vendors tab */}
        {activeTab === 'my-vendors' && (
          <>
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
              emptyMessage="No vendors yet. Add from the catalog or create a custom entry."
              rowKey={(row) => row.id}
              onRowClick={(row) => router.push(`/inventory/vendors/${row.id}`)}
            />
          </>
        )}

        {/* Catalog tab */}
        {activeTab === 'catalog' && (
          <>
            {/* Industry tag filter */}
            {allIndustryTags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-muted-foreground">Industry:</span>
                <button
                  onClick={() => setIndustryFilter('')}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    !industryFilter
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border hover:bg-muted/30'
                  }`}
                >
                  All
                </button>
                {allIndustryTags.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setIndustryFilter(tag === industryFilter ? '' : tag)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      industryFilter === tag
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-card text-muted-foreground border-border hover:bg-muted/30'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}

            {catalogLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                Loading catalog...
              </div>
            ) : catalogVendors.length === 0 ? (
              <div className="rounded-lg border bg-card p-12 text-center">
                <p className="text-muted-foreground">No catalog vendors available.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {catalogVendors.map((cv) => (
                  <label
                    key={cv.id}
                    className={`flex items-start gap-4 p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedCatalogIds.has(cv.id)
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-card hover:bg-muted/30'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedCatalogIds.has(cv.id)}
                      onChange={() => toggleCatalogSelection(cv.id)}
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{cv.name}</span>
                        {cv.metadata && typeof cv.metadata === 'object' && 'website' in cv.metadata && typeof (cv.metadata as Record<string, unknown>).website === 'string' && (
                          <a
                            href={(cv.metadata as Record<string, string>).website}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            {(cv.metadata as Record<string, string>).website}
                          </a>
                        )}
                      </div>
                      {cv.description && (
                        <div className="text-sm text-muted-foreground mt-0.5 line-clamp-2">
                          {cv.description}
                        </div>
                      )}
                      {cv.industry_tags && cv.industry_tags.length > 0 && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                          {cv.industry_tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-700"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        {/* Add / Edit Vendor Modal */}
        {(showAddModal || editingVendor || draftVendor) && (
          <VendorModal
            open
            vendor={editingVendor}
            initialDraft={draftVendor}
            onClose={() => { setShowAddModal(false); setEditingVendor(null); setDraftVendor(null); }}
            onSuccess={() => { setShowAddModal(false); setEditingVendor(null); setDraftVendor(null); fetchVendors(); }}
          />
        )}

        {/* Quick Add — AI-prefilled vendor from a name/website, or web search
            for suppliers by describing what you need (absorbed Find Online). */}
        {showQuickAdd && (
          <VendorQuickAddModal
            open
            existingNames={vendors.map((v) => v.name)}
            onClose={() => setShowQuickAdd(false)}
            onSuccess={() => { setShowQuickAdd(false); fetchVendors(); }}
            onReview={(draft) => { setShowQuickAdd(false); setDraftVendor(draft); }}
            onUseExisting={(v) => { setShowQuickAdd(false); router.push(`/inventory/vendors/${v.id}`); }}
          />
        )}

        {/* Notes Modal */}
        {notesVendor && (
          <NotesModal
            item={notesVendor}
            entityLabel="vendor"
            endpoint={`/api/inventory/vendors/${notesVendor.id}`}
            onClose={() => setNotesVendor(null)}
            onSaved={() => { setNotesVendor(null); fetchVendors(); }}
          />
        )}

        {/* Vendor Detail Modal */}
        {detailVendorId && (
          <VendorDetailModal
            vendorId={detailVendorId}
            onClose={() => setDetailVendorId(null)}
          />
        )}

        {/* Remove Vendor Confirmation */}
        <ConfirmDialog
          open={!!removeTarget}
          title="Remove vendor"
          message={removeTarget ? `Remove "${removeTarget.name}" from your vendors?` : ''}
          confirmLabel="Remove"
          loadingLabel="Removing..."
          destructive
          loading={removing}
          error={removeError}
          onConfirm={confirmRemove}
          onCancel={() => { setRemoveTarget(null); setRemoveError(''); }}
        />
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------- */
/*  Vendor Detail Modal                                                       */
/* -------------------------------------------------------------------------- */

function VendorDetailModal({
  vendorId,
  onClose,
}: {
  vendorId: string;
  onClose: () => void;
}) {
  const [vendor, setVendor] = useState<VendorWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<'addresses' | 'map' | 'contacts' | 'proximity'>('addresses');
  const [editingAddress, setEditingAddress] = useState<VendorAddress | null>(null);
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [editingContact, setEditingContact] = useState<VendorContact | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);
  // Pending delete confirmation for an address or contact.
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'address' | 'contact'; id: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Proximity tab: rank this vendor's addresses against one of the tenant's
  // own locations ("which of their branches is closest to my site?").
  const [myLocations, setMyLocations] = useState<MyLocation[]>([]);
  const [locSearch, setLocSearch] = useState('');
  const [selectedLocId, setSelectedLocId] = useState('');
  const [ranked, setRanked] = useState<RankedAddress[]>([]);
  const [ranking, setRanking] = useState(false);

  const fetchVendor = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/vendors/${vendorId}`);
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to fetch vendor'));
      const json = await res.json();
      setVendor(json.data || null);
    } catch (err) {
      console.error('Error fetching vendor detail:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVendor(); }, [vendorId]);

  // Load the tenant's locations once for the proximity picker.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const locs = await InventoryRPC.getLocations({ active: true });
        if (!cancelled) setMyLocations((locs || []) as MyLocation[]);
      } catch (err) {
        console.error('Error loading locations:', err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Rank the vendor's addresses against the chosen tenant location.
  useEffect(() => {
    if (!selectedLocId) { setRanked([]); return; }
    let cancelled = false;
    setRanking(true);
    (async () => {
      try {
        const res = await fetch(`/api/inventory/vendors/${vendorId}/addresses?nearest_to=${selectedLocId}`);
        if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to rank addresses'));
        const json = await res.json();
        if (!cancelled) setRanked((json.data || []) as RankedAddress[]);
      } catch (err) {
        console.error('Error ranking addresses:', err);
        if (!cancelled) setRanked([]);
      } finally {
        if (!cancelled) setRanking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedLocId, vendorId]);

  const filteredLocations = myLocations.filter((l) =>
    l.name.toLowerCase().includes(locSearch.trim().toLowerCase())
  );
  const selectedLoc = myLocations.find((l) => l.id === selectedLocId) || null;

  const handleDeleteAddress = (addressId: string) => {
    setDeleteError('');
    setDeleteTarget({ kind: 'address', id: addressId });
  };

  const handleDeleteContact = (contactId: string) => {
    setDeleteError('');
    setDeleteTarget({ kind: 'contact', id: contactId });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { kind, id } = deleteTarget;
    setDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/inventory/vendors/${vendorId}/${kind === 'address' ? 'addresses' : 'contacts'}/${id}`, {
        method: 'DELETE',
        headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      });
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, `Failed to delete ${kind}`));
      setDeleteTarget(null);
      await fetchVendor();
    } catch (err) {
      console.error(`Error deleting ${kind}:`, err);
      setDeleteError(errMessage(err, `Failed to delete ${kind}`));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">{vendor?.name || 'Loading...'}</h3>
            {vendor && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                vendor.is_custom
                  ? 'bg-purple-100 text-purple-800'
                  : 'bg-blue-100 text-blue-800'
              }`}>
                {vendor.is_custom ? 'Custom' : 'Catalog'}
              </span>
            )}
            <Link
              href={`/inventory/vendors/${vendorId}`}
              className="text-xs font-medium text-primary hover:underline whitespace-nowrap"
            >
              Full profile &rarr;
            </Link>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">X</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading vendor details...
          </div>
        ) : !vendor ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Vendor not found.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {/* Summary */}
            <div className="px-6 py-4 border-b">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Status:</span>{' '}
                  <StatusChip status={vendor.is_active ? 'active' : 'inactive'} />
                </div>
                <div>
                  <span className="text-muted-foreground">Description:</span>{' '}
                  <span className="font-medium">{vendor.description || '-'}</span>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="px-6 pt-4">
              <div className="flex gap-4 border-b">
                <button
                  onClick={() => setDetailTab('addresses')}
                  className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                    detailTab === 'addresses'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Addresses ({vendor.addresses?.length || 0})
                </button>
                <button
                  onClick={() => setDetailTab('map')}
                  className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                    detailTab === 'map'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Map
                </button>
                <button
                  onClick={() => setDetailTab('contacts')}
                  className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                    detailTab === 'contacts'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Contacts ({vendor.contacts?.length || 0})
                </button>
                <button
                  onClick={() => setDetailTab('proximity')}
                  className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                    detailTab === 'proximity'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Proximity
                </button>
              </div>
            </div>

            {/* Addresses Tab */}
            {detailTab === 'addresses' && (
              <div className="px-6 py-4 space-y-3">
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowAddAddress(true)}
                    className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                  >
                    + Add Address
                  </button>
                </div>
                {(!vendor.addresses || vendor.addresses.length === 0) ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No addresses yet.</p>
                ) : (
                  vendor.addresses.map((addr) => (
                    <div key={addr.id} className="border rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {addr.label && <span className="font-medium text-sm">{addr.label}</span>}
                          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            {addr.address_type}
                          </span>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditingAddress(addr)}
                            className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteAddress(addr.id)}
                            className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {[addr.street1, addr.street2].filter(Boolean).join(', ')}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {[addr.city, addr.state, addr.zip].filter(Boolean).join(', ')}
                        {addr.country ? ` ${addr.country}` : ''}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Map Tab — vendor's geocoded locations on a satellite map */}
            {detailTab === 'map' && (
              <div className="px-6 py-4">
                <VendorLocationsMap addresses={vendor.addresses || []} />
              </div>
            )}

            {/* Contacts Tab */}
            {detailTab === 'contacts' && (
              <div className="px-6 py-4 space-y-3">
                <div className="flex justify-end">
                  <button
                    onClick={() => setShowAddContact(true)}
                    className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                  >
                    + Add Contact
                  </button>
                </div>
                {(!vendor.contacts || vendor.contacts.length === 0) ? (
                  <p className="text-sm text-muted-foreground text-center py-6">No contacts yet.</p>
                ) : (
                  vendor.contacts.map((contact) => (
                    <div key={contact.id} className="border rounded-lg p-3 space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{contact.name || 'Unnamed'}</span>
                          {contact.is_primary && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                              Primary
                            </span>
                          )}
                          {contact.title && (
                            <span className="text-xs text-muted-foreground">{contact.title}</span>
                          )}
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setEditingContact(contact)}
                            className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteContact(contact.id)}
                            className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <div className="flex gap-4 text-sm text-muted-foreground">
                        {contact.email && <span>{contact.email}</span>}
                        {contact.phone && <span>{contact.phone}</span>}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Proximity Tab — rank this vendor's locations against my locations */}
            {detailTab === 'proximity' && (
              <div className="px-6 py-4 space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Search my locations</label>
                  <input
                    type="text"
                    value={locSearch}
                    onChange={(e) => setLocSearch(e.target.value)}
                    placeholder="Type to filter your sites…"
                    className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  {myLocations.length === 0 ? (
                    <p className="text-xs text-muted-foreground mt-2">No locations found.</p>
                  ) : (
                    <div className="mt-2 max-h-32 overflow-y-auto border rounded-md divide-y">
                      {filteredLocations.length === 0 ? (
                        <p className="text-xs text-muted-foreground px-3 py-2">No matches.</p>
                      ) : (
                        filteredLocations.map((l) => {
                          const ungeocoded = l.latitude == null || l.longitude == null;
                          return (
                            <button
                              key={l.id}
                              type="button"
                              onClick={() => setSelectedLocId(l.id)}
                              className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-gray-50 ${
                                selectedLocId === l.id ? 'bg-primary/5 font-medium' : ''
                              }`}
                            >
                              <span>
                                {l.name}
                                {l.location_type?.name && (
                                  <span className="text-muted-foreground"> ({l.location_type.name})</span>
                                )}
                              </span>
                              {ungeocoded && (
                                <span className="text-[10px] text-amber-600">no coords</span>
                              )}
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {selectedLoc && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      {vendor.name}&apos;s locations, closest to{' '}
                      <span className="font-medium text-foreground">{selectedLoc.name}</span>:
                    </p>
                    {ranking ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">Ranking…</p>
                    ) : ranked.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4 text-center">
                        This vendor has no addresses yet.
                      </p>
                    ) : (
                      ranked.map((addr, idx) => (
                        <div
                          key={addr.id}
                          className={`border rounded-lg p-3 space-y-1 ${
                            idx === 0 && addr.distance_mi != null ? 'border-primary bg-primary/5' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {addr.label && <span className="font-medium text-sm">{addr.label}</span>}
                              <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                                {addr.address_type}
                              </span>
                              {idx === 0 && addr.distance_mi != null && (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-primary text-primary-foreground">
                                  Closest
                                </span>
                              )}
                            </div>
                            <span className="text-sm font-medium whitespace-nowrap">
                              {addr.distance_mi != null ? `${addr.distance_mi.toFixed(1)} mi` : '—'}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {[addr.street1, addr.city, addr.state, addr.zip].filter(Boolean).join(', ') || 'No address details'}
                          </p>
                          {addr.distance_mi == null && (
                            <p className="text-xs text-amber-600">
                              Not geocoded — edit this address (or your location) to enable distance.
                            </p>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Address Form Modal (layered above detail) */}
      {(showAddAddress || editingAddress) && (
        <AddressFormModal
          vendorId={vendorId}
          address={editingAddress}
          onClose={() => { setShowAddAddress(false); setEditingAddress(null); }}
          onComplete={() => { setShowAddAddress(false); setEditingAddress(null); fetchVendor(); }}
        />
      )}

      {/* Contact Form Modal (layered above detail) */}
      {(showAddContact || editingContact) && (
        <ContactFormModal
          vendorId={vendorId}
          contact={editingContact}
          onClose={() => { setShowAddContact(false); setEditingContact(null); }}
          onComplete={() => { setShowAddContact(false); setEditingContact(null); fetchVendor(); }}
        />
      )}

      {/* Delete address/contact confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title={deleteTarget?.kind === 'contact' ? 'Delete contact' : 'Delete address'}
        message={deleteTarget?.kind === 'contact' ? 'Delete this contact?' : 'Delete this address?'}
        confirmLabel="Delete"
        loadingLabel="Deleting..."
        destructive
        loading={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => { setDeleteTarget(null); setDeleteError(''); }}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Address Form Modal                                                        */
/* -------------------------------------------------------------------------- */

function AddressFormModal({
  vendorId,
  address,
  onClose,
  onComplete,
}: {
  vendorId: string;
  address?: VendorAddress | null;
  onClose: () => void;
  onComplete: () => void;
}) {
  const isEdit = !!address;

  const [form, setForm] = useState({
    address_type: address?.address_type || 'general',
    label: address?.label || '',
    street1: address?.street1 || '',
    street2: address?.street2 || '',
    city: address?.city || '',
    state: address?.state || '',
    zip: address?.zip || '',
    country: address?.country || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      // Geocode so this location can be ranked by distance on purchase orders.
      let coords: { latitude: number; longitude: number } | null = null;
      const q = [form.street1, form.city, form.state, form.zip].filter(Boolean).join(', ');
      if (q) coords = await geocodeAddress(q);

      const url = isEdit
        ? `/api/inventory/vendors/${vendorId}/addresses/${address!.id}`
        : `/api/inventory/vendors/${vendorId}/addresses`;
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ ...form, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null }),
      });

      if (!res.ok) {
        throw AppError.internal(await apiErrorMessage(res, `Failed to ${isEdit ? 'update' : 'add'} address`));
      }
      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">{isEdit ? 'Edit Address' : 'Add Address'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">X</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select
                value={form.address_type}
                onChange={(e) => setForm({ ...form, address_type: e.target.value as 'billing' | 'shipping' | 'general' })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="general">General</option>
                <option value="billing">Billing</option>
                <option value="shipping">Shipping</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Label</label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="e.g. Store #1234"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Street 1</label>
            <input
              type="text"
              value={form.street1}
              onChange={(e) => setForm({ ...form, street1: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="123 Main St"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Street 2</label>
            <input
              type="text"
              value={form.street2}
              onChange={(e) => setForm({ ...form, street2: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Suite 100"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">State</label>
              <input
                type="text"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ZIP</label>
              <input
                type="text"
                value={form.zip}
                onChange={(e) => setForm({ ...form, zip: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Country</label>
            <input
              type="text"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="US"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Add Address')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Contact Form Modal                                                        */
/* -------------------------------------------------------------------------- */

function ContactFormModal({
  vendorId,
  contact,
  onClose,
  onComplete,
}: {
  vendorId: string;
  contact?: VendorContact | null;
  onClose: () => void;
  onComplete: () => void;
}) {
  const isEdit = !!contact;

  const [form, setForm] = useState({
    name: contact?.name || '',
    email: contact?.email || '',
    phone: contact?.phone || '',
    title: contact?.title || '',
    is_primary: contact?.is_primary || false,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const url = isEdit
        ? `/api/inventory/vendors/${vendorId}/contacts/${contact!.id}`
        : `/api/inventory/vendors/${vendorId}/contacts`;
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        throw AppError.internal(await apiErrorMessage(res, `Failed to ${isEdit ? 'update' : 'add'} contact`));
      }
      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[60]">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">{isEdit ? 'Edit Contact' : 'Add Contact'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">X</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="john@example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="(555) 123-4567"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Title</label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Sales Manager"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="is_primary"
              checked={form.is_primary}
              onChange={(e) => setForm({ ...form, is_primary: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
            />
            <label htmlFor="is_primary" className="text-sm font-medium">Primary contact</label>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Add Contact')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Notes Modal (shared pattern)                                              */
/* -------------------------------------------------------------------------- */

function NotesModal({
  item,
  entityLabel,
  endpoint,
  onClose,
  onSaved,
}: {
  item: { id: string; name: string; notes: string | null };
  entityLabel: string;
  endpoint: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) throw AppError.internal(await apiErrorMessage(res, `Failed to update ${entityLabel} notes`));
      onSaved();
    } catch (err) {
      console.error(`Error updating ${entityLabel} notes:`, err);
      alert(errMessage(err, 'Failed to save notes'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Notes — {item.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">X</button>
        </div>
        <div className="p-6 space-y-4">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
            rows={5}
            placeholder={`Notes about this ${entityLabel}...`}
          />
          <div className="flex gap-3">
            <button onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
