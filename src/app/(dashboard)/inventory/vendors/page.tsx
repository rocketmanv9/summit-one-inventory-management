'use client';

import { useState, useEffect } from 'react';
import { AppError } from '@rocketmanv9/chassis/errors';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterBar } from '@/components/ui/FilterBar';
import { StatusChip } from '@/components/ui/StatusChip';
import { useVendorTypeTerms } from '@/hooks/useGVTerms';

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
  const [activeTab, setActiveTab] = useState<ActiveTab>('my-vendors');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [catalogVendors, setCatalogVendors] = useState<CatalogVendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [industryFilter, setIndustryFilter] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set());
  const [adopting, setAdopting] = useState(false);
  const [notesVendor, setNotesVendor] = useState<Vendor | null>(null);
  const [detailVendorId, setDetailVendorId] = useState<string | null>(null);

  /* ---- Fetching ---- */

  const fetchVendors = async () => {
    setLoading(true);
    try {
      // Unified: the tenant's own vendors live in supply_chain.vendors (used by
      // items/POs). GV is just the browse catalog (the Catalog tab + adopt).
      const res = await fetch('/api/inventory/vendors');
      if (!res.ok) throw AppError.internal('Failed to fetch vendors');
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
      if (!res.ok) throw AppError.internal('Failed to fetch catalog');
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

  const handleRemove = async (vendor: Vendor) => {
    if (!confirm(`Remove "${vendor.name}" from your vendors?`)) return;

    try {
      const res = await fetch(`/api/inventory/vendors/${vendor.id}`, {
        method: 'DELETE',
        headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      });
      if (!res.ok) throw AppError.internal('Failed to remove vendor');
      await fetchVendors();
    } catch (err) {
      console.error('Error removing vendor:', err);
      alert('Failed to remove vendor');
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
      if (!res.ok) throw AppError.internal('Failed to adopt vendors');

      setSelectedCatalogIds(new Set());
      setActiveTab('my-vendors');
    } catch (err) {
      console.error('Error adopting vendors:', err);
      alert('Failed to adopt selected vendors');
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
          <button
            onClick={(e) => { e.stopPropagation(); handleRemove(row); }}
            className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
          >
            Remove
          </button>
        </div>
      ),
    },
  ];

  const filterConfig = [
    { key: 'search', label: 'Search', type: 'search' as const, placeholder: 'Vendor name...' },
  ];

  const filteredVendors = vendors.filter((vendor) => {
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
            activeTab === 'my-vendors' ? (
              <button
                onClick={() => setShowAddModal(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
              >
                + Add Custom
              </button>
            ) : selectedCatalogIds.size > 0 ? (
              <button
                onClick={handleAdopt}
                disabled={adopting}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {adopting ? 'Adding...' : `Add Selected (${selectedCatalogIds.size})`}
              </button>
            ) : null
          }
        />

        {/* Tabs */}
        <div className="flex gap-2 border-b">
          <button
            onClick={() => setActiveTab('my-vendors')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'my-vendors'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            My Vendors
          </button>
          <button
            onClick={() => setActiveTab('catalog')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'catalog'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Catalog
          </button>
        </div>

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

        {/* Add / Edit Custom Vendor Modal */}
        {(showAddModal || editingVendor) && (
          <AddCustomVendorModal
            vendor={editingVendor}
            onClose={() => { setShowAddModal(false); setEditingVendor(null); }}
            onComplete={() => { setShowAddModal(false); setEditingVendor(null); fetchVendors(); }}
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
  const [detailTab, setDetailTab] = useState<'addresses' | 'contacts'>('addresses');
  const [editingAddress, setEditingAddress] = useState<VendorAddress | null>(null);
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [editingContact, setEditingContact] = useState<VendorContact | null>(null);
  const [showAddContact, setShowAddContact] = useState(false);

  const fetchVendor = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/vendors/${vendorId}`);
      if (!res.ok) throw AppError.internal('Failed to fetch vendor');
      const json = await res.json();
      setVendor(json.data || null);
    } catch (err) {
      console.error('Error fetching vendor detail:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVendor(); }, [vendorId]);

  const handleDeleteAddress = async (addressId: string) => {
    if (!confirm('Delete this address?')) return;
    try {
      const res = await fetch(`/api/inventory/vendors/${vendorId}/addresses/${addressId}`, {
        method: 'DELETE',
        headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      });
      if (!res.ok) throw AppError.internal('Failed to delete address');
      await fetchVendor();
    } catch (err) {
      console.error('Error deleting address:', err);
      alert('Failed to delete address');
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!confirm('Delete this contact?')) return;
    try {
      const res = await fetch(`/api/inventory/vendors/${vendorId}/contacts/${contactId}`, {
        method: 'DELETE',
        headers: { 'X-Idempotency-Key': crypto.randomUUID() },
      });
      if (!res.ok) throw AppError.internal('Failed to delete contact');
      await fetchVendor();
    } catch (err) {
      console.error('Error deleting contact:', err);
      alert('Failed to delete contact');
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
                  <span className="text-muted-foreground">Account #:</span>{' '}
                  <span className="font-medium">{vendor.account_number || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Payment Terms:</span>{' '}
                  <span className="font-medium">{vendor.payment_terms || '-'}</span>
                </div>
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
                  onClick={() => setDetailTab('contacts')}
                  className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                    detailTab === 'contacts'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Contacts ({vendor.contacts?.length || 0})
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
      const url = isEdit
        ? `/api/inventory/vendors/${vendorId}/addresses/${address!.id}`
        : `/api/inventory/vendors/${vendorId}/addresses`;
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw AppError.internal(errJson?.error?.message || errJson?.message || `Failed to ${isEdit ? 'update' : 'add'} address`);
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
        const errJson = await res.json().catch(() => null);
        throw AppError.internal(errJson?.error?.message || errJson?.message || `Failed to ${isEdit ? 'update' : 'add'} contact`);
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
/*  Add / Edit Custom Vendor Modal                                            */
/* -------------------------------------------------------------------------- */

function AddCustomVendorModal({
  vendor,
  onClose,
  onComplete,
}: {
  vendor?: Vendor | null;
  onClose: () => void;
  onComplete: () => void;
}) {
  const isEdit = !!vendor;
  const { terms: vendorTypes, loading: typesLoading } = useVendorTypeTerms();

  const [form, setForm] = useState({
    name: vendor?.name || '',
    vendor_type_id: vendor?.vendor_type_id || '',
    description: vendor?.description || '',
    account_number: vendor?.account_number || '',
    payment_terms: vendor?.payment_terms || '',
    notes: vendor?.notes || '',
    contact_email: (vendor as any)?.contact_email || '',
    contact_phone: (vendor as any)?.contact_phone || '',
    address_line_1: (vendor as any)?.address_line_1 || '',
    city: (vendor as any)?.city || '',
    state: (vendor as any)?.state || '',
    postal_code: (vendor as any)?.postal_code || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    if (!form.vendor_type_id) {
      setError('Vendor type is required');
      setSaving(false);
      return;
    }

    try {
      const payload: Record<string, unknown> = { name: form.name, vendor_type_id: form.vendor_type_id };
      if (form.description) payload.description = form.description;
      if (form.account_number) payload.account_number = form.account_number;
      if (form.payment_terms) payload.payment_terms = form.payment_terms;
      if (form.notes) payload.notes = form.notes;
      // Contact + address — needed to email POs to the vendor. Sent on every save
      // (including blanks) so clearing a value persists.
      payload.contact_email = form.contact_email.trim() || null;
      payload.contact_phone = form.contact_phone.trim() || null;
      payload.address_line_1 = form.address_line_1.trim() || null;
      payload.city = form.city.trim() || null;
      payload.state = form.state.trim() || null;
      payload.postal_code = form.postal_code.trim() || null;

      const url = isEdit ? `/api/inventory/vendors/${vendor!.id}` : '/api/inventory/vendors';
      const method = isEdit ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw AppError.internal(errJson?.error?.message || errJson?.message || `Failed to ${isEdit ? 'update' : 'add'} vendor`);
      }
      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
        <div className="px-6 py-4 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">{isEdit ? 'Edit Vendor' : 'Add Custom Vendor'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">X</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">{error}</div>}
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="e.g. Acme Materials" required />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Vendor Type *</label>
            <select
              value={form.vendor_type_id}
              onChange={(e) => setForm({ ...form, vendor_type_id: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              <option value="">{typesLoading ? 'Loading...' : 'Select vendor type'}</option>
              {vendorTypes.map((t) => (
                <option key={t.term_id} value={t.term_id}>{t.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <input type="text" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Brief description of this vendor" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Contact Email</label>
              <input type="email" value={form.contact_email} onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="orders@vendor.com" />
              <p className="text-xs text-muted-foreground mt-1">Where purchase orders are emailed.</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Phone</label>
              <input type="tel" value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="(555) 123-4567" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <input type="text" value={form.address_line_1} onChange={(e) => setForm({ ...form, address_line_1: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Street address" />
            <div className="grid grid-cols-3 gap-2 mt-2">
              <input type="text" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="City" />
              <input type="text" value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })}
                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="State" />
              <input type="text" value={form.postal_code} onChange={(e) => setForm({ ...form, postal_code: e.target.value })}
                className="px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="ZIP" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Account Number</label>
              <input type="text" value={form.account_number} onChange={(e) => setForm({ ...form, account_number: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="e.g. ACM-001" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Payment Terms</label>
              <input type="text" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary" placeholder="e.g. Net 30" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              rows={3} placeholder="Any notes about this vendor..." />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50">
              {saving ? (isEdit ? 'Saving...' : 'Adding...') : (isEdit ? 'Save Changes' : 'Add Vendor')}
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
      if (!res.ok) throw AppError.internal(`Failed to update ${entityLabel} notes`);
      onSaved();
    } catch (err) {
      console.error(`Error updating ${entityLabel} notes:`, err);
      alert(`Failed to save notes`);
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
