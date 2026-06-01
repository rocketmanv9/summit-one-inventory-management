/**
 * Place Order Modal
 * 
 * Handles order placement for different vendor types:
 * - Email PO: Send PO via email
 * - Portal: Guide to portal, capture external order #
 * - Phone: Guide to call, capture confirmation
 * - Card Only: Remind about card usage, capture receipt
 * - Pickup: Schedule pickup, print PO
 */

'use client';
/* eslint-disable react-compiler/react-compiler */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Loader2,
  Mail,
  Phone,
  CreditCard,
  Truck,
  Copy,
  Info,
  ShoppingCart
} from 'lucide-react';
import { markPOAsOrdered, sendPOEmail, getVendorOrderingGuidance, getPurchaseOrderWithDetails } from '@/lib/api/purchase-orders';
import { 
  getOrderingModeLabel, 
  getOrderingModeDescription,
  shouldShowSendPOButton,
  shouldShowExternalOrderTracking 
} from '@/types/purchase-orders';
import type { 
  PurchaseOrder, 
  VendorOrderingGuidance,
  OrderPlacementMethod 
} from '@/types/purchase-orders';
import { toast } from 'sonner';

interface PlaceOrderModalProps {
  open: boolean;
  onClose: () => void;
  po: PurchaseOrder;
  onSuccess?: () => void;
}

export function PlaceOrderModal({ open, onClose, po, onSuccess }: PlaceOrderModalProps) {
  const [guidance, setGuidance] = useState<VendorOrderingGuidance | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<'guidance' | 'confirm'>('guidance');

  // Form state for external order tracking
  const [externalOrderNumber, setExternalOrderNumber] = useState('');
  const [placementMethod, setPlacementMethod] = useState<OrderPlacementMethod>('portal');
  const [placementNotes, setPlacementNotes] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');

  // Amazon punchout state
  const [punchoutStep, setPunchoutStep] = useState<'init' | 'waiting' | 'review' | 'submitting'>('init');
  const [punchoutOrderId, setPunchoutOrderId] = useState<string | null>(null);
  const [punchoutItems, setPunchoutItems] = useState<Array<{
    line_number: number;
    supplier_sku: string;
    spaid: string;
    quantity: number;
    unit_price: number;
    currency: string;
    description: string;
    unit_of_measure: string;
  }>>([]);
  const [punchoutTotal, setPunchoutTotal] = useState(0);
  const [userEmail, setUserEmail] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadGuidance = useCallback(async () => {
    if (!po.vendor_id) return;

    const result = await getVendorOrderingGuidance(po.vendor_id);
    if (result.data) {
      let effectiveMode = result.data.ordering_mode;

      // If vendor is amazon_punchout, check whether ALL PO line items
      // actually have ASIN mappings. If not, fall back to portal mode.
      if (effectiveMode === 'amazon_punchout') {
        try {
          const [poDetails, mappingsRes] = await Promise.all([
            getPurchaseOrderWithDetails(po.id),
            fetch('/api/settings/integrations/amazon-business/item-mappings'),
          ]);

          const catalogItemIds = (poDetails.data?.lines || [])
            .filter((l: any) => l.catalog_item_id)
            .map((l: any) => l.catalog_item_id);

          if (catalogItemIds.length > 0 && mappingsRes.ok) {
            const mappingsJson = await mappingsRes.json();
            const mappedIds = new Set(
              (mappingsJson.data || []).map((m: any) => m.catalog_item_id)
            );
            const allMapped = catalogItemIds.every((id: string) => mappedIds.has(id));
            if (!allMapped) {
              effectiveMode = 'portal_with_po_ref';
            }
          } else if (catalogItemIds.length === 0) {
            effectiveMode = 'portal_with_po_ref';
          }
        } catch {
          // If mapping check fails, fall back to portal
          effectiveMode = 'portal_with_po_ref';
        }
      }

      setGuidance({ ...result.data, ordering_mode: effectiveMode });

      // Set defaults from guidance
      if (result.data.po_email) {
        setRecipientEmail(result.data.po_email);
      }

      // Set placement method based on ordering mode
      if (effectiveMode === 'portal_with_po_ref') {
        setPlacementMethod('portal');
      } else if (effectiveMode === 'phone_with_po_ref') {
        setPlacementMethod('phone');
      } else if (effectiveMode === 'email_po') {
        setPlacementMethod('email');
      } else if (effectiveMode === 'card_only_internal_po') {
        setPlacementMethod('portal');
      } else if (effectiveMode === 'amazon_punchout') {
        setPlacementMethod('portal');
        setPunchoutStep('init');
      }
    }
  }, [po.id, po.vendor_id]);

  // Load vendor guidance when modal opens
  useEffect(() => {
    if (open && po.vendor_id) {
      loadGuidance();
    }
  }, [open, po.vendor_id, loadGuidance]);

  // Pre-fill the Amazon session email with the logged-in user's email. Without
  // this, userEmail stays '' and the "Start Amazon Punchout" button is disabled
  // (disabled={!userEmail}) — so clicking it appears to do nothing. Still editable.
  useEffect(() => {
    if (!open || userEmail) return;
    fetch('/api/auth/session')
      .then((res) => res.json())
      .then((data) => {
        if (data?.authenticated && data.email) setUserEmail(data.email);
      })
      .catch(() => {});
  }, [open, userEmail]);

  // Cleanup punchout polling on unmount or close
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const startPunchout = useCallback(async () => {
    setIsLoading(true);
    // Open the Amazon tab synchronously inside the click gesture. If we wait until
    // after the awaited fetch below, the browser no longer treats it as user-initiated
    // and the popup blocker silently kills it — making it look like nothing happened.
    const amazonTab = window.open('about:blank', '_blank');
    try {
      // Fetch PO lines to build catalog_items payload
      const poDetails = await getPurchaseOrderWithDetails(po.id);
      if (poDetails.error || !poDetails.data?.lines?.length) {
        amazonTab?.close();
        toast.error('Failed to load PO details', {
          description: poDetails.error?.message || 'No line items found on this PO'
        });
        setIsLoading(false);
        return;
      }

      const catalogItems = poDetails.data.lines
        .filter(line => line.catalog_item_id)
        .map(line => ({
          catalog_item_id: line.catalog_item_id!,
          // qty_ordered comes back as a numeric string ("1.0000") — coerce to an
          // integer so the punchout/start schema (z.number().int()) accepts it.
          quantity: Math.max(1, Math.round(Number(line.qty_ordered) || 0)),
        }));

      if (catalogItems.length === 0) {
        amazonTab?.close();
        toast.error('No catalog items on this PO', {
          description: 'Amazon punchout requires catalog items with ASIN mappings'
        });
        setIsLoading(false);
        return;
      }

      const locationId = poDetails.data.delivery_location_id || poDetails.data.pickup_location_id;
      if (!locationId) {
        amazonTab?.close();
        toast.error('No delivery location set on this PO');
        setIsLoading(false);
        return;
      }

      const resp = await fetch('/api/settings/integrations/amazon-business/punchout/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_email: userEmail,
          location_id: locationId,
          catalog_items: catalogItems,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error?.message || err.error || 'Failed to start punchout');
      }

      const result = await resp.json();
      setPunchoutOrderId(result.data.punchout_order_id);
      setPunchoutStep('waiting');

      // Navigate the already-open tab to Amazon (fallback to a fresh open if the
      // pre-opened tab was blocked entirely).
      if (amazonTab) {
        amazonTab.location.href = result.data.redirect_url;
      } else {
        window.open(result.data.redirect_url, '_blank');
      }

      // Start polling for cart return
      pollRef.current = setInterval(async () => {
        try {
          const pollResp = await fetch(
            `/api/settings/integrations/amazon-business/punchout/orders?id=${result.data.punchout_order_id}`
          );
          if (pollResp.ok) {
            const pollResult = await pollResp.json();
            if (pollResult.data?.status === 'cart_returned') {
              if (pollRef.current) {
                clearInterval(pollRef.current);
                pollRef.current = null;
              }
              setPunchoutItems(pollResult.data.poom_items || []);
              setPunchoutTotal(pollResult.data.poom_total || 0);
              setPunchoutStep('review');
            }
          }
        } catch {
          // Polling error — keep retrying
        }
      }, 5000);
    } catch (err: any) {
      const msg = err?.message || 'Failed to start punchout';
      // Show the error in the already-open tab instead of silently closing it,
      // so the failure reason is actually visible rather than a tab that flashes.
      if (amazonTab && !amazonTab.closed) {
        try {
          amazonTab.document.title = 'Amazon punchout error';
          amazonTab.document.body.innerHTML =
            '<pre style="white-space:pre-wrap;font:14px/1.5 monospace;padding:24px;color:#b91c1c">' +
            'Amazon punchout failed to start:\n\n' +
            String(msg).replace(/</g, '&lt;') + '</pre>';
        } catch {
          amazonTab.close();
        }
      }
      toast.error('Failed to start Amazon punchout', { description: msg });
    } finally {
      setIsLoading(false);
    }
  }, [po.id, userEmail]);

  const submitPunchoutOrder = useCallback(async () => {
    if (!punchoutOrderId) return;
    setPunchoutStep('submitting');

    try {
      const poDetails = await getPurchaseOrderWithDetails(po.id);
      const locationId = poDetails.data?.delivery_location_id || poDetails.data?.pickup_location_id;

      const resp = await fetch('/api/settings/integrations/amazon-business/punchout/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          punchout_order_id: punchoutOrderId,
          location_id: locationId,
          existing_po_id: po.id,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error?.message || err.error || 'Failed to submit order');
      }

      toast.success('Order submitted to Amazon', {
        description: 'PO has been marked as placed'
      });

      onSuccess?.();
      onClose();
    } catch (err: any) {
      toast.error('Failed to submit order to Amazon', {
        description: err.message
      });
      setPunchoutStep('review');
    }
  }, [punchoutOrderId, po.id, onSuccess, onClose]);

  const handleSendEmailPO = async () => {
    setIsLoading(true);
    
    const result = await sendPOEmail(po.id, recipientEmail);
    
    setIsLoading(false);
    
    if (result.error) {
      toast.error('Failed to send PO', {
        description: result.error.message
      });
      return;
    }
    
    toast.success('PO sent via email', {
      description: `Sent to ${recipientEmail}`
    });
    
    onSuccess?.();
    onClose();
  };
  
  const handleMarkAsOrdered = async () => {
    setIsLoading(true);
    
    const result = await markPOAsOrdered(
      po.id,
      externalOrderNumber || undefined,
      placementMethod,
      placementNotes || undefined
    );
    
    setIsLoading(false);
    
    if (result.error) {
      toast.error('Failed to mark PO as ordered', {
        description: result.error.message
      });
      return;
    }
    
    toast.success('Order placed successfully', {
      description: externalOrderNumber 
        ? `External Order #: ${externalOrderNumber}` 
        : 'PO marked as ordered'
    });
    
    onSuccess?.();
    onClose();
  };
  
  const copyPONumber = () => {
    navigator.clipboard.writeText(po.po_number);
    toast.success('PO number copied to clipboard');
  };
  
  if (!guidance) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Loading vendor information...</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }
  
  const orderingMode = guidance.ordering_mode;
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Place Order - PO #{po.po_number}</DialogTitle>
          <DialogDescription>
            {guidance.vendor_name} • {getOrderingModeLabel(orderingMode)}
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Ordering Instructions */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-2">
                <div className="font-semibold">{getOrderingModeDescription(orderingMode)}</div>
                {guidance.ordering_instructions && (
                  <div className="text-sm whitespace-pre-line">{guidance.ordering_instructions}</div>
                )}
                {guidance.notes_for_buyers && (
                  <div className="text-sm text-muted-foreground mt-2 border-t pt-2">
                    <strong>Note:</strong> {guidance.notes_for_buyers}
                  </div>
                )}
              </div>
            </AlertDescription>
          </Alert>
          
          {/* PO Number Display */}
          <div className="flex items-center gap-2 p-4 bg-muted rounded-lg">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">PO Number</Label>
              <div className="text-2xl font-mono font-bold">{po.po_number}</div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copyPONumber}
            >
              <Copy className="h-4 w-4 mr-1" />
              Copy
            </Button>
          </div>
          
          {/* MODE-SPECIFIC UI */}
          
          {/* EMAIL PO */}
          {orderingMode === 'email_po' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="recipient_email">Recipient Email</Label>
                <Input
                  id="recipient_email"
                  type="email"
                  value={recipientEmail}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRecipientEmail(e.target.value)}
                  placeholder="vendor@example.com"
                />
              </div>
              
              {guidance.requires_po_in_subject && (
                <Alert className="bg-yellow-50 border-yellow-200">
                  <AlertCircle className="h-4 w-4 text-yellow-600" />
                  <AlertDescription className="text-yellow-800">
                    This vendor requires PO # in email subject line
                  </AlertDescription>
                </Alert>
              )}
              
              <Button
                onClick={handleSendEmailPO}
                disabled={isLoading || !recipientEmail}
                className="w-full"
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Mail className="h-4 w-4 mr-2" />
                Send PO via Email
              </Button>
            </div>
          )}
          
          {/* PORTAL ORDERING */}
          {orderingMode === 'portal_with_po_ref' && (
            <div className="space-y-4">
              {guidance.portal_url && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open(guidance.portal_url, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open {guidance.vendor_name} Portal
                </Button>
              )}
              
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                <div className="font-semibold text-blue-900">Steps:</div>
                <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
                  <li>Log in to vendor portal</li>
                  <li>Add items to cart</li>
                  <li>Enter PO # <strong>{po.po_number}</strong> during checkout</li>
                  <li>Complete order and save confirmation #</li>
                </ol>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="external_order">External Order # (required)</Label>
                <Input
                  id="external_order"
                  value={externalOrderNumber}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExternalOrderNumber(e.target.value)}
                  placeholder="Vendor's order confirmation number"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="notes">Order Notes (optional)</Label>
                <Textarea
                  id="notes"
                  value={placementNotes}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPlacementNotes(e.target.value)}
                  placeholder="Cart total, special instructions, issues encountered..."
                  rows={3}
                />
              </div>
              
              <Button
                onClick={handleMarkAsOrdered}
                disabled={isLoading || !externalOrderNumber}
                className="w-full"
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Confirm Order Placed
              </Button>
            </div>
          )}
          
          {/* PHONE ORDERING */}
          {orderingMode === 'phone_with_po_ref' && (
            <div className="space-y-4">
              {guidance.phone_number && (
                <div className="p-4 bg-muted rounded-lg">
                  <Label className="text-xs text-muted-foreground">Phone Number</Label>
                  <div className="text-xl font-semibold">{guidance.phone_number}</div>
                </div>
              )}
              
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                <div className="font-semibold text-blue-900">Steps:</div>
                <ol className="list-decimal list-inside space-y-1 text-sm text-blue-800">
                  <li>Call vendor</li>
                  <li>Reference PO # <strong>{po.po_number}</strong></li>
                  <li>Place order and get confirmation #</li>
                </ol>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="external_order">Confirmation # (optional)</Label>
                <Input
                  id="external_order"
                  value={externalOrderNumber}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExternalOrderNumber(e.target.value)}
                  placeholder="Vendor's confirmation number"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="notes">Call Notes (optional)</Label>
                <Textarea
                  id="notes"
                  value={placementNotes}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPlacementNotes(e.target.value)}
                  placeholder="Who you spoke with, quoted price, delivery date..."
                  rows={3}
                />
              </div>
              
              <Button
                onClick={handleMarkAsOrdered}
                disabled={isLoading}
                className="w-full"
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Confirm Order Placed
              </Button>
            </div>
          )}
          
          {/* CARD ONLY */}
          {orderingMode === 'card_only_internal_po' && (
            <div className="space-y-4">
              <Alert className="bg-purple-50 border-purple-200">
                <CreditCard className="h-4 w-4 text-purple-600" />
                <AlertDescription className="text-purple-800">
                  <strong>Card Payment Required</strong><br />
                  Use company card. PO is for internal tracking only.
                  Attach receipt when receiving.
                </AlertDescription>
              </Alert>
              
              {guidance.portal_url && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => window.open(guidance.portal_url, '_blank')}
                >
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open {guidance.vendor_name} Website
                </Button>
              )}
              
              <div className="space-y-2">
                <Label htmlFor="external_order">Order # (optional)</Label>
                <Input
                  id="external_order"
                  value={externalOrderNumber}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExternalOrderNumber(e.target.value)}
                  placeholder="Order/receipt number"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="notes">Purchase Notes</Label>
                <Textarea
                  id="notes"
                  value={placementNotes}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPlacementNotes(e.target.value)}
                  placeholder="Card used, total amount, receipt attached..."
                  rows={3}
                />
              </div>
              
              <Button
                onClick={handleMarkAsOrdered}
                disabled={isLoading}
                className="w-full"
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Mark as Purchased
              </Button>
            </div>
          )}
          
          {/* PICKUP ONLY */}
          {orderingMode === 'pickup_only' && (
            <div className="space-y-4">
              <Alert>
                <Truck className="h-4 w-4" />
                <AlertDescription>
                  <strong>In-Person Pickup</strong><br />
                  Print or reference PO # when picking up materials.
                </AlertDescription>
              </Alert>
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => window.print()}
                >
                  Print PO
                </Button>
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={copyPONumber}
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Copy PO #
                </Button>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="notes">Pickup Notes (optional)</Label>
                <Textarea
                  id="notes"
                  value={placementNotes}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPlacementNotes(e.target.value)}
                  placeholder="Scheduled pickup date, contact person, location..."
                  rows={3}
                />
              </div>
              
              <Button
                onClick={handleMarkAsOrdered}
                disabled={isLoading}
                className="w-full"
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Confirm Order Placed
              </Button>
            </div>
          )}
          
          {/* AMAZON PUNCHOUT */}
          {orderingMode === 'amazon_punchout' && (
            <div className="space-y-4">
              {punchoutStep === 'init' && (
                <>
                  <Alert className="bg-orange-50 border-orange-200">
                    <ShoppingCart className="h-4 w-4 text-orange-600" />
                    <AlertDescription className="text-orange-800">
                      <strong>Amazon Business Punchout</strong><br />
                      You will be redirected to Amazon to review and confirm items.
                      When done, return here to submit the order.
                    </AlertDescription>
                  </Alert>

                  <div className="space-y-2">
                    <Label htmlFor="user_email">Your Email (for Amazon session)</Label>
                    <Input
                      id="user_email"
                      type="email"
                      value={userEmail}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUserEmail(e.target.value)}
                      placeholder="you@company.com"
                    />
                  </div>

                  <Button
                    onClick={startPunchout}
                    disabled={isLoading || !userEmail}
                    className="w-full"
                  >
                    {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    <ShoppingCart className="h-4 w-4 mr-2" />
                    Start Amazon Punchout
                  </Button>
                </>
              )}

              {punchoutStep === 'waiting' && (
                <div className="text-center py-8 space-y-4">
                  <Loader2 className="h-10 w-10 animate-spin text-orange-500 mx-auto" />
                  <div>
                    <div className="font-semibold text-lg">Shopping on Amazon...</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Complete your selections on Amazon and click &quot;Submit Cart&quot;.
                      This page will update automatically.
                    </div>
                  </div>
                </div>
              )}

              {punchoutStep === 'review' && (
                <>
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800">
                      Cart returned from Amazon. Review the items below and submit.
                    </AlertDescription>
                  </Alert>

                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted">
                        <tr>
                          <th className="text-left p-2">Item</th>
                          <th className="text-left p-2">ASIN</th>
                          <th className="text-right p-2">Qty</th>
                          <th className="text-right p-2">Unit Price</th>
                          <th className="text-right p-2">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {punchoutItems.map((item, idx) => (
                          <tr key={idx} className="border-t">
                            <td className="p-2 max-w-[200px] truncate" title={item.description}>
                              {item.description}
                            </td>
                            <td className="p-2 font-mono text-xs">{item.supplier_sku}</td>
                            <td className="p-2 text-right">{item.quantity}</td>
                            <td className="p-2 text-right">${item.unit_price.toFixed(2)}</td>
                            <td className="p-2 text-right font-medium">
                              ${(item.quantity * item.unit_price).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t bg-muted/50">
                          <td colSpan={4} className="p-2 text-right font-semibold">Total</td>
                          <td className="p-2 text-right font-bold">${punchoutTotal.toFixed(2)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <Button
                    onClick={submitPunchoutOrder}
                    className="w-full"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Submit Order to Amazon
                  </Button>
                </>
              )}

              {punchoutStep === 'submitting' && (
                <div className="text-center py-8 space-y-4">
                  <Loader2 className="h-10 w-10 animate-spin text-orange-500 mx-auto" />
                  <div>
                    <div className="font-semibold text-lg">Submitting order to Amazon...</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      Please wait while the order is processed.
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* MIXED */}
          {orderingMode === 'mixed' && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="placement_method">How will you place this order?</Label>
                <Select
                  value={placementMethod}
                  onValueChange={(value: string) => setPlacementMethod(value as OrderPlacementMethod)}
                >
                  <SelectTrigger id="placement_method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portal">Portal</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone">Phone</SelectItem>
                    <SelectItem value="in_person">In Person</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="external_order">External Order # (optional)</Label>
                <Input
                  id="external_order"
                  value={externalOrderNumber}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExternalOrderNumber(e.target.value)}
                  placeholder="Vendor's order/confirmation number"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="notes">Order Notes</Label>
                <Textarea
                  id="notes"
                  value={placementNotes}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPlacementNotes(e.target.value)}
                  placeholder="Details about how order was placed..."
                  rows={3}
                />
              </div>
              
              <Button
                onClick={handleMarkAsOrdered}
                disabled={isLoading}
                className="w-full"
              >
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Confirm Order Placed
              </Button>
            </div>
          )}
          
          {/* Payment Guidance */}
          <div className="border-t pt-4">
            <div className="text-sm text-muted-foreground">
              <strong>Payment:</strong> {guidance.payment_guidance}
            </div>
            {guidance.receiving_notes && (
              <div className="text-sm text-muted-foreground mt-1">
                <strong>Receiving:</strong> {guidance.receiving_notes}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex justify-end border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
