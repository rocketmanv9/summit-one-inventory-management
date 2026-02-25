'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CategoryModal } from '@/components/modals/CategoryModal';
import { AddVendorModal } from '@/components/modals/AddVendorModal';
import { AddLocationModal } from '@/components/modals/AddLocationModal';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  AlertCircle,
  Plus,
  Package,
  Truck,
  MapPin,
  ClipboardList,
  ShoppingCart,
  ArrowLeftRight,
  CalendarCheck,
} from 'lucide-react';
import type { Database } from 'types/supabase';

type ItemCategoryRow = Database['inventory']['Tables']['item_categories']['Row'];

// ── Types ─────────────────────────────────────────────────────────────────

interface WizardState {
  // Step 1: Basics
  name: string;
  description: string;
  category_id: string;
  unit_of_measure: string;
  tracking_mode: 'stock' | 'serialized' | 'both';
  reorder_point: string;
  base_sku: string;

  // Step 2: Vendor
  vendor_id: string;
  vendor_sku: string;
  vendor_unit_cost: string;

  // Step 3: Stock
  location_id: string;
  initial_qty: string;
  initial_cost: string;
}

interface Vendor {
  id: string;
  name: string;
  code?: string | null;
}

interface Location {
  id: string;
  name: string;
  location_type?: { name?: string } | null;
}

const COMMON_UOMS = [
  { value: 'EA', label: 'Each (EA)' },
  { value: 'BOX', label: 'Box' },
  { value: 'CASE', label: 'Case' },
  { value: 'LB', label: 'Pound (LB)' },
  { value: 'KG', label: 'Kilogram (KG)' },
  { value: 'TON', label: 'Ton' },
  { value: 'GAL', label: 'Gallon' },
  { value: 'LTR', label: 'Liter' },
  { value: 'FT', label: 'Foot (FT)' },
  { value: 'M', label: 'Meter (M)' },
  { value: 'YD', label: 'Yard (YD)' },
  { value: 'PALLET', label: 'Pallet' },
  { value: 'ROLL', label: 'Roll' },
  { value: 'BAG', label: 'Bag' },
  { value: 'DRUM', label: 'Drum' },
];

const STEPS = [
  { key: 'basics', label: 'Basics', icon: Package },
  { key: 'vendor', label: 'Vendor', icon: Truck },
  { key: 'stock', label: 'Stock', icon: MapPin },
  { key: 'review', label: 'Review', icon: ClipboardList },
] as const;

const defaultState: WizardState = {
  name: '',
  description: '',
  category_id: '',
  unit_of_measure: 'EA',
  tracking_mode: 'stock',
  reorder_point: '',
  base_sku: '',
  vendor_id: '',
  vendor_sku: '',
  vendor_unit_cost: '',
  location_id: '',
  initial_qty: '',
  initial_cost: '',
};

// ── Main Page ─────────────────────────────────────────────────────────────

export default function NewItemWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<WizardState>(defaultState);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  // Reference data
  const [categories, setCategories] = useState<ItemCategoryRow[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [skuPreview, setSkuPreview] = useState('');

  // Inline create modals
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);

  // Success state
  const [result, setResult] = useState<{
    item_id: string;
    item_sku: string;
    created_entities: Array<{ type: string; name?: string }>;
  } | null>(null);

  // ── Load reference data ───────────────────────────────────────────────
  useEffect(() => {
    loadCategories();
    loadVendors();
    loadLocations();
  }, []);

  const loadCategories = async () => {
    try {
      const data = await InventoryRPC.getItemCategories();
      setCategories(data || []);
    } catch (err) {
      console.error('Error loading categories:', err);
    }
  };

  const loadVendors = async () => {
    try {
      const data = await SupplyChainRPC.getVendors();
      setVendors((data || []).map(v => ({ id: v.id, name: v.name, code: v.code })));
    } catch (err) {
      console.error('Error loading vendors:', err);
    }
  };

  const loadLocations = async () => {
    try {
      const data = await InventoryRPC.getLocations();
      setLocations((data || []) as Location[]);
    } catch (err) {
      console.error('Error loading locations:', err);
    }
  };

  // ── SKU Preview ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!form.category_id) {
      setSkuPreview('');
      return;
    }
    const category = categories.find(c => c.id === form.category_id);
    if (!category) {
      setSkuPreview('');
      return;
    }
    const mode = category.sku_mode || 'sequential';
    if (mode === 'manual') {
      setSkuPreview('Manual entry required');
      return;
    }
    const prefix = category.sku_prefix ? category.sku_prefix.toUpperCase() : '';
    const parent = categories.find(c => c.id === category.parent_category_id);
    const parentPrefix = parent?.sku_prefix ? parent.sku_prefix.toUpperCase() : '';

    if (mode === 'attribute_based') {
      const baseSku = form.base_sku?.toUpperCase() || 'XXX';
      const parts = [parentPrefix, prefix, baseSku].filter(Boolean);
      setSkuPreview(parts.join('-'));
    } else {
      setSkuPreview(prefix ? `${prefix}-###` : '###');
    }
  }, [form.category_id, form.base_sku, categories]);

  // ── Form helpers ──────────────────────────────────────────────────────
  const updateForm = useCallback((field: keyof WizardState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
  }, [error]);

  const canProceed = useCallback(() => {
    if (step === 0) {
      return !!form.name.trim();
    }
    return true; // Steps 2 and 3 are optional
  }, [step, form.name]);

  // ── Submit ────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSaving(true);
    setError('');

    try {
      const category = categories.find(c => c.id === form.category_id);
      const isManualSku = category?.sku_mode === 'manual';

      const res = await InventoryRPC.wizardCreateItem({
        name: form.name.trim(),
        description: form.description.trim() || null,
        unit_of_measure: form.unit_of_measure || 'EA',
        tracking_mode: form.tracking_mode,
        reorder_point: form.reorder_point ? Number(form.reorder_point) : null,
        base_sku: form.base_sku || null,
        sku: isManualSku ? undefined : null,
        category_id: form.category_id || null,
        vendor_id: form.vendor_id || null,
        vendor_sku: form.vendor_sku.trim() || null,
        vendor_unit_cost: form.vendor_unit_cost ? Number(form.vendor_unit_cost) : null,
        location_id: form.location_id || null,
        initial_qty: form.initial_qty ? Number(form.initial_qty) : null,
        initial_cost: form.initial_cost ? Number(form.initial_cost) : null,
        idempotency_key: idempotencyKey,
      });

      setResult({
        item_id: res.item_id,
        item_sku: res.item_sku,
        created_entities: res.created_entities || [],
      });
      setStep(4); // Success step
    } catch (err: any) {
      setError(err.message || 'Failed to create item.');
    } finally {
      setSaving(false);
    }
  };

  // ── Navigation ────────────────────────────────────────────────────────
  const goNext = () => {
    if (step === 3) {
      handleSubmit();
    } else {
      setStep(s => Math.min(s + 1, 3));
    }
  };

  const goBack = () => {
    setStep(s => Math.max(s - 1, 0));
  };

  // ── Inline create callbacks ───────────────────────────────────────────
  const handleCategoryCreated = async () => {
    setShowCategoryModal(false);
    const cats = await InventoryRPC.getItemCategories();
    setCategories(cats || []);
    const newest = (cats || []).sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
    if (newest) {
      updateForm('category_id', newest.id);
    }
  };

  const handleVendorCreated = async () => {
    setShowVendorModal(false);
    const vends = await SupplyChainRPC.getVendors();
    const mapped = (vends || []).map(v => ({ id: v.id, name: v.name, code: v.code }));
    setVendors(mapped);
    const newest = (vends || []).sort((a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
    if (newest) {
      updateForm('vendor_id', newest.id);
    }
  };

  const handleLocationCreated = async (loc: { id: string; name: string }) => {
    setShowLocationModal(false);
    await loadLocations();
    updateForm('location_id', loc.id);
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className="max-w-3xl mx-auto py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/inventory/items')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Add New Item</h1>
            <p className="text-sm text-muted-foreground">
              Create an item and make it operational in one guided flow.
            </p>
          </div>
        </div>

        {/* Step indicator */}
        {step < 4 && (
          <nav className="flex items-center gap-2">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isActive = i === step;
              const isDone = i < step;
              return (
                <button
                  key={s.key}
                  onClick={() => i < step && setStep(i)}
                  disabled={i > step}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : isDone
                        ? 'bg-primary/10 text-primary cursor-pointer hover:bg-primary/20'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {isDone ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">{s.label}</span>
                  <span className="sm:hidden">{i + 1}</span>
                </button>
              );
            })}
          </nav>
        )}

        {/* Error */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Step content */}
        {step === 0 && (
          <StepBasics
            form={form}
            categories={categories}
            skuPreview={skuPreview}
            updateForm={updateForm}
            onAddCategory={() => setShowCategoryModal(true)}
          />
        )}
        {step === 1 && (
          <StepVendor
            form={form}
            vendors={vendors}
            updateForm={updateForm}
            onAddVendor={() => setShowVendorModal(true)}
          />
        )}
        {step === 2 && (
          <StepStock
            form={form}
            locations={locations}
            updateForm={updateForm}
            onAddLocation={() => setShowLocationModal(true)}
          />
        )}
        {step === 3 && (
          <StepReview
            form={form}
            categories={categories}
            vendors={vendors}
            locations={locations}
          />
        )}
        {step === 4 && result && (
          <StepSuccess
            result={result}
            onGoToItems={() => router.push('/inventory/items')}
            onCreateAnother={() => {
              setForm(defaultState);
              setResult(null);
              setStep(0);
            }}
            onCreatePO={() => router.push(`/inventory/purchasing/create?item_id=${result.item_id}`)}
            onTransfer={() => router.push(`/inventory/transfers?item_id=${result.item_id}`)}
            onReserve={() => router.push(`/inventory/reservations?item_id=${result.item_id}`)}
            onAdjustStock={() => router.push(`/inventory/stock?item_id=${result.item_id}`)}
          />
        )}

        {/* Navigation buttons */}
        {step < 4 && (
          <div className="flex items-center justify-between pt-4 border-t">
            <Button
              variant="ghost"
              onClick={step === 0 ? () => router.push('/inventory/items') : goBack}
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              {step === 0 ? 'Cancel' : 'Back'}
            </Button>
            <Button
              onClick={goNext}
              disabled={!canProceed() || saving}
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {step === 3 ? 'Create Item' : 'Continue'}
              {step < 3 && <ArrowRight className="h-4 w-4 ml-2" />}
            </Button>
          </div>
        )}

        {/* Inline modals */}
        <CategoryModal
          open={showCategoryModal}
          onClose={() => setShowCategoryModal(false)}
          onSuccess={handleCategoryCreated}
        />
        <AddVendorModal
          open={showVendorModal}
          onClose={() => setShowVendorModal(false)}
          onSuccess={handleVendorCreated}
        />
        <AddLocationModal
          open={showLocationModal}
          onClose={() => setShowLocationModal(false)}
          onSuccess={handleLocationCreated}
        />
      </div>
    </AppShell>
  );
}

// ── Step 1: Basics ──────────────────────────────────────────────────────

function StepBasics({
  form,
  categories,
  skuPreview,
  updateForm,
  onAddCategory,
}: {
  form: WizardState;
  categories: ItemCategoryRow[];
  skuPreview: string;
  updateForm: (field: keyof WizardState, value: string) => void;
  onAddCategory: () => void;
}) {
  const selectedCategory = categories.find(c => c.id === form.category_id);
  const isAttributeBased = selectedCategory?.sku_mode === 'attribute_based';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Item Basics</CardTitle>
        <CardDescription>
          Define the item name, category, unit of measure, and tracking mode.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wiz-name">Item Name *</Label>
          <Input
            id="wiz-name"
            value={form.name}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('name', e.target.value)}
            placeholder="e.g., Hot Mix Asphalt (HMA), Rebar #4, Diesel Fuel"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="wiz-desc">Description</Label>
          <textarea
            id="wiz-desc"
            value={form.description}
            onChange={(e) => updateForm('description', e.target.value)}
            className="flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={2}
            placeholder="Detailed item description..."
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="wiz-category">Category</Label>
            <button
              type="button"
              onClick={onAddCategory}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Create New
            </button>
          </div>
          <select
            id="wiz-category"
            value={form.category_id}
            onChange={(e) => updateForm('category_id', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">-- No Category --</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.name}</option>
            ))}
          </select>
          {skuPreview && (
            <p className="text-xs text-muted-foreground">
              SKU preview: <span className="font-mono font-medium">{skuPreview}</span>
            </p>
          )}
        </div>

        {isAttributeBased && (
          <div className="space-y-2">
            <Label htmlFor="wiz-base-sku">Base SKU Code</Label>
            <Input
              id="wiz-base-sku"
              value={form.base_sku}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('base_sku', e.target.value.toUpperCase())}
              placeholder="e.g., HMA or RB4"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              Used in attribute-based SKU assembly. Leave blank for auto-numbering.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="wiz-uom">Unit of Measure</Label>
            <select
              id="wiz-uom"
              value={form.unit_of_measure}
              onChange={(e) => updateForm('unit_of_measure', e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {COMMON_UOMS.map((uom) => (
                <option key={uom.value} value={uom.value}>{uom.label}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wiz-tracking">Tracking Mode</Label>
            <select
              id="wiz-tracking"
              value={form.tracking_mode}
              onChange={(e) => updateForm('tracking_mode', e.target.value as WizardState['tracking_mode'])}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="stock">Stock (quantity-based)</option>
              <option value="serialized">Serialized (individual assets)</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="wiz-reorder">Default Reorder Point</Label>
          <Input
            id="wiz-reorder"
            type="number"
            min="0"
            value={form.reorder_point}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('reorder_point', e.target.value)}
            placeholder="Optional - triggers low stock alerts"
          />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 2: Vendor ──────────────────────────────────────────────────────

function StepVendor({
  form,
  vendors,
  updateForm,
  onAddVendor,
}: {
  form: WizardState;
  vendors: Vendor[];
  updateForm: (field: keyof WizardState, value: string) => void;
  onAddVendor: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Preferred Vendor</CardTitle>
        <CardDescription>
          Optionally link a vendor to this item. You can skip this step.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="wiz-vendor">Vendor</Label>
            <button
              type="button"
              onClick={onAddVendor}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Create New
            </button>
          </div>
          <select
            id="wiz-vendor"
            value={form.vendor_id}
            onChange={(e) => updateForm('vendor_id', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">-- No Vendor (Skip) --</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} {v.code ? `(${v.code})` : ''}
              </option>
            ))}
          </select>
        </div>

        {form.vendor_id && (
          <>
            <div className="space-y-2">
              <Label htmlFor="wiz-vendor-sku">Vendor SKU / Part Number</Label>
              <Input
                id="wiz-vendor-sku"
                value={form.vendor_sku}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('vendor_sku', e.target.value)}
                placeholder="Vendor's part number for this item"
                className="font-mono"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="wiz-vendor-cost">Vendor Unit Cost ($)</Label>
              <Input
                id="wiz-vendor-cost"
                type="number"
                min="0"
                step="0.01"
                value={form.vendor_unit_cost}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('vendor_unit_cost', e.target.value)}
                placeholder="Cost per unit from this vendor"
              />
            </div>
          </>
        )}

        {!form.vendor_id && (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground text-center">
            No vendor selected. You can add one later from the item details or vendor catalog.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Step 3: Starting Stock ──────────────────────────────────────────────

function StepStock({
  form,
  locations,
  updateForm,
  onAddLocation,
}: {
  form: WizardState;
  locations: Location[];
  updateForm: (field: keyof WizardState, value: string) => void;
  onAddLocation: () => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Starting Stock</CardTitle>
        <CardDescription>
          Optionally set initial inventory at a location. This creates a ledger adjustment entry.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="wiz-location">Location</Label>
            <button
              type="button"
              onClick={onAddLocation}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Create New
            </button>
          </div>
          <select
            id="wiz-location"
            value={form.location_id}
            onChange={(e) => updateForm('location_id', e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">-- No Starting Stock (Skip) --</option>
            {locations.map((loc) => (
              <option key={loc.id} value={loc.id}>{loc.name}</option>
            ))}
          </select>
        </div>

        {form.location_id && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="wiz-qty">Quantity *</Label>
              <Input
                id="wiz-qty"
                type="number"
                min="0"
                value={form.initial_qty}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('initial_qty', e.target.value)}
                placeholder="Initial stock quantity"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="wiz-cost">Unit Cost ($)</Label>
              <Input
                id="wiz-cost"
                type="number"
                min="0"
                step="0.01"
                value={form.initial_cost}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('initial_cost', e.target.value)}
                placeholder="Cost per unit"
              />
            </div>
          </div>
        )}

        {form.location_id && form.initial_qty && (
          <div className="rounded-md border border-dashed border-blue-200 bg-blue-50/60 p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">Ledger Preview</div>
            <p className="mt-1 text-blue-900">
              This will create an <span className="font-medium">initial stock adjustment</span> of{' '}
              <span className="font-mono font-bold">{form.initial_qty}</span> {form.unit_of_measure}
              {form.initial_cost && (
                <> at <span className="font-mono font-bold">${Number(form.initial_cost).toFixed(2)}</span>/unit</>
              )}{' '}
              at the selected location.
            </p>
          </div>
        )}

        {!form.location_id && (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground text-center">
            No starting stock. You can adjust stock later from the Stock page.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Step 4: Review ──────────────────────────────────────────────────────

function StepReview({
  form,
  categories,
  vendors,
  locations,
}: {
  form: WizardState;
  categories: ItemCategoryRow[];
  vendors: Vendor[];
  locations: Location[];
}) {
  const category = categories.find(c => c.id === form.category_id);
  const vendor = vendors.find(v => v.id === form.vendor_id);
  const location = locations.find(l => l.id === form.location_id);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Review & Create</CardTitle>
        <CardDescription>
          Verify the details below. Click "Create Item" to proceed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Item basics */}
        <div className="rounded-md border p-4 space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Package className="h-4 w-4" /> Item
          </h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted-foreground">Name</span>
            <span className="font-medium">{form.name}</span>
            {form.description && (
              <>
                <span className="text-muted-foreground">Description</span>
                <span>{form.description}</span>
              </>
            )}
            <span className="text-muted-foreground">Category</span>
            <span>{category?.name || 'None'}</span>
            <span className="text-muted-foreground">UOM</span>
            <span>{form.unit_of_measure}</span>
            <span className="text-muted-foreground">Tracking</span>
            <span className="capitalize">{form.tracking_mode}</span>
            {form.reorder_point && (
              <>
                <span className="text-muted-foreground">Reorder Point</span>
                <span>{form.reorder_point}</span>
              </>
            )}
          </div>
        </div>

        {/* Vendor */}
        {vendor && (
          <div className="rounded-md border p-4 space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Truck className="h-4 w-4" /> Preferred Vendor
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">Vendor</span>
              <span className="font-medium">{vendor.name}</span>
              {form.vendor_sku && (
                <>
                  <span className="text-muted-foreground">Vendor SKU</span>
                  <span className="font-mono">{form.vendor_sku}</span>
                </>
              )}
              {form.vendor_unit_cost && (
                <>
                  <span className="text-muted-foreground">Unit Cost</span>
                  <span>${Number(form.vendor_unit_cost).toFixed(2)}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Starting stock */}
        {location && form.initial_qty && (
          <div className="rounded-md border p-4 space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Starting Stock
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">Location</span>
              <span className="font-medium">{location.name}</span>
              <span className="text-muted-foreground">Quantity</span>
              <span className="font-mono">{form.initial_qty} {form.unit_of_measure}</span>
              {form.initial_cost && (
                <>
                  <span className="text-muted-foreground">Unit Cost</span>
                  <span>${Number(form.initial_cost).toFixed(2)}</span>
                </>
              )}
            </div>
          </div>
        )}

        {!vendor && !location && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground text-center">
            No vendor or starting stock configured. These can be added later.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Step 5: Success ─────────────────────────────────────────────────────

function StepSuccess({
  result,
  onGoToItems,
  onCreateAnother,
  onCreatePO,
  onTransfer,
  onReserve,
  onAdjustStock,
}: {
  result: { item_id: string; item_sku: string; created_entities: Array<{ type: string; name?: string }> };
  onGoToItems: () => void;
  onCreateAnother: () => void;
  onCreatePO: () => void;
  onTransfer: () => void;
  onReserve: () => void;
  onAdjustStock: () => void;
}) {
  const entityLabels: Record<string, string> = {
    category: 'Category',
    vendor: 'Vendor',
    location: 'Location',
    item: 'Item',
    vendor_item: 'Vendor-Item Link',
    initial_stock: 'Initial Stock',
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="pt-6">
          <div className="text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <h2 className="text-xl font-bold">Item Created Successfully</h2>
            <p className="text-muted-foreground">
              SKU: <span className="font-mono font-bold">{result.item_sku}</span>
            </p>
          </div>

          {result.created_entities.length > 0 && (
            <div className="mt-4 border-t pt-4">
              <h4 className="text-sm font-semibold mb-2">Created in this flow:</h4>
              <ul className="space-y-1">
                {result.created_entities.map((entity, i) => (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <Check className="h-3 w-3 text-green-600" />
                    <span className="font-medium">{entityLabels[entity.type] || entity.type}</span>
                    {entity.name && <span className="text-muted-foreground">- {entity.name}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Next Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Next Actions</CardTitle>
          <CardDescription>Optional steps to do with your new item.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="justify-start gap-2" onClick={onCreatePO}>
              <ShoppingCart className="h-4 w-4" /> Create Purchase Order
            </Button>
            <Button variant="outline" className="justify-start gap-2" onClick={onAdjustStock}>
              <Package className="h-4 w-4" /> Adjust Stock
            </Button>
            <Button variant="outline" className="justify-start gap-2" onClick={onTransfer}>
              <ArrowLeftRight className="h-4 w-4" /> Transfer Stock
            </Button>
            <Button variant="outline" className="justify-start gap-2" onClick={onReserve}>
              <CalendarCheck className="h-4 w-4" /> Reserve Stock
            </Button>
          </div>

          <div className="flex gap-3 mt-6 pt-4 border-t">
            <Button variant="outline" onClick={onCreateAnother} className="flex-1">
              Create Another Item
            </Button>
            <Button onClick={onGoToItems} className="flex-1">
              Back to Items
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
