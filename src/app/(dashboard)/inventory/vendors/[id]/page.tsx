'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AppError } from '@rocketmanv9/chassis/errors';
import {
  Mail,
  MapPin,
  PackageSearch,
  Phone,
  ShoppingCart,
  TrendingUp,
} from 'lucide-react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusChip } from '@/components/ui/StatusChip';
import { apiErrorMessage } from '@/lib/client-errors';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { poBucket } from '@/lib/po/po-status';

/* -------------------------------------------------------------------------- */
/*  Types (mirrors the vendors list page detail panel)                        */
/* -------------------------------------------------------------------------- */

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

interface VendorWithRelations {
  id: string;
  name: string;
  code?: string | null;
  account_number: string | null;
  payment_terms: string | null;
  description: string | null;
  notes: string | null;
  is_active: boolean;
  is_custom: boolean;
  tags: string[] | null;
  contacts: VendorContact[];
  addresses: VendorAddress[];
}

interface PoStats {
  openCount: number;
  totalCount: number;
  lastOrderDate: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Page — read-only vendor hub                                               */
/* -------------------------------------------------------------------------- */

export default function VendorHubPage() {
  const params = useParams();
  const vendorId = params.id as string;

  const [vendor, setVendor] = useState<VendorWithRelations | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [poStats, setPoStats] = useState<PoStats | null>(null);

  // Same source as the vendors list detail panel.
  useEffect(() => {
    if (!vendorId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const res = await fetch(`/api/inventory/vendors/${vendorId}`);
        if (!res.ok) throw AppError.internal(await apiErrorMessage(res, 'Failed to fetch vendor'));
        const json = await res.json();
        if (!cancelled) setVendor(json.data || null);
      } catch (err: any) {
        console.error('Error fetching vendor detail:', err);
        if (!cancelled) setLoadError(err?.message || 'Failed to fetch vendor');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vendorId]);

  // Quick stats from this vendor's purchase orders (existing client RPC).
  useEffect(() => {
    if (!vendorId) return;
    let cancelled = false;
    (async () => {
      try {
        const pos = await SupplyChainRPC.getPurchaseOrders({ vendor_id: vendorId });
        if (cancelled) return;
        const list = pos || [];
        const openCount = list.filter((po: any) =>
          ['draft', 'sent', 'partially_received'].includes(poBucket(po.status))
        ).length;
        const lastOrderDate = list.reduce<string | null>((latest, po: any) => {
          if (!po.created_at) return latest;
          return !latest || po.created_at > latest ? po.created_at : latest;
        }, null);
        setPoStats({ openCount, totalCount: list.length, lastOrderDate });
      } catch (err) {
        // Stats are best-effort — the hub still renders without them.
        console.error('Error fetching vendor PO stats:', err);
        if (!cancelled) setPoStats(null);
      }
    })();
    return () => { cancelled = true; };
  }, [vendorId]);

  const primaryContact =
    vendor?.contacts?.find((c) => c.is_primary) || vendor?.contacts?.[0] || null;

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={vendor?.name || (loading ? 'Loading...' : 'Vendor')}
          description={vendor?.description || undefined}
          backHref="/inventory/vendors"
          actions={
            <div className="flex gap-2">
              <Link
                href={`/inventory/vendors/${vendorId}/items`}
                className="px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <PackageSearch className="h-4 w-4" />
                Items from this vendor
              </Link>
              <Link
                href="/inventory/vendor-performance"
                className="px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50 transition-colors flex items-center gap-2"
              >
                <TrendingUp className="h-4 w-4" />
                Performance
              </Link>
              <Link
                href="/inventory/purchasing"
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors flex items-center gap-2"
              >
                <ShoppingCart className="h-4 w-4" />
                Create PO
              </Link>
            </div>
          }
        />

        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            Loading vendor details...
          </div>
        ) : !vendor ? (
          <div className="rounded-lg border bg-card p-12 text-center">
            <p className="text-muted-foreground">{loadError || 'Vendor not found.'}</p>
          </div>
        ) : (
          <>
            {/* Identity summary */}
            <div className="rounded-lg border bg-card p-6">
              <div className="flex items-center gap-3 flex-wrap mb-4">
                <StatusChip status={vendor.is_active ? 'active' : 'inactive'} />
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  vendor.is_custom
                    ? 'bg-purple-100 text-purple-800'
                    : 'bg-blue-100 text-blue-800'
                }`}>
                  {vendor.is_custom ? 'Custom' : 'Catalog'}
                </span>
                {vendor.code === 'AMAZON-BIZ' && (
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    Amazon
                  </span>
                )}
                {(vendor.tags || []).map((tag) => (
                  <span key={tag} className="px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-700">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                <div>
                  <span className="text-muted-foreground block">Code</span>
                  <span className="font-medium font-mono">{vendor.code || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Account #</span>
                  <span className="font-medium">{vendor.account_number || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Payment Terms</span>
                  <span className="font-medium">{vendor.payment_terms || '-'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">Notes</span>
                  <span className="font-medium">{vendor.notes || '-'}</span>
                </div>
              </div>
            </div>

            {/* Quick stats */}
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                <div className="text-2xl font-bold text-blue-700">
                  {poStats ? poStats.openCount : '—'}
                </div>
                <div className="text-sm text-blue-600">Open POs</div>
              </div>
              <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="text-2xl font-bold text-gray-700">
                  {poStats ? poStats.totalCount : '—'}
                </div>
                <div className="text-sm text-gray-600">Total POs</div>
              </div>
              <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                <div className="text-2xl font-bold text-green-700">
                  {poStats?.lastOrderDate
                    ? new Date(poStats.lastOrderDate).toLocaleDateString()
                    : '—'}
                </div>
                <div className="text-sm text-green-600">Last Order</div>
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-6">
              {/* Contacts */}
              <div className="rounded-lg border bg-card p-6 space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Contacts ({vendor.contacts?.length || 0})
                </h3>
                {(!vendor.contacts || vendor.contacts.length === 0) ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No contacts yet.</p>
                ) : (
                  vendor.contacts.map((contact) => (
                    <div
                      key={contact.id}
                      className={`border rounded-lg p-3 space-y-1 ${
                        primaryContact?.id === contact.id && contact.is_primary ? 'border-primary bg-primary/5' : ''
                      }`}
                    >
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
                      <div className="flex gap-4 text-sm text-muted-foreground flex-wrap">
                        {contact.email && (
                          <a href={`mailto:${contact.email}`} className="flex items-center gap-1 hover:text-foreground">
                            <Mail className="h-3.5 w-3.5" />
                            {contact.email}
                          </a>
                        )}
                        {contact.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="h-3.5 w-3.5" />
                            {contact.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Addresses */}
              <div className="rounded-lg border bg-card p-6 space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  Addresses ({vendor.addresses?.length || 0})
                </h3>
                {(!vendor.addresses || vendor.addresses.length === 0) ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No addresses yet.</p>
                ) : (
                  vendor.addresses.map((addr) => (
                    <div key={addr.id} className="border rounded-lg p-3 space-y-1">
                      <div className="flex items-center gap-2">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                        {addr.label && <span className="font-medium text-sm">{addr.label}</span>}
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                          {addr.address_type}
                        </span>
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
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
