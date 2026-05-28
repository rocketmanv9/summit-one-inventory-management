'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
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
import { BarcodeLabelDialog, type BarcodeLabelItem } from '@/components/modals/BarcodeLabelDialog';
import { BarcodeScannerOverlay } from '@/components/mobile/BarcodeScannerOverlay';
import { EntityImageUpload } from '@/components/ui/EntityImageUpload';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { SupplyChainRPC } from '@/lib/rpc/supply-chain';
import { useUOMTerms, useUOMLabelMap, useGVTerms, useGVLabelMap } from '@/hooks/useGVTerms';
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
  Sparkles,
  Barcode,
  ScanLine,
  Printer,
  ChevronDown,
  ChevronUp,
  Tags,
} from 'lucide-react';
import type { Database } from 'types/supabase';

type ItemCategoryRow = Database['inventory']['Tables']['item_categories']['Row'];

// ── Types ─────────────────────────────────────────────────────────────────

interface WizardState {
  // Step 1: Basics
  name: string;
  description: string;
  category_id: string;
  uom_term_id: string;
  tracking_mode: 'stock' | 'serialized' | 'both';
  reorder_point: string;
  base_sku: string;
  material_term_id: string;
  product_term_id: string;
  quality_tier_term_id: string;

  // Step 1b: Variants
  has_variants: boolean;
  variant_dimensions: string[];       // e.g. ["size", "color"]
  variant_options: Record<string, string[]>; // e.g. {"size":["S","M","L"],"color":["Red","Blue"]}
  new_dimension_name: string;
  new_option_value: string;

  // Step 2: Identifiers
  catalog_barcode: string;
  identifier_types: ('barcode' | 'qr')[];
  create_assets: boolean;
  asset_tag_prefix: string;
  asset_qty: string;
  serial_prefix: string;
  print_labels_on_success: boolean;

  // Step 3: Supply (merged vendor + stock)
  vendor_id: string;
  vendor_sku: string;
  vendor_unit_cost: string;
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

// COMMON_UOMS removed — now loaded dynamically from GV via useUOMTerms() hook

const STEPS = [
  { key: 'basics', label: 'Basics', icon: Package },
  { key: 'identifiers', label: 'Identifiers', icon: Tags },
  { key: 'supply', label: 'Supply', icon: Truck },
  { key: 'review', label: 'Review', icon: ClipboardList },
] as const;

const defaultState: WizardState = {
  name: '',
  description: '',
  category_id: '',
  uom_term_id: '',
  tracking_mode: 'stock',
  reorder_point: '',
  base_sku: '',
  material_term_id: '',
  product_term_id: '',
  quality_tier_term_id: '',
  has_variants: false,
  variant_dimensions: [],
  variant_options: {},
  new_dimension_name: '',
  new_option_value: '',
  catalog_barcode: '',
  identifier_types: ['barcode'],
  create_assets: false,
  asset_tag_prefix: '',
  asset_qty: '1',
  serial_prefix: '',
  print_labels_on_success: false,
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

  // GV dynamic UOM terms
  const { terms: uomTerms, loading: uomLoading } = useUOMTerms();
  const uomLabels = useUOMLabelMap();

  // GV material classification terms
  const { terms: materialTerms, loading: materialLoading } = useGVTerms('materials');
  const { terms: productTerms, loading: productLoading } = useGVTerms('material_product');
  const { terms: tierTerms, loading: tierLoading } = useGVTerms('quality_tier');
  const materialLabels = useGVLabelMap('materials');
  const productLabels = useGVLabelMap('material_product');
  const tierLabels = useGVLabelMap('quality_tier');

  // Inline create modals
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [showLocationModal, setShowLocationModal] = useState(false);

  // AI suggestion state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiFilled, setAiFilled] = useState(false);
  const [aiSuggestedCategory, setAiSuggestedCategory] = useState<string | null>(null);
  const [aiSuggestedSkuPrefix, setAiSuggestedSkuPrefix] = useState<string | null>(null);

  // Print labels dialog
  const [showLabelDialog, setShowLabelDialog] = useState(false);

  // Success state
  const [result, setResult] = useState<{
    item_id: string;
    item_sku: string;
    item_barcode?: string;
    created_asset_tags?: string[];
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

  // ── AI Suggest ──────────────────────────────────────────────────────
  const handleAiSuggest = useCallback(async () => {
    const trimmedName = form.name.trim();
    if (!trimmedName || aiLoading) return;

    setAiLoading(true);
    setError('');

    try {
      const res = await fetch('/api/ai/item-suggest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          existing_categories: categories.map(c => ({
            id: c.id,
            name: c.name,
            sku_prefix: c.sku_prefix,
          })),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'AI suggestion failed' }));
        setError(err.error || 'AI suggestion failed');
        return;
      }

      const { suggestion } = await res.json();

      setForm(prev => ({
        ...prev,
        description: suggestion.description || prev.description,
        uom_term_id: suggestion.uom_term_id || prev.uom_term_id,
        tracking_mode: suggestion.tracking_mode || prev.tracking_mode,
        reorder_point: suggestion.reorder_point != null ? String(suggestion.reorder_point) : prev.reorder_point,
        base_sku: suggestion.sku_prefix || prev.base_sku,
        category_id: suggestion.category_id || prev.category_id,
        identifier_types: suggestion.suggested_identifier_types || prev.identifier_types,
        // Variant fields from AI
        has_variants: suggestion.has_variants ?? prev.has_variants,
        variant_dimensions: suggestion.has_variants && Array.isArray(suggestion.variant_dimensions) && suggestion.variant_dimensions.length > 0
          ? suggestion.variant_dimensions
          : prev.variant_dimensions,
        variant_options: suggestion.has_variants && suggestion.variant_options && Object.keys(suggestion.variant_options).length > 0
          ? suggestion.variant_options
          : prev.variant_options,
      }));

      // If AI suggests a new category, store the name + prefix for pre-seeding
      if (suggestion.new_category_name && !suggestion.category_id) {
        setAiSuggestedCategory(suggestion.new_category_name);
        setAiSuggestedSkuPrefix(suggestion.sku_prefix || null);
      }

      setAiFilled(true);
    } catch {
      setError('Failed to get AI suggestions. Try again.');
    } finally {
      setAiLoading(false);
    }
  }, [form.name, aiLoading, categories]);

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

  const updateFormDirect = useCallback(<K extends keyof WizardState>(field: K, value: WizardState[K]) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (error) setError('');
  }, [error]);

  const canProceed = useCallback(() => {
    if (step === 0) {
      return !!form.name.trim();
    }
    return true; // Steps 2, 3 are optional
  }, [step, form.name]);

  // ── Build asset list for creation ──────────────────────────────────
  const buildAssetList = useCallback(() => {
    if (!form.create_assets) return null;
    const qty = Math.min(Math.max(1, parseInt(form.asset_qty) || 1), 100);
    const prefix = form.asset_tag_prefix || form.base_sku || 'ASSET';
    const serialPrefix = form.serial_prefix;
    const assets: Array<{ asset_tag: string; serial_number?: string }> = [];

    for (let i = 1; i <= qty; i++) {
      const num = String(i).padStart(3, '0');
      const asset: { asset_tag: string; serial_number?: string } = {
        asset_tag: `${prefix}-${num}`,
      };
      if (serialPrefix) {
        asset.serial_number = `${serialPrefix}-${num}`;
      }
      assets.push(asset);
    }
    return assets;
  }, [form.create_assets, form.asset_qty, form.asset_tag_prefix, form.base_sku, form.serial_prefix]);

  // ── Submit ────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSaving(true);
    setError('');

    try {
      const category = categories.find(c => c.id === form.category_id);
      const isManualSku = category?.sku_mode === 'manual';
      const assets = buildAssetList();

      // When variants are enabled, skip initial stock on the parent — it will be applied per variant
      const skipParentStock = form.has_variants && form.variant_dimensions.length > 0;

      const res = await InventoryRPC.wizardCreateItem({
        name: form.name.trim(),
        description: form.description.trim() || null,
        uom_term_id: form.uom_term_id || null,
        tracking_mode: form.tracking_mode,
        reorder_point: form.reorder_point ? Number(form.reorder_point) : null,
        base_sku: form.base_sku || null,
        sku: isManualSku ? undefined : null,
        category_id: form.category_id || null,
        vendor_id: form.vendor_id || null,
        vendor_sku: form.vendor_sku.trim() || null,
        vendor_unit_cost: form.vendor_unit_cost ? Number(form.vendor_unit_cost) : null,
        location_id: form.location_id || null,
        initial_qty: skipParentStock ? null : (form.initial_qty ? Number(form.initial_qty) : null),
        initial_cost: skipParentStock ? null : (form.initial_cost ? Number(form.initial_cost) : null),
        barcode: form.catalog_barcode.trim() || null,
        create_assets: assets,
        has_variants: form.has_variants,
        variant_dimensions: form.has_variants && form.variant_dimensions.length > 0 ? form.variant_dimensions : null,
        variant_options: form.has_variants && Object.keys(form.variant_options).length > 0 ? form.variant_options : null,
        idempotency_key: idempotencyKey,
      });

      // Update material classification term IDs (not part of the wizard RPC)
      const hasTermIds = form.material_term_id || form.product_term_id || form.quality_tier_term_id;
      if (hasTermIds) {
        const { createBrowserAuthedClient: createClient } = await import('@/supabase/client');
        const supaClient = createClient();
        const inv = (supaClient as any).schema('inventory');
        await inv.from('catalog_items').update({
          material_term_id: form.material_term_id || null,
          product_term_id: form.product_term_id || null,
          quality_tier_term_id: form.quality_tier_term_id || null,
        }).eq('id', res.item_id);
      }

      // Apply per-variant initial stock if variants were created and qty was specified
      if (skipParentStock && form.initial_qty && form.location_id) {
        const variantsEntity = res.created_entities?.find((e: any) => e.type === 'variants') as any;
        const variantIds: string[] = variantsEntity?.variant_ids || [];
        if (variantIds.length > 0) {
          const { createBrowserAuthedClient } = await import('@/supabase/client');
          const supa = createBrowserAuthedClient();
          const inv = (supa as any).schema('inventory');

          for (const variantId of variantIds) {
            const eventKey = `wiz-vstk-${variantId}-${idempotencyKey}`;
            // Create stock movement for each variant
            await inv.from('stock_movements').upsert({
              catalog_item_id: variantId,
              location_id: form.location_id,
              quantity_delta: Number(form.initial_qty),
              movement_type: 'adjusted',
              unit_cost: form.initial_cost ? Number(form.initial_cost) : null,
              reason: 'initial_stock',
              notes: 'Initial stock set during item wizard creation (per variant)',
              occurred_at: new Date().toISOString(),
              last_event_id: eventKey,
            }, { onConflict: 'tenant_id,last_event_id' });
          }
        }
      }

      setResult({
        item_id: res.item_id,
        item_sku: res.item_sku,
        item_barcode: res.item_barcode || form.catalog_barcode.trim() || undefined,
        created_asset_tags: res.created_asset_tags || [],
        created_entities: res.created_entities || [],
      });
      setStep(4); // Success step

      // Auto-open print dialog if user requested it
      if (form.print_labels_on_success) {
        setTimeout(() => setShowLabelDialog(true), 500);
      }
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

  // ── Build label items for print dialog ────────────────────────────────
  const buildLabelItems = useCallback((): BarcodeLabelItem[] => {
    if (!result) return [];
    const items: BarcodeLabelItem[] = [];

    // Catalog-level barcode label
    const barcodeCode = result.item_barcode || result.item_sku;
    if (barcodeCode) {
      items.push({ code: barcodeCode, label: form.name });
    }

    // Asset tag labels
    if (result.created_asset_tags && result.created_asset_tags.length > 0) {
      for (const tag of result.created_asset_tags) {
        items.push({ code: tag, label: `${tag} - ${form.name}` });
      }
    }

    return items;
  }, [result, form.name]);

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
            setForm={setForm}
            categories={categories}
            skuPreview={skuPreview}
            updateForm={updateForm}
            updateFormDirect={updateFormDirect}
            onAddCategory={() => setShowCategoryModal(true)}
            onAiSuggest={handleAiSuggest}
            aiLoading={aiLoading}
            aiFilled={aiFilled}
            aiSuggestedCategory={aiSuggestedCategory}
            onDismissSuggestedCategory={() => setAiSuggestedCategory(null)}
            uomTerms={uomTerms}
            uomLoading={uomLoading}
            materialTerms={materialTerms}
            materialLoading={materialLoading}
            productTerms={productTerms}
            productLoading={productLoading}
            tierTerms={tierTerms}
            tierLoading={tierLoading}
          />
        )}
        {step === 1 && (
          <StepIdentifiers
            form={form}
            updateForm={updateForm}
            updateFormDirect={updateFormDirect}
          />
        )}
        {step === 2 && (
          <StepSupply
            form={form}
            vendors={vendors}
            locations={locations}
            updateForm={updateForm}
            onAddVendor={() => setShowVendorModal(true)}
            onAddLocation={() => setShowLocationModal(true)}
          />
        )}
        {step === 3 && (
          <StepReview
            form={form}
            categories={categories}
            vendors={vendors}
            locations={locations}
            buildAssetList={buildAssetList}
            materialLabels={materialLabels}
            productLabels={productLabels}
            tierLabels={tierLabels}
          />
        )}
        {step === 4 && result && (
          <StepSuccess
            result={result}
            itemName={form.name}
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
            onPrintLabels={() => setShowLabelDialog(true)}
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
          defaultName={aiSuggestedCategory || undefined}
          defaultSkuPrefix={aiSuggestedSkuPrefix || undefined}
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

        {/* Print labels dialog */}
        {showLabelDialog && result && (
          <BarcodeLabelDialog
            items={buildLabelItems()}
            entityType="item"
            onClose={() => setShowLabelDialog(false)}
          />
        )}
      </div>
    </AppShell>
  );
}

// ── Step 1: Basics ──────────────────────────────────────────────────────

function StepBasics({
  form,
  setForm,
  categories,
  skuPreview,
  updateForm,
  updateFormDirect,
  onAddCategory,
  onAiSuggest,
  aiLoading,
  aiFilled,
  aiSuggestedCategory,
  onDismissSuggestedCategory,
  uomTerms,
  uomLoading,
  materialTerms,
  materialLoading,
  productTerms,
  productLoading,
  tierTerms,
  tierLoading,
}: {
  form: WizardState;
  setForm: React.Dispatch<React.SetStateAction<WizardState>>;
  categories: ItemCategoryRow[];
  skuPreview: string;
  updateForm: (field: keyof WizardState, value: string) => void;
  updateFormDirect: <K extends keyof WizardState>(field: K, value: WizardState[K]) => void;
  onAddCategory: () => void;
  onAiSuggest: () => void;
  aiLoading: boolean;
  aiFilled: boolean;
  aiSuggestedCategory: string | null;
  onDismissSuggestedCategory: () => void;
  uomTerms: { term_id: string; label: string }[];
  uomLoading: boolean;
  materialTerms: { term_id: string; label: string }[];
  materialLoading: boolean;
  productTerms: { term_id: string; label: string }[];
  productLoading: boolean;
  tierTerms: { term_id: string; label: string }[];
  tierLoading: boolean;
}) {
  const selectedCategory = categories.find(c => c.id === form.category_id);
  const isAttributeBased = selectedCategory?.sku_mode === 'attribute_based';
  const [classificationOpen, setClassificationOpen] = useState(
    !!(form.material_term_id || form.product_term_id || form.quality_tier_term_id)
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Item Basics</CardTitle>
        <CardDescription>
          Type a name, then hit the AI button to auto-fill the rest.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wiz-name">Item Name *</Label>
          <div className="flex gap-2">
            <Input
              id="wiz-name"
              value={form.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('name', e.target.value)}
              placeholder="e.g., Hot Mix Asphalt (HMA), Rebar #4, Diesel Fuel"
              autoFocus
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter' && form.name.trim()) {
                  e.preventDefault();
                  onAiSuggest();
                }
              }}
            />
            <Button
              type="button"
              variant={aiFilled ? 'outline' : 'default'}
              size="icon"
              onClick={onAiSuggest}
              disabled={!form.name.trim() || aiLoading}
              title="AI auto-fill from name"
              className={`shrink-0 ${aiFilled ? 'border-purple-300 text-purple-600 hover:bg-purple-50' : ''}`}
            >
              {aiLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
            </Button>
          </div>
          {aiLoading && (
            <p className="text-xs text-muted-foreground animate-pulse">
              Analyzing item and suggesting fields...
            </p>
          )}
          {aiFilled && !aiLoading && (
            <p className="text-xs text-purple-600">
              Fields auto-filled by AI. Review and adjust as needed.
            </p>
          )}
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
          {aiSuggestedCategory && !form.category_id && (
            <div className="flex items-center gap-2 rounded-md border border-purple-200 bg-purple-50/60 px-3 py-2 text-sm">
              <Sparkles className="h-3.5 w-3.5 text-purple-500 shrink-0" />
              <span className="text-purple-900">
                AI suggests category: <span className="font-medium">{aiSuggestedCategory}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  onAddCategory();
                  onDismissSuggestedCategory();
                }}
                className="ml-auto text-xs font-medium text-purple-700 hover:text-purple-900 underline"
              >
                Create it
              </button>
              <button
                type="button"
                onClick={onDismissSuggestedCategory}
                className="text-xs text-purple-400 hover:text-purple-600"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>

        {/* Material Classification (collapsible) */}
        <div className="rounded-md border">
          <button
            type="button"
            onClick={() => setClassificationOpen(!classificationOpen)}
            className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              Material Classification
              {(form.material_term_id || form.product_term_id || form.quality_tier_term_id) && (
                <Check className="h-3 w-3 text-green-600" />
              )}
            </span>
            {classificationOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {classificationOpen && (
            <div className="px-4 pb-4 space-y-4 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                Optionally classify this item by material type, product, and quality tier.
              </p>
              <div className="space-y-2">
                <Label htmlFor="wiz-material">Material</Label>
                <select
                  id="wiz-material"
                  value={form.material_term_id}
                  onChange={(e) => updateForm('material_term_id', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  disabled={materialLoading}
                >
                  <option value="">-- None --</option>
                  {materialLoading ? (
                    <option>Loading...</option>
                  ) : (
                    materialTerms.map((t) => (
                      <option key={t.term_id} value={t.term_id}>{t.label}</option>
                    ))
                  )}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wiz-product">Product Type</Label>
                <select
                  id="wiz-product"
                  value={form.product_term_id}
                  onChange={(e) => updateForm('product_term_id', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  disabled={productLoading}
                >
                  <option value="">-- None --</option>
                  {productLoading ? (
                    <option>Loading...</option>
                  ) : (
                    productTerms.map((t) => (
                      <option key={t.term_id} value={t.term_id}>{t.label}</option>
                    ))
                  )}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="wiz-tier">Quality Tier</Label>
                <select
                  id="wiz-tier"
                  value={form.quality_tier_term_id}
                  onChange={(e) => updateForm('quality_tier_term_id', e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  disabled={tierLoading}
                >
                  <option value="">-- None --</option>
                  {tierLoading ? (
                    <option>Loading...</option>
                  ) : (
                    tierTerms.map((t) => (
                      <option key={t.term_id} value={t.term_id}>{t.label}</option>
                    ))
                  )}
                </select>
              </div>
            </div>
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
              value={form.uom_term_id}
              onChange={(e) => {
                const selected = uomTerms.find(t => t.term_id === e.target.value);
                if (selected) {
                  setForm(prev => ({ ...prev, uom_term_id: selected.term_id }));
                } else {
                  updateForm('uom_term_id', e.target.value);
                }
              }}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              disabled={uomLoading}
            >
              {uomLoading ? (
                <option>Loading...</option>
              ) : uomTerms.length > 0 ? (
                uomTerms.map((uom) => (
                  <option key={uom.term_id} value={uom.term_id}>{uom.label}</option>
                ))
              ) : (
                <option value="EA">Each</option>
              )}
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

        {/* Variants toggle + dimension setup */}
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-semibold">Has Variants?</Label>
              <p className="text-xs text-muted-foreground">
                e.g., same item in different sizes, colors, or styles
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.has_variants}
              onClick={() => updateFormDirect('has_variants', !form.has_variants)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                form.has_variants ? 'bg-violet-600' : 'bg-gray-200'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                  form.has_variants ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {form.has_variants && (
            <div className="space-y-4 rounded-md border border-violet-200 bg-violet-50/30 p-4">
              {/* Add dimension */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-violet-700">
                  Variant Dimensions
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={form.new_dimension_name}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('new_dimension_name', e.target.value)}
                    placeholder="e.g., Size, Color, Style"
                    className="text-sm"
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const dim = form.new_dimension_name.trim().toLowerCase();
                        if (dim && !form.variant_dimensions.includes(dim)) {
                          updateFormDirect('variant_dimensions', [...form.variant_dimensions, dim]);
                          updateFormDirect('variant_options', { ...form.variant_options, [dim]: [] });
                          updateForm('new_dimension_name', '');
                        }
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const dim = form.new_dimension_name.trim().toLowerCase();
                      if (dim && !form.variant_dimensions.includes(dim)) {
                        updateFormDirect('variant_dimensions', [...form.variant_dimensions, dim]);
                        updateFormDirect('variant_options', { ...form.variant_options, [dim]: [] });
                        updateForm('new_dimension_name', '');
                      }
                    }}
                    disabled={!form.new_dimension_name.trim()}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                </div>
              </div>

              {/* Dimension pills + options per dimension */}
              {form.variant_dimensions.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  Add at least one dimension (e.g., &quot;size&quot;) to define variants.
                </p>
              )}

              {form.variant_dimensions.map((dim) => (
                <div key={dim} className="space-y-2 rounded-md border bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium capitalize">{dim}</span>
                    <button
                      type="button"
                      onClick={() => {
                        updateFormDirect(
                          'variant_dimensions',
                          form.variant_dimensions.filter(d => d !== dim),
                        );
                        const opts = { ...form.variant_options };
                        delete opts[dim];
                        updateFormDirect('variant_options', opts);
                      }}
                      className="text-xs text-red-500 hover:text-red-700"
                    >
                      Remove
                    </button>
                  </div>

                  {/* Option chips */}
                  <div className="flex flex-wrap gap-1.5">
                    {(form.variant_options[dim] || []).map((opt) => (
                      <span
                        key={opt}
                        className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-800"
                      >
                        {opt}
                        <button
                          type="button"
                          onClick={() => {
                            updateFormDirect('variant_options', {
                              ...form.variant_options,
                              [dim]: form.variant_options[dim].filter(o => o !== opt),
                            });
                          }}
                          className="ml-0.5 text-violet-500 hover:text-violet-800"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>

                  {/* Add option input */}
                  <div className="flex gap-2">
                    <Input
                      placeholder={`Add ${dim} value (e.g., ${dim === 'size' ? 'S, M, L, XL' : dim === 'color' ? 'Red, Blue' : 'Option 1'})`}
                      className="text-sm h-8"
                      onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const val = (e.target as HTMLInputElement).value.trim();
                          if (val && !(form.variant_options[dim] || []).includes(val)) {
                            updateFormDirect('variant_options', {
                              ...form.variant_options,
                              [dim]: [...(form.variant_options[dim] || []), val],
                            });
                            (e.target as HTMLInputElement).value = '';
                          }
                        }
                      }}
                    />
                  </div>
                </div>
              ))}

              {/* Variant count preview */}
              {form.variant_dimensions.length > 0 && (() => {
                const counts = form.variant_dimensions.map(d => (form.variant_options[d] || []).length);
                const total = counts.every(c => c > 0) ? counts.reduce((a, b) => a * b, 1) : 0;
                const skuBase = form.base_sku || form.name.slice(0, 6).toUpperCase().replace(/\s+/g, '') || 'ITEM';

                return (
                  <div className="rounded-md border border-dashed border-violet-300 bg-violet-50/60 p-3 text-sm">
                    <div className="text-xs font-semibold uppercase tracking-wide text-violet-600">
                      Variant Preview
                    </div>
                    {total > 0 ? (
                      <>
                        <p className="mt-1 text-violet-900">
                          <span className="font-mono font-bold">{total}</span> variant{total !== 1 ? 's' : ''} will be created
                          {' '}({form.variant_dimensions.map(d => `${(form.variant_options[d] || []).length} ${d}`).join(' x ')})
                        </p>
                        <div className="mt-2 font-mono text-xs text-violet-700 space-y-0.5">
                          {(() => {
                            // Show first few example SKUs
                            const examples: string[] = [];
                            const dims = form.variant_dimensions;
                            const firstOpts = dims.map(d => form.variant_options[d] || []);
                            // Generate up to 3 examples
                            outer:
                            for (const o0 of firstOpts[0] || []) {
                              if (firstOpts.length === 1) {
                                examples.push(`${skuBase}-${o0.toUpperCase()}`);
                                if (examples.length >= 3) break;
                              } else {
                                for (const o1 of firstOpts[1] || []) {
                                  const suffix = [o0, o1].map(v => v.toUpperCase()).join('-');
                                  examples.push(`${skuBase}-${suffix}`);
                                  if (examples.length >= 3) break outer;
                                }
                              }
                            }
                            return (
                              <>
                                {examples.map((ex, i) => <div key={i}>{ex}</div>)}
                                {total > 3 && <div>... and {total - 3} more</div>}
                              </>
                            );
                          })()}
                        </div>
                      </>
                    ) : (
                      <p className="mt-1 text-violet-600 italic">
                        Add values to each dimension to generate variants.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Step 2: Identifiers ──────────────────────────────────────────────────

function StepIdentifiers({
  form,
  updateForm,
  updateFormDirect,
}: {
  form: WizardState;
  updateForm: (field: keyof WizardState, value: string) => void;
  updateFormDirect: <K extends keyof WizardState>(field: K, value: WizardState[K]) => void;
}) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const showAssets = form.tracking_mode === 'serialized' || form.tracking_mode === 'both';

  const toggleIdentifierType = (type: 'barcode' | 'qr') => {
    const current = form.identifier_types;
    if (current.includes(type)) {
      updateFormDirect('identifier_types', current.filter(t => t !== type));
    } else {
      updateFormDirect('identifier_types', [...current, type]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Identifiers & Labels</CardTitle>
        <CardDescription>
          Set a catalog barcode and configure label printing.
          {showAssets && ' You can also create initial asset tags.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Catalog barcode */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Barcode className="h-4 w-4" /> Catalog Barcode
          </h4>
          <div className="flex gap-2">
            <Input
              value={form.catalog_barcode}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('catalog_barcode', e.target.value)}
              placeholder="Scan or type barcode / UPC..."
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setScannerOpen(true)}
              title="Scan barcode with camera"
            >
              <ScanLine className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => updateForm('catalog_barcode', form.base_sku || 'SKU')}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Auto-generate from SKU prefix
            </button>
          </div>
        </div>

        {/* Label types */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Label Types to Print</h4>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.identifier_types.includes('barcode')}
                onChange={() => toggleIdentifierType('barcode')}
                className="rounded border-input"
              />
              Barcode (Code 128)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.identifier_types.includes('qr')}
                onChange={() => toggleIdentifierType('qr')}
                className="rounded border-input"
              />
              QR Code
            </label>
          </div>
        </div>

        {/* Asset batch creation (serialized / both only) */}
        {showAssets && (
          <div className="space-y-3 border-t pt-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold flex items-center gap-2">
                <Tags className="h-4 w-4" /> Initial Assets
              </h4>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.create_assets}
                  onChange={(e) => updateFormDirect('create_assets', e.target.checked)}
                  className="rounded border-input"
                />
                Create assets now
              </label>
            </div>

            {form.create_assets && (
              <div className="space-y-3 rounded-md border p-4 bg-muted/30">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="wiz-tag-prefix">Asset Tag Prefix</Label>
                    <Input
                      id="wiz-tag-prefix"
                      value={form.asset_tag_prefix}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('asset_tag_prefix', e.target.value.toUpperCase())}
                      placeholder={form.base_sku || 'e.g., HMA'}
                      className="font-mono"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wiz-asset-qty">Quantity (1-100)</Label>
                    <Input
                      id="wiz-asset-qty"
                      type="number"
                      min="1"
                      max="100"
                      value={form.asset_qty}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('asset_qty', e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="wiz-serial-prefix">Serial Number Prefix (optional)</Label>
                  <Input
                    id="wiz-serial-prefix"
                    value={form.serial_prefix}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('serial_prefix', e.target.value)}
                    placeholder="e.g., SN"
                    className="font-mono"
                  />
                </div>

                {/* Preview */}
                <div className="rounded-md border border-dashed border-blue-200 bg-blue-50/60 p-3 text-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-blue-600">Asset Preview</div>
                  <div className="mt-1 font-mono text-xs text-blue-900 space-y-0.5">
                    {(() => {
                      const prefix = form.asset_tag_prefix || form.base_sku || 'ASSET';
                      const qty = Math.min(Math.max(1, parseInt(form.asset_qty) || 1), 100);
                      const show = Math.min(qty, 3);
                      const lines = [];
                      for (let i = 1; i <= show; i++) {
                        const num = String(i).padStart(3, '0');
                        let line = `${prefix}-${num}`;
                        if (form.serial_prefix) line += ` (S/N: ${form.serial_prefix}-${num})`;
                        lines.push(line);
                      }
                      if (qty > 3) lines.push(`... and ${qty - 3} more`);
                      return lines.map((l, i) => <div key={i}>{l}</div>);
                    })()}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.print_labels_on_success}
                    onChange={(e) => updateFormDirect('print_labels_on_success', e.target.checked)}
                    className="rounded border-input"
                  />
                  <Printer className="h-3.5 w-3.5" />
                  Print labels after creation
                </label>
              </div>
            )}

            {!form.create_assets && (
              <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground text-center">
                No assets will be created. You can add individual assets later from the item details page.
              </div>
            )}
          </div>
        )}

        {/* Scanner overlay */}
        <BarcodeScannerOverlay
          isOpen={scannerOpen}
          onClose={() => setScannerOpen(false)}
          onScan={(code) => {
            updateForm('catalog_barcode', code);
            setScannerOpen(false);
          }}
        />
      </CardContent>
    </Card>
  );
}

// ── Step 3: Supply (Vendor + Stock merged) ──────────────────────────────

function StepSupply({
  form,
  vendors,
  locations,
  updateForm,
  onAddVendor,
  onAddLocation,
}: {
  form: WizardState;
  vendors: Vendor[];
  locations: Location[];
  updateForm: (field: keyof WizardState, value: string) => void;
  onAddVendor: () => void;
  onAddLocation: () => void;
}) {
  const uomLabels = useUOMLabelMap();
  const [vendorOpen, setVendorOpen] = useState(!!form.vendor_id);
  const [stockOpen, setStockOpen] = useState(!!form.location_id);
  const selectedVendor = vendors.find(v => v.id === form.vendor_id);
  const isAmazonVendor = selectedVendor?.code === 'AMAZON-BIZ';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Supply Chain</CardTitle>
        <CardDescription>
          Optionally link a vendor and set starting stock. Both sections are skippable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Vendor section */}
        <div className="rounded-md border">
          <button
            type="button"
            onClick={() => setVendorOpen(!vendorOpen)}
            className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Preferred Vendor
              {form.vendor_id && <Check className="h-3 w-3 text-green-600" />}
            </span>
            {vendorOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {vendorOpen && (
            <div className="px-4 pb-4 space-y-4 border-t">
              <div className="space-y-2 pt-3">
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
                    <Label htmlFor="wiz-vendor-sku">
                      {isAmazonVendor ? 'Amazon ASIN' : 'Vendor SKU / Part Number'}
                    </Label>
                    <Input
                      id="wiz-vendor-sku"
                      value={form.vendor_sku}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        let val = e.target.value;
                        if (isAmazonVendor) val = val.toUpperCase();
                        updateForm('vendor_sku', val);
                      }}
                      placeholder={isAmazonVendor ? 'e.g., B08N5WRWNW' : "Vendor's part number for this item"}
                      className="font-mono"
                      maxLength={isAmazonVendor ? 10 : undefined}
                    />
                    {isAmazonVendor && (
                      <p className="text-xs text-muted-foreground">
                        Enter the 10-character Amazon ASIN (e.g., B08N5WRWNW). This will be used as the vendor SKU for Amazon Business ordering.
                      </p>
                    )}
                    {isAmazonVendor && form.vendor_sku && !/^[A-Z0-9]{10}$/.test(form.vendor_sku) && (
                      <p className="text-xs text-amber-600">
                        ASIN should be exactly 10 alphanumeric characters.
                      </p>
                    )}
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
            </div>
          )}
        </div>

        {/* Stock section */}
        <div className="rounded-md border">
          <button
            type="button"
            onClick={() => setStockOpen(!stockOpen)}
            className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Starting Stock
              {form.location_id && form.initial_qty && <Check className="h-3 w-3 text-green-600" />}
            </span>
            {stockOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {stockOpen && (
            <div className="px-4 pb-4 space-y-4 border-t">
              <div className="space-y-2 pt-3">
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
                    <Label htmlFor="wiz-qty">
                      {form.has_variants ? 'Qty per Variant *' : 'Quantity *'}
                    </Label>
                    <Input
                      id="wiz-qty"
                      type="number"
                      min="0"
                      value={form.initial_qty}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm('initial_qty', e.target.value)}
                      placeholder={form.has_variants ? 'Qty for each variant' : 'Initial stock quantity'}
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
                  {form.has_variants ? (() => {
                    const counts = form.variant_dimensions.map(d => (form.variant_options[d] || []).length);
                    const variantTotal = counts.every(c => c > 0) ? counts.reduce((a, b) => a * b, 1) : 0;
                    const totalUnits = variantTotal * Number(form.initial_qty || 0);
                    return (
                      <p className="mt-1 text-blue-900">
                        <span className="font-mono font-bold">{form.initial_qty}</span> {uomLabels[form.uom_term_id] || 'EA'}
                        {' '}&times; <span className="font-mono font-bold">{variantTotal}</span> variant{variantTotal !== 1 ? 's' : ''}
                        {' '}= <span className="font-mono font-bold">{totalUnits}</span> total units
                        {form.initial_cost && (
                          <> at <span className="font-mono font-bold">${Number(form.initial_cost).toFixed(2)}</span>/unit</>
                        )}{' '}
                        at the selected location.
                      </p>
                    );
                  })() : (
                    <p className="mt-1 text-blue-900">
                      This will create an <span className="font-medium">initial stock adjustment</span> of{' '}
                      <span className="font-mono font-bold">{form.initial_qty}</span> {uomLabels[form.uom_term_id] || 'EA'}
                      {form.initial_cost && (
                        <> at <span className="font-mono font-bold">${Number(form.initial_cost).toFixed(2)}</span>/unit</>
                      )}{' '}
                      at the selected location.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
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
  buildAssetList,
  materialLabels,
  productLabels,
  tierLabels,
}: {
  form: WizardState;
  categories: ItemCategoryRow[];
  vendors: Vendor[];
  locations: Location[];
  buildAssetList: () => Array<{ asset_tag: string; serial_number?: string }> | null;
  materialLabels: Record<string, string>;
  productLabels: Record<string, string>;
  tierLabels: Record<string, string>;
}) {
  const uomLabels = useUOMLabelMap();
  const category = categories.find(c => c.id === form.category_id);
  const vendor = vendors.find(v => v.id === form.vendor_id);
  const location = locations.find(l => l.id === form.location_id);
  const assets = buildAssetList();

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
            <span>{uomLabels[form.uom_term_id] || 'EA'}</span>
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

        {/* Material Classification */}
        {(form.material_term_id || form.product_term_id || form.quality_tier_term_id) && (
          <div className="rounded-md border p-4 space-y-2">
            <h4 className="text-sm font-semibold">Material Classification</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {form.material_term_id && (
                <>
                  <span className="text-muted-foreground">Material</span>
                  <span>{materialLabels[form.material_term_id] || '-'}</span>
                </>
              )}
              {form.product_term_id && (
                <>
                  <span className="text-muted-foreground">Product Type</span>
                  <span>{productLabels[form.product_term_id] || '-'}</span>
                </>
              )}
              {form.quality_tier_term_id && (
                <>
                  <span className="text-muted-foreground">Quality Tier</span>
                  <span>{tierLabels[form.quality_tier_term_id] || '-'}</span>
                </>
              )}
            </div>
          </div>
        )}

        {/* Variants */}
        {form.has_variants && form.variant_dimensions.length > 0 && (
          <div className="rounded-md border border-violet-200 bg-violet-50/30 p-4 space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2 text-violet-700">
              <Package className="h-4 w-4" /> Variants
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">Dimensions</span>
              <span className="capitalize">{form.variant_dimensions.join(', ')}</span>
              {form.variant_dimensions.map(dim => (
                <Fragment key={dim}>
                  <span className="text-muted-foreground capitalize">{dim} values</span>
                  <span>{(form.variant_options[dim] || []).join(', ') || 'None'}</span>
                </Fragment>
              ))}
              <span className="text-muted-foreground">Total variants</span>
              <span className="font-mono font-bold">
                {form.variant_dimensions.map(d => (form.variant_options[d] || []).length).every(c => c > 0)
                  ? form.variant_dimensions.map(d => (form.variant_options[d] || []).length).reduce((a, b) => a * b, 1)
                  : 0}
              </span>
            </div>
          </div>
        )}

        {/* Identifiers */}
        {(form.catalog_barcode || (assets && assets.length > 0)) && (
          <div className="rounded-md border p-4 space-y-2">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Barcode className="h-4 w-4" /> Identifiers
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              {form.catalog_barcode && (
                <>
                  <span className="text-muted-foreground">Barcode</span>
                  <span className="font-mono">{form.catalog_barcode}</span>
                </>
              )}
              <span className="text-muted-foreground">Label Types</span>
              <span>{form.identifier_types.join(', ') || 'None'}</span>
              {assets && assets.length > 0 && (
                <>
                  <span className="text-muted-foreground">Assets to Create</span>
                  <span>{assets.length} asset{assets.length !== 1 ? 's' : ''}</span>
                </>
              )}
            </div>
          </div>
        )}

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
                  <span className="text-muted-foreground">
                    {vendor.code === 'AMAZON-BIZ' ? 'ASIN' : 'Vendor SKU'}
                  </span>
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
              <span className="text-muted-foreground">
                {form.has_variants ? 'Qty per Variant' : 'Quantity'}
              </span>
              <span className="font-mono">{form.initial_qty} {uomLabels[form.uom_term_id] || 'EA'}</span>
              {form.has_variants && form.variant_dimensions.length > 0 && (() => {
                const counts = form.variant_dimensions.map(d => (form.variant_options[d] || []).length);
                const variantTotal = counts.every(c => c > 0) ? counts.reduce((a, b) => a * b, 1) : 0;
                const totalUnits = variantTotal * Number(form.initial_qty || 0);
                return (
                  <>
                    <span className="text-muted-foreground">Total Stock</span>
                    <span className="font-mono">{totalUnits} {uomLabels[form.uom_term_id] || 'EA'} ({variantTotal} variants)</span>
                  </>
                );
              })()}
              {form.initial_cost && (
                <>
                  <span className="text-muted-foreground">Unit Cost</span>
                  <span>${Number(form.initial_cost).toFixed(2)}</span>
                </>
              )}
            </div>
          </div>
        )}

        {!vendor && !location && !form.catalog_barcode && (
          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground text-center">
            No vendor, identifiers, or starting stock configured. These can be added later.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Step 5: Success ─────────────────────────────────────────────────────

function StepSuccess({
  result,
  itemName,
  onGoToItems,
  onCreateAnother,
  onCreatePO,
  onTransfer,
  onReserve,
  onAdjustStock,
  onPrintLabels,
}: {
  result: {
    item_id: string;
    item_sku: string;
    item_barcode?: string;
    created_asset_tags?: string[];
    created_entities: Array<{ type: string; name?: string }>;
  };
  itemName: string;
  onGoToItems: () => void;
  onCreateAnother: () => void;
  onCreatePO: () => void;
  onTransfer: () => void;
  onReserve: () => void;
  onAdjustStock: () => void;
  onPrintLabels: () => void;
}) {
  const entityLabels: Record<string, string> = {
    category: 'Category',
    vendor: 'Vendor',
    location: 'Location',
    item: 'Item',
    vendor_item: 'Vendor-Item Link',
    initial_stock: 'Initial Stock',
    asset: 'Asset',
  };

  const hasLabels = !!(result.item_barcode || result.item_sku || (result.created_asset_tags && result.created_asset_tags.length > 0));

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
              {result.item_barcode && (
                <> | Barcode: <span className="font-mono font-bold">{result.item_barcode}</span></>
              )}
            </p>
            <div className="pt-2">
              <EntityImageUpload entityType="catalog_item" entityId={result.item_id} size="lg" />
            </div>
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

          {/* Print Labels button */}
          {hasLabels && (
            <div className="mt-4 pt-4 border-t">
              <Button onClick={onPrintLabels} variant="outline" className="w-full gap-2">
                <Printer className="h-4 w-4" />
                Print Labels ({result.created_asset_tags?.length
                  ? `${1 + result.created_asset_tags.length} labels`
                  : '1 label'
                })
              </Button>
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
