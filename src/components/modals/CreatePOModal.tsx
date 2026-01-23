/**
 * Create Purchase Order Modal
 * 
 * Construction-friendly PO creation optimized for <60 second workflow.
 * 
 * Features:
 * - Required core fields always visible
 * - Optional advanced section collapsed by default
 * - Vendor defaults auto-applied
 * - Flexible line items (catalog + free-text)
 * - Spend authorization for unknown pricing
 * - Real-time validation with warnings
 */

'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, ChevronDown, ChevronUp, Globe, Info, Loader2, Phone, Plus, X } from 'lucide-react';
import { useCreatePurchaseOrder, useNextPONumber, useVendorDefaults } from '@/lib/api/purchase-orders';
import { validatePOForm, calculatePOTotal, getOrderingModeLabel, getOrderingModeDescription } from '@/types/purchase-orders';
import type { CreatePOFormState, CreatePOLineInput, DeliveryMethod, CostContext } from '@/types/purchase-orders';

interface CreatePOModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (poId: string, poNumber: string) => void;
  
  // Pre-fill options
  presetVendorId?: string;
  presetJobId?: string;
  presetItems?: Array<{
    catalog_item_id?: string;
    item_description?: string;
    qty_ordered: number;
  }>;
}

export function CreatePOModal({
  open,
  onClose,
  onSuccess,
  presetVendorId,
  presetJobId,
  presetItems
}: CreatePOModalProps) {
  // Hooks
  const { create, isLoading, error: createError } = useCreatePurchaseOrder();
  const { poNumber, generate: generatePONumber } = useNextPONumber();
  const { defaults: vendorDefaults, fetch: fetchVendorDefaults } = useVendorDefaults(null);
  
  // Form state
  const [form, setForm] = useState<CreatePOFormState>({
    vendor_id: '',
    po_number: '',
    delivery_method: 'ship',
    needed_by_date: '',
    cost_context: 'yard',
    lines: [],
    attachments: []
  });
  
  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  
  // Vendors and locations (would come from context or props)
  const [vendors, setVendors] = useState<Array<{ id: string; name: string }>>([]);
  const [locations, setLocations] = useState<Array<{ id: string; name: string; type: string }>>([]);
  const [jobs, setJobs] = useState<Array<{ id: string; name: string; code: string }>>([]);
  
  // Initialize form
  useEffect(() => {
    if (open) {
      generatePONumber();
      
      // Reset form with presets
      setForm({
        vendor_id: presetVendorId || '',
        po_number: poNumber || '',
        delivery_method: 'ship',
        needed_by_date: '',
        cost_context: presetJobId ? 'job' : 'yard',
        job_id: presetJobId,
        lines: presetItems?.map(item => ({
          ...item,
          price_basis: 'fixed' as const
        })) || [],
        attachments: []
      });
      
      setShowAdvanced(false);
      setValidationErrors([]);
      setValidationWarnings([]);
    }
  }, [open, presetVendorId, presetJobId, presetItems]);
  
  // Update PO number when generated
  useEffect(() => {
    if (poNumber && open) {
      setForm(prev => ({ ...prev, po_number: poNumber }));
    }
  }, [poNumber, open]);
  
  // Fetch vendor defaults when vendor changes
  useEffect(() => {
    if (form.vendor_id) {
      fetchVendorDefaults();
    }
  }, [form.vendor_id, fetchVendorDefaults]);
  
  // Apply vendor defaults
  useEffect(() => {
    if (vendorDefaults && form.vendor_id === vendorDefaults.vendor_id) {
      setForm(prev => ({
        ...prev,
        delivery_method: vendorDefaults.default_delivery_method === 'varies' 
          ? prev.delivery_method 
          : (vendorDefaults.default_delivery_method as DeliveryMethod) || prev.delivery_method
      }));
    }
  }, [vendorDefaults]);
  
  // Validate on form change
  useEffect(() => {
    const validation = validatePOForm(form);
    setValidationErrors(validation.errors);
    setValidationWarnings(validation.warnings);
  }, [form]);
  
  // Handlers
  const handleSubmit = async () => {
    const validation = validatePOForm(form);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return;
    }
    
    const result = await create(form);
    
    if (result.data) {
      onSuccess?.(result.data.po_id, result.data.po_number);
      onClose();
    }
  };
  
  const handleAddLine = () => {
    setForm(prev => ({
      ...prev,
      lines: [
        ...prev.lines,
        {
          qty_ordered: 0,
          price_basis: 'fixed'
        }
      ]
    }));
  };
  
  const handleRemoveLine = (index: number) => {
    setForm(prev => ({
      ...prev,
      lines: prev.lines.filter((_, i) => i !== index)
    }));
  };
  
  const handleLineChange = (index: number, updates: Partial<CreatePOLineInput>) => {
    setForm(prev => ({
      ...prev,
      lines: prev.lines.map((line, i) => 
        i === index ? { ...line, ...updates } : line
      )
    }));
  };
  
  // Calculate totals
  const { total, hasUnknownPricing } = calculatePOTotal(form.lines);
  
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Purchase Order</DialogTitle>
          <DialogDescription>
            Create a PO in under 60 seconds. Required fields marked with *
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* CORE REQUIRED FIELDS */}
          <div className="space-y-4 border-b pb-6">
            <h3 className="font-semibold text-lg">Core Information</h3>
            
            {/* Row 1: Vendor & PO Number */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vendor">Vendor *</Label>
                <Select
                  value={form.vendor_id}
                  onValueChange={(value: string) => setForm(prev => ({ ...prev, vendor_id: value }))}
                >
                  <SelectTrigger id="vendor">
                    <SelectValue placeholder="Select vendor" />
                  </SelectTrigger>
                  <SelectContent>
                    {vendors.map(v => (
                      <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                {/* Vendor defaults info */}
                {vendorDefaults && (
                  <div className="text-xs text-muted-foreground space-y-1">
                    {vendorDefaults.po_instructions && (
                      <div className="flex items-start gap-1">
                        <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                        <span>{vendorDefaults.po_instructions}</span>
                      </div>
                    )}
                    {vendorDefaults.min_order_amount && (
                      <div>Min order: ${vendorDefaults.min_order_amount.toLocaleString()}</div>
                    )}
                  </div>
                )}
                
                {/* Ordering mode hint */}
                {vendorDefaults?.ordering_mode && vendorDefaults.ordering_mode !== 'email_po' && (
                  <Alert className="mt-2">
                    {vendorDefaults.ordering_mode === 'portal_with_po_ref' && <Globe className="h-4 w-4" />}
                    {vendorDefaults.ordering_mode === 'phone_with_po_ref' && <Phone className="h-4 w-4" />}
                    {!['portal_with_po_ref', 'phone_with_po_ref'].includes(vendorDefaults.ordering_mode) && <Info className="h-4 w-4" />}
                    <AlertDescription className="text-xs">
                      <span className="font-medium">{getOrderingModeLabel(vendorDefaults.ordering_mode)}:</span>{' '}
                      {getOrderingModeDescription(vendorDefaults.ordering_mode)}
                      {vendorDefaults.ordering_mode === 'portal_with_po_ref' && ' Reference the PO # during checkout.'}
                      {vendorDefaults.ordering_mode === 'phone_with_po_ref' && ' Provide the PO # when ordering.'}
                      {vendorDefaults.ordering_mode === 'card_only_internal_po' && ' PO is for internal tracking only.'}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="po_number">PO Number *</Label>
                <Input
                  id="po_number"
                  value={form.po_number}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, po_number: e.target.value }))}
                  placeholder="PO-2026-001"
                />
              </div>
            </div>
            
            {/* Row 2: Delivery Method & Needed By */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="delivery_method">Delivery Method *</Label>
                <Tabs
                  value={form.delivery_method}
                  onValueChange={(value: string) => setForm(prev => ({ ...prev, delivery_method: value as DeliveryMethod }))}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="ship">Vendor Ships</TabsTrigger>
                    <TabsTrigger value="pickup">We Pick Up</TabsTrigger>
                  </TabsList>
                </Tabs>
                
                {/* Conditional location fields */}
                {form.delivery_method === 'ship' && (
                  <div className="pt-2">
                    <Label htmlFor="delivery_location" className="text-sm">Ship To *</Label>
                    <Select
                      value={form.delivery_location_id || ''}
                      onValueChange={(value: string) => setForm(prev => ({ ...prev, delivery_location_id: value }))}
                    >
                      <SelectTrigger id="delivery_location" className="mt-1">
                        <SelectValue placeholder="Select delivery location" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.map(loc => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.name} ({loc.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                
                {form.delivery_method === 'pickup' && (
                  <div className="pt-2">
                    <Label htmlFor="pickup_location" className="text-sm">Pick Up From *</Label>
                    <Select
                      value={form.pickup_location_id || ''}
                      onValueChange={(value: string) => setForm(prev => ({ ...prev, pickup_location_id: value }))}
                    >
                      <SelectTrigger id="pickup_location" className="mt-1">
                        <SelectValue placeholder="Select pickup location" />
                      </SelectTrigger>
                      <SelectContent>
                        {locations.filter(l => l.type === 'vendor' || l.type === 'plant').map(loc => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.name} ({loc.type})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="needed_by">Needed By *</Label>
                <Input
                  id="needed_by"
                  type="date"
                  value={form.needed_by_date}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, needed_by_date: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                />
                <p className="text-xs text-muted-foreground">
                  When you need the materials (not vendor promise date)
                </p>
              </div>
            </div>
            
            {/* Row 3: Cost Context */}
            <div className="space-y-2">
              <Label htmlFor="cost_context">Cost Context *</Label>
              <div className="flex gap-4">
                <Tabs
                  value={form.cost_context}
                  onValueChange={(value: string) => setForm(prev => ({ ...prev, cost_context: value as CostContext, job_id: value !== 'job' ? undefined : prev.job_id }))}
                  className="flex-1"
                >
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="job">Job</TabsTrigger>
                    <TabsTrigger value="yard">Yard Stock</TabsTrigger>
                    <TabsTrigger value="overhead">Overhead</TabsTrigger>
                  </TabsList>
                </Tabs>
                
                {form.cost_context === 'job' && (
                  <div className="flex-1">
                    <Select
                      value={form.job_id || ''}
                      onValueChange={(value: string) => setForm(prev => ({ ...prev, job_id: value }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select job" />
                      </SelectTrigger>
                      <SelectContent>
                        {jobs.map(job => (
                          <SelectItem key={job.id} value={job.id}>
                            {job.code} - {job.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* LINE ITEMS */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Line Items *</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAddLine}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add Line
              </Button>
            </div>
            
            {form.lines.length === 0 && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  Add at least one line item to continue
                </AlertDescription>
              </Alert>
            )}
            
            <div className="space-y-3">
              {form.lines.map((line, index) => (
                <LineItemInput
                  key={index}
                  line={line}
                  index={index}
                  onChange={(updates) => handleLineChange(index, updates)}
                  onRemove={() => handleRemoveLine(index)}
                />
              ))}
            </div>
            
            {/* Totals */}
            {form.lines.length > 0 && (
              <div className="border-t pt-4 space-y-2">
                {!hasUnknownPricing && total !== null && (
                  <div className="flex justify-between text-lg font-semibold">
                    <span>Estimated Total:</span>
                    <span>${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                )}
                
                {hasUnknownPricing && (
                  <div className="space-y-2">
                    <Alert className="bg-yellow-50 border-yellow-200">
                      <AlertCircle className="h-4 w-4 text-yellow-600" />
                      <AlertDescription className="text-yellow-800">
                        Some line items have unknown pricing. Please enter a maximum authorized spend.
                      </AlertDescription>
                    </Alert>
                    
                    <div className="flex items-center gap-2">
                      <Label htmlFor="max_spend" className="whitespace-nowrap">Max Authorized Spend *</Label>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <Input
                          id="max_spend"
                          type="number"
                          min="0"
                          step="0.01"
                          className="pl-7"
                          value={form.max_authorized_spend || ''}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, max_authorized_spend: parseFloat(e.target.value) || undefined }))}
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* ADVANCED SECTION (Collapsed) */}
          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              Advanced Options (Optional)
            </button>
            
            {showAdvanced && (
              <div className="mt-4 space-y-4 pl-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="vendor_quote">Vendor Quote/Ref #</Label>
                    <Input
                      id="vendor_quote"
                      value={form.vendor_quote_ref || ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, vendor_quote_ref: e.target.value }))}
                      placeholder="Q-12345"
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="expected_delivery">Expected Delivery Date</Label>
                    <Input
                      id="expected_delivery"
                      type="date"
                      value={form.expected_delivery_date || ''}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, expected_delivery_date: e.target.value }))}
                      min={new Date().toISOString().split('T')[0]}
                    />
                  </div>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="notes">PO Notes</Label>
                  <Textarea
                    id="notes"
                    value={form.notes || ''}
                    onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm(prev => ({ ...prev, notes: e.target.value }))}
                    placeholder="Special instructions, delivery requirements, etc."
                    rows={3}
                  />
                </div>
              </div>
            )}
          </div>
          
          {/* VALIDATION MESSAGES */}
          {validationErrors.length > 0 && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                <ul className="list-disc list-inside space-y-1">
                  {validationErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          
          {validationWarnings.length > 0 && validationErrors.length === 0 && (
            <Alert className="bg-yellow-50 border-yellow-200">
              <AlertCircle className="h-4 w-4 text-yellow-600" />
              <AlertDescription className="text-yellow-800">
                <ul className="list-disc list-inside space-y-1">
                  {validationWarnings.map((warn, i) => (
                    <li key={i}>{warn}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          
          {createError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{createError.message}</AlertDescription>
            </Alert>
          )}
        </div>
        
        {/* FOOTER ACTIONS */}
        <div className="flex justify-between items-center border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancel
          </Button>
          
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleSubmit}
              disabled={isLoading || validationErrors.length > 0}
            >
              Save as Draft
            </Button>
            
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={isLoading || validationErrors.length > 0}
            >
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create PO
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// =====================================================
// LINE ITEM INPUT COMPONENT
// =====================================================

interface LineItemInputProps {
  line: CreatePOLineInput;
  index: number;
  onChange: (updates: Partial<CreatePOLineInput>) => void;
  onRemove: () => void;
}

function LineItemInput({ line, index, onChange, onRemove }: LineItemInputProps) {
  const [itemType, setItemType] = useState<'catalog' | 'freetext'>(
    line.catalog_item_id ? 'catalog' : 'freetext'
  );
  
  const lineTotal = line.unit_cost 
    ? line.qty_ordered * line.unit_cost 
    : line.estimated_unit_cost 
    ? line.qty_ordered * line.estimated_unit_cost 
    : null;
  
  return (
    <div className="border rounded-lg p-4 space-y-3 bg-muted/50">
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">Line {index + 1}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="h-6 w-6 p-0"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      
      {/* Item Type Selector */}
      <Tabs
        value={itemType}
        onValueChange={(value: string) => {
          setItemType(value as 'catalog' | 'freetext');
          if (value === 'catalog') {
            onChange({ item_description: undefined, unit_of_measure: undefined });
          } else {
            onChange({ catalog_item_id: undefined });
          }
        }}
      >
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="catalog">Catalog Item</TabsTrigger>
          <TabsTrigger value="freetext">Free Text</TabsTrigger>
        </TabsList>
      </Tabs>
      
      {/* Item Selection */}
      <div className="grid grid-cols-2 gap-3">
        {itemType === 'catalog' ? (
          <div className="col-span-2 space-y-2">
            <Label className="text-sm">Item *</Label>
            <Input
              placeholder="Search catalog items..."
              value={line.catalog_item_id || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ catalog_item_id: e.target.value })}
            />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label className="text-sm">Description *</Label>
              <Input
                placeholder="e.g., Hot Mix Asphalt"
                value={line.item_description || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ item_description: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm">Unit of Measure *</Label>
              <Input
                placeholder="e.g., tons, bags, each"
                value={line.unit_of_measure || ''}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ unit_of_measure: e.target.value })}
              />
            </div>
          </>
        )}
      </div>
      
      {/* Quantity & Pricing */}
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Quantity *</Label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={line.is_approximate_qty || false}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ is_approximate_qty: e.target.checked })}
                className="rounded"
              />
              ~approx
            </label>
          </div>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={line.qty_ordered || ''}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ qty_ordered: parseFloat(e.target.value) || 0 })}
            placeholder="0.00"
          />
        </div>
        
        <div className="space-y-2">
          <Label className="text-sm">Unit Price</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
            <Input
              type="number"
              min="0"
              step="0.01"
              className="pl-7"
              value={line.unit_cost || ''}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ 
                unit_cost: parseFloat(e.target.value) || undefined,
                price_basis: 'fixed'
              })}
              placeholder="0.00"
            />
          </div>
        </div>
        
        <div className="space-y-2">
          <Label className="text-sm">Line Total</Label>
          <div className="h-10 px-3 py-2 bg-muted rounded-md text-sm font-medium">
            {lineTotal !== null ? `$${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : 'TBD'}
          </div>
        </div>
      </div>
      
      {/* Optional: Line Notes */}
      <div className="space-y-2">
        <Label className="text-sm">Line Notes (optional)</Label>
        <Input
          placeholder="e.g., fuel surcharge applies, backorder ok"
          value={line.line_notes || ''}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange({ line_notes: e.target.value })}
          className="text-sm"
        />
      </div>
    </div>
  );
}
