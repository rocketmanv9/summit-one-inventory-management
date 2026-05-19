'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { OrderStatusBadge } from '@/components/procurement/OrderStatusBadge';
import { OrderTimeline } from '@/components/procurement/OrderTimeline';
import { Loader2, Send, XCircle, RefreshCw, PackageCheck } from 'lucide-react';

export default function ProcurementOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const [loading, setLoading] = useState(true);
  const [order, setOrder] = useState<any>(null);
  const [acting, setActing] = useState(false);
  const [message, setMessage] = useState('');

  const loadOrder = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/procurement/orders/${orderId}`);
      const json = await res.json();
      setOrder(json?.data || null);
    } catch { /* empty */ } finally { setLoading(false); }
  };

  useEffect(() => { if (orderId) loadOrder(); }, [orderId]);

  const doAction = async (action: string, body = {}) => {
    setActing(true); setMessage('');
    try {
      const res = await fetch(`/api/procurement/orders/${orderId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || `Failed to ${action}`);
      setMessage(`Order ${action} successful.`);
      await loadOrder();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : `Failed to ${action}`);
    } finally { setActing(false); }
  };

  if (loading) return <AppShell><div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></AppShell>;
  if (!order) return <AppShell><div className="text-center py-16 text-muted-foreground">Order not found.</div></AppShell>;

  const items = order.items || [];
  const timeline = order.timeline || [];

  return (
    <AppShell>
      <PageHeader title={`Order ${order.order_number}`} description={`Created ${new Date(order.created_at).toLocaleDateString()}`} backHref="/procurement/orders" />

      {message && <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">{message}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Order Info */}
          <div className="bg-white rounded-lg border p-6">
            <div className="flex items-center justify-between mb-4">
              <OrderStatusBadge status={order.status} />
              <div className="flex gap-2">
                {order.status === 'draft' && (
                  <button onClick={() => doAction('submit')} disabled={acting}
                    className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 text-sm flex items-center gap-1.5">
                    <Send className="h-3.5 w-3.5" /> Submit Order
                  </button>
                )}
                {order.external_order_id && !['received', 'cancelled'].includes(order.status) && (
                  <button onClick={() => doAction('sync')} disabled={acting}
                    className="px-3 py-1.5 border rounded-md hover:bg-gray-50 disabled:opacity-50 text-sm flex items-center gap-1.5">
                    <RefreshCw className="h-3.5 w-3.5" /> Sync Status
                  </button>
                )}
                {['submitted', 'confirmed', 'processing', 'shipped'].includes(order.status) && (
                  <button onClick={() => doAction('receive', { items: items.map((i: any) => ({ order_item_id: i.id, qty_received: i.quantity })) })} disabled={acting}
                    className="px-3 py-1.5 border border-green-300 text-green-700 rounded-md hover:bg-green-50 disabled:opacity-50 text-sm flex items-center gap-1.5">
                    <PackageCheck className="h-3.5 w-3.5" /> Receive All
                  </button>
                )}
                {!['received', 'cancelled'].includes(order.status) && (
                  <button onClick={() => doAction('cancel', { reason: 'Cancelled by user' })} disabled={acting}
                    className="px-3 py-1.5 border border-red-300 text-red-700 rounded-md hover:bg-red-50 disabled:opacity-50 text-sm flex items-center gap-1.5">
                    <XCircle className="h-3.5 w-3.5" /> Cancel
                  </button>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-muted-foreground">External ID:</span> <span className="font-mono">{order.external_order_id || '-'}</span></div>
              <div><span className="text-muted-foreground">Submitted:</span> {order.submitted_at ? new Date(order.submitted_at).toLocaleString() : '-'}</div>
              <div><span className="text-muted-foreground">Subtotal:</span> ${Number(order.subtotal || 0).toFixed(2)}</div>
              <div><span className="text-muted-foreground">Total:</span> <span className="font-semibold">${Number(order.total_amount || 0).toFixed(2)}</span></div>
            </div>
          </div>

          {/* Items */}
          <div className="bg-white rounded-lg border">
            <div className="p-6 border-b"><h3 className="font-semibold">Items ({items.length})</h3></div>
            <div className="divide-y">
              {items.map((item: any) => (
                <div key={item.id} className="flex items-center gap-4 p-4">
                  {item.product_image_url && <img src={item.product_image_url} alt="" className="h-12 w-12 rounded object-cover bg-gray-50" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.product_title}</p>
                    <p className="text-xs text-muted-foreground">${Number(item.unit_price).toFixed(2)} x {item.quantity}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">${Number(item.line_total || item.unit_price * item.quantity).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground">{item.qty_received}/{item.quantity} received</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Sidebar — Timeline */}
        <div className="space-y-6">
          <div className="bg-white rounded-lg border p-6">
            <h3 className="font-semibold mb-4">Activity</h3>
            <OrderTimeline entries={timeline} />
          </div>

          {order.shipping_address && (
            <div className="bg-white rounded-lg border p-6">
              <h3 className="font-semibold mb-3">Shipping Address</h3>
              <div className="text-sm text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">{order.shipping_address.name}</p>
                {order.shipping_address.company && <p>{order.shipping_address.company}</p>}
                <p>{order.shipping_address.address1}</p>
                {order.shipping_address.address2 && <p>{order.shipping_address.address2}</p>}
                <p>{order.shipping_address.city}, {order.shipping_address.state} {order.shipping_address.postalCode}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
