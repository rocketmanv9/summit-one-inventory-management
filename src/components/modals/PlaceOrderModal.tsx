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

import { useState, useEffect } from 'react';
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
  Info
} from 'lucide-react';
import { markPOAsOrdered, sendPOEmail, getVendorOrderingGuidance } from '@/lib/api/purchase-orders';
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

  const loadGuidance = async () => {
    if (!po.vendor_id) return;
    
    const result = await getVendorOrderingGuidance(po.vendor_id);
    if (result.data) {
      setGuidance(result.data);
      
      // Set defaults from guidance
      if (result.data.po_email) {
        setRecipientEmail(result.data.po_email);
      }
      
      // Set placement method based on ordering mode
      if (result.data.ordering_mode === 'portal_with_po_ref') {
        setPlacementMethod('portal');
      } else if (result.data.ordering_mode === 'phone_with_po_ref') {
        setPlacementMethod('phone');
      } else if (result.data.ordering_mode === 'email_po') {
        setPlacementMethod('email');
      } else if (result.data.ordering_mode === 'card_only_internal_po') {
        setPlacementMethod('portal');
      }
    }
  };

  // Load vendor guidance when modal opens
  useEffect(() => {
    if (open && po.vendor_id) {
      loadGuidance();
    }
  }, [open, po.vendor_id, loadGuidance]);

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
