'use client';

/**
 * QuickTools — the row of primary actions at the top of the fixed dashboard.
 *
 * Every button reuses an existing modal or route. Nothing here implements a new
 * flow:
 *   - Add vendor      → VendorQuickAddModal (AI-prefill + Gmail/web-search path)
 *   - Quick-add item  → /inventory/items/new (AI item suggest wizard)
 *   - New PO          → /inventory/purchasing/create
 *   - New cycle count → /inventory/cycle-counts?create=1
 *   - Scan            → /scan
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2, PackagePlus, ShoppingCart, ClipboardCheck, ScanLine } from 'lucide-react';
import { VendorQuickAddModal } from '@/components/vendors/VendorQuickAddModal';

const TILE_CLS =
  'flex flex-col items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-4 text-center shadow-sm transition-all hover:border-blue-400 hover:shadow-md';

export function QuickTools() {
  const router = useRouter();
  const [showVendorQuickAdd, setShowVendorQuickAdd] = useState(false);

  return (
    <div>
      <h2 className="sr-only">Quick tools</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <button type="button" onClick={() => setShowVendorQuickAdd(true)} className={TILE_CLS}>
          <Building2 className="h-6 w-6 text-blue-600" />
          <span className="text-sm font-medium text-gray-900">Add vendor</span>
        </button>

        <Link href="/inventory/items/new" className={TILE_CLS}>
          <PackagePlus className="h-6 w-6 text-emerald-600" />
          <span className="text-sm font-medium text-gray-900">Quick-add item</span>
        </Link>

        <Link href="/inventory/purchasing/create" className={TILE_CLS}>
          <ShoppingCart className="h-6 w-6 text-amber-600" />
          <span className="text-sm font-medium text-gray-900">New purchase order</span>
        </Link>

        <Link href="/inventory/cycle-counts?create=1" className={TILE_CLS}>
          <ClipboardCheck className="h-6 w-6 text-purple-600" />
          <span className="text-sm font-medium text-gray-900">New cycle count</span>
        </Link>

        <Link href="/scan" className={TILE_CLS}>
          <ScanLine className="h-6 w-6 text-gray-700" />
          <span className="text-sm font-medium text-gray-900">Scan</span>
        </Link>
      </div>

      {showVendorQuickAdd && (
        <VendorQuickAddModal
          open
          onClose={() => setShowVendorQuickAdd(false)}
          onSuccess={() => setShowVendorQuickAdd(false)}
          // "Open full form" lives on the vendors page — hand off there rather
          // than reimplementing the detailed VendorModal on the dashboard.
          onReview={() => {
            setShowVendorQuickAdd(false);
            router.push('/inventory/vendors');
          }}
        />
      )}
    </div>
  );
}
