'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { OrderStatusBadge } from '@/components/procurement/OrderStatusBadge';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';

const STATUSES = ['all', 'draft', 'submitted', 'confirmed', 'processing', 'shipped', 'received', 'cancelled'];

export default function ProcurementOrdersPage() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const loadOrders = async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (statusFilter !== 'all') params.set('status', statusFilter);
    try {
      const res = await fetch(`/api/procurement/orders?${params}`);
      const json = await res.json();
      setOrders(json?.data || []);
      setTotal(json?.meta?.total || 0);
    } catch { /* empty */ } finally { setLoading(false); }
  };

  useEffect(() => { loadOrders(); }, [statusFilter, page]);

  return (
    <AppShell>
      <PageHeader title="Vendor Orders" description="Track and manage vendor fulfillment orders" backHref="/procurement" />

      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border ${statusFilter === s ? 'bg-primary text-primary-foreground border-primary' : 'bg-white text-foreground hover:bg-gray-50'}`}>
            {s === 'all' ? 'All' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No orders found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left">
              <th className="p-4 font-medium text-muted-foreground">Order #</th>
              <th className="p-4 font-medium text-muted-foreground">Status</th>
              <th className="p-4 font-medium text-muted-foreground">Total</th>
              <th className="p-4 font-medium text-muted-foreground">Submitted</th>
              <th className="p-4 font-medium text-muted-foreground">Created</th>
            </tr></thead>
            <tbody>
              {orders.map((o: any) => (
                <tr key={o.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-4"><Link href={`/procurement/orders/${o.id}`} className="text-primary hover:underline font-mono">{o.order_number}</Link></td>
                  <td className="p-4"><OrderStatusBadge status={o.status} /></td>
                  <td className="p-4">${Number(o.total_amount || 0).toFixed(2)}</td>
                  <td className="p-4 text-muted-foreground">{o.submitted_at ? new Date(o.submitted_at).toLocaleDateString() : '-'}</td>
                  <td className="p-4 text-muted-foreground">{new Date(o.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > 20 && (
            <div className="flex justify-between items-center p-4 border-t">
              <p className="text-sm text-muted-foreground">Page {page} of {Math.ceil(total / 20)}</p>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1 border rounded text-sm disabled:opacity-50">Prev</button>
                <button onClick={() => setPage(p => p + 1)} disabled={page * 20 >= total} className="px-3 py-1 border rounded text-sm disabled:opacity-50">Next</button>
              </div>
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
