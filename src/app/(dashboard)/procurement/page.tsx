'use client';

import { useState, useEffect } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { Loader2, AlertTriangle, Truck, ArrowDown } from 'lucide-react';
import Link from 'next/link';

export default function ProcurementDashboard() {
  const [loading, setLoading] = useState(true);
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [creatingPO, setCreatingPO] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    Promise.all([
      fetch('/api/procurement/low-stock?limit=50').then(r => r.json()).catch(() => ({ data: [] })),
      fetch('/api/procurement/orders?limit=5').then(r => r.json()).catch(() => ({ data: [] })),
    ]).then(([lowStockJson, ordersJson]) => {
      setLowStockItems(lowStockJson?.data || []);
      setOrders(ordersJson?.data || []);
      setLoading(false);
    });
  }, []);

  const handleCreatePO = async (item: any) => {
    setCreatingPO(item.id);
    setMessage('');
    try {
      const res = await fetch('/api/procurement/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          provider_id: item.preferred_provider_id,
          shipping_address: { name: 'Default', address1: 'TBD', city: 'TBD', state: 'TBD', postalCode: '00000', country: 'US' },
          items: [{
            catalog_item_id: item.catalog_item_id,
            item_name: item.item_name,
            quantity: item.reorder_qty,
            unit_price: item.unit_cost || 0,
            external_product_id: item.external_product_id || undefined,
            reorder_rule_id: item.id,
          }],
        }),
      });
      if (res.ok) {
        const json = await res.json();
        setMessage(`PO ${json?.data?.order_number} created for ${item.item_name}`);
        const refreshRes = await fetch('/api/procurement/orders?limit=5');
        const refreshJson = await refreshRes.json();
        setOrders(refreshJson?.data || []);
      } else {
        const json = await res.json();
        setMessage(json?.error?.message || 'Failed to create PO');
      }
    } catch {
      setMessage('Failed to create PO');
    } finally {
      setCreatingPO(null);
    }
  };

  const activeOrders = orders.filter(o => !['received', 'cancelled'].includes(o.status)).length;

  if (loading) {
    return <AppShell><div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></AppShell>;
  }

  return (
    <AppShell>
      <PageHeader title="Procurement" description="Monitor stock levels and manage purchase orders" />

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center gap-3 mb-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h3 className="text-sm font-medium text-muted-foreground">Low Stock Items</h3>
          </div>
          <p className="text-2xl font-semibold">{lowStockItems.length}</p>
        </div>
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center gap-3 mb-2">
            <Truck className="h-5 w-5 text-purple-500" />
            <h3 className="text-sm font-medium text-muted-foreground">Active Orders</h3>
          </div>
          <p className="text-2xl font-semibold">{activeOrders}</p>
        </div>
        <div className="bg-white rounded-lg border p-6">
          <div className="flex items-center gap-3 mb-2">
            <ArrowDown className="h-5 w-5 text-red-500" />
            <h3 className="text-sm font-medium text-muted-foreground">Below Threshold</h3>
          </div>
          <p className="text-2xl font-semibold">{lowStockItems.filter(i => i.gap > 0).length}</p>
        </div>
      </div>

      {message && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">{message}</div>}

      {/* Low Stock Items */}
      <div className="bg-white rounded-lg border mb-8">
        <div className="p-6 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Low Stock Items</h3>
          <Link href="/procurement/reorder-rules" className="text-sm text-primary hover:underline">Manage Reorder Rules</Link>
        </div>
        <div className="p-6">
          {lowStockItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No items below reorder point.</p>
              <p className="text-xs mt-1">Set up reorder rules in <Link href="/procurement/reorder-rules" className="text-primary hover:underline">Reorder Rules</Link> to monitor stock levels.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                <th className="pb-2 font-medium text-muted-foreground">Item</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">On Hand</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Reorder Point</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Gap</th>
                <th className="pb-2 font-medium text-muted-foreground text-right">Reorder Qty</th>
                <th className="pb-2 font-medium text-muted-foreground text-right"></th>
              </tr></thead>
              <tbody>
                {lowStockItems.map((item: any) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2.5 font-medium">{item.item_name}</td>
                    <td className="py-2.5 text-right">
                      <span className={item.current_stock === 0 ? 'text-red-600 font-semibold' : 'text-amber-600'}>
                        {item.current_stock}
                      </span>
                    </td>
                    <td className="py-2.5 text-right text-muted-foreground">{item.reorder_point}</td>
                    <td className="py-2.5 text-right text-red-600 font-medium">{item.gap}</td>
                    <td className="py-2.5 text-right text-muted-foreground">{item.reorder_qty}</td>
                    <td className="py-2.5 text-right">
                      {item.preferred_provider_id ? (
                        <button
                          onClick={() => handleCreatePO(item)}
                          disabled={creatingPO === item.id}
                          className="px-3 py-1 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-xs font-medium"
                        >
                          {creatingPO === item.id ? 'Creating...' : 'Create PO'}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">No provider</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Recent Orders */}
      <div className="bg-white rounded-lg border">
        <div className="p-6 border-b flex items-center justify-between">
          <h3 className="text-lg font-semibold">Recent Orders</h3>
          <Link href="/procurement/orders" className="text-sm text-primary hover:underline">View All</Link>
        </div>
        <div className="p-6">
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No purchase orders yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left">
                <th className="pb-2 font-medium text-muted-foreground">Order #</th>
                <th className="pb-2 font-medium text-muted-foreground">Status</th>
                <th className="pb-2 font-medium text-muted-foreground">Total</th>
                <th className="pb-2 font-medium text-muted-foreground">Date</th>
              </tr></thead>
              <tbody>
                {orders.map((o: any) => (
                  <tr key={o.id} className="border-b last:border-0">
                    <td className="py-2.5"><Link href={`/procurement/orders/${o.id}`} className="text-primary hover:underline font-mono">{o.order_number}</Link></td>
                    <td className="py-2.5 capitalize">{o.status.replace('_', ' ')}</td>
                    <td className="py-2.5">${Number(o.total_amount || 0).toFixed(2)}</td>
                    <td className="py-2.5 text-muted-foreground">{new Date(o.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
