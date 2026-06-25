'use client';

import { useState, useEffect } from 'react';
import { AppError } from '@rocketmanv9/chassis/errors';
import { InventoryRPC } from '@/lib/rpc/inventory';
import { AssetTypeClassFields } from '@/components/assets/AssetTypeClassFields';
import type { Database } from 'types/supabase';

type CatalogItemRow = Database['inventory']['Tables']['catalog_items']['Row'];
type LocationRow = Database['inventory']['Tables']['locations']['Row'];
type LocationTypeRow = Database['inventory']['Tables']['location_types']['Row'];
type CatalogItemOption = Pick<CatalogItemRow, 'id' | 'name' | 'sku'>;

const KIND_LABELS: Record<string, string> = {
  vehicle: 'Vehicle',
  equipment: 'Equipment',
  tool: 'Tool',
};

/**
 * Create one or more serialized assets. When `lockedKind` is provided (Fleet
 * pages) the Fleet Type is fixed and the GV Type/Class pickers default to that
 * kind. Otherwise the user picks the Fleet Type and the GV Type follows it.
 */
export function CreateAssetModal({
  onClose,
  onComplete,
  lockedKind,
}: {
  onClose: () => void;
  onComplete: () => void;
  lockedKind?: 'vehicle' | 'equipment' | 'tool';
}) {
  const [catalogItems, setCatalogItems] = useState<CatalogItemOption[]>([]);
  const [locations, setLocations] = useState<(LocationRow & { location_type?: Pick<LocationTypeRow, 'name'> | null })[]>([]);
  const [form, setForm] = useState({
    catalog_item_id: '',
    location_id: '',
    quantity: 1,
    asset_tag_prefix: '',
    serial_number_prefix: '',
    purchase_date: '',
    purchase_cost: '',
    warranty_expires: '',
    asset_kind: lockedKind || '',
    asset_type_term_id: '',
    equipment_class_id: '',
    make: '',
    model: '',
    model_year: '',
  });
  const [useAutoNumbering, setUseAutoNumbering] = useState(true);
  const [customTags, setCustomTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchCatalogItems();
    fetchLocations();
  }, []);

  const fetchCatalogItems = async () => {
    try {
      const data = await InventoryRPC.getCatalogItems({ active: true });
      setCatalogItems(data || []);
    } catch (error) {
      console.error('Error fetching items:', error);
    }
  };

  const fetchLocations = async () => {
    try {
      const data = await InventoryRPC.getLocations();
      setLocations(data || []);
    } catch (error) {
      console.error('Error fetching locations:', error);
    }
  };

  // Changing the fleet kind invalidates the GV type/class (different domains).
  const setAssetKind = (asset_kind: string) =>
    setForm((f) => ({ ...f, asset_kind, asset_type_term_id: '', equipment_class_id: '' }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');

    try {
      const quantity = parseInt(form.quantity.toString());
      let tagsToCreate: string[] = [];

      if (quantity === 1) {
        tagsToCreate = [form.asset_tag_prefix];
      } else if (useAutoNumbering) {
        for (let i = 1; i <= quantity; i++) {
          tagsToCreate.push(`${form.asset_tag_prefix}${String(i).padStart(3, '0')}`);
        }
      } else {
        tagsToCreate = customTags
          .split('\n')
          .map(tag => tag.trim())
          .filter(tag => tag.length > 0);

        if (tagsToCreate.length !== quantity) {
          throw AppError.badRequest(`Expected ${quantity} custom tags, but found ${tagsToCreate.length}`);
        }
      }

      for (let i = 0; i < tagsToCreate.length; i++) {
        const serial = (useAutoNumbering && quantity > 1 && form.serial_number_prefix)
          ? `${form.serial_number_prefix}${String(i + 1).padStart(3, '0')}`
          : form.serial_number_prefix || null;

        await InventoryRPC.createAsset({
          catalog_item_id: form.catalog_item_id || null,
          location_id: form.location_id || null,
          asset_tag: tagsToCreate[i],
          serial_number: serial,
          purchase_date: form.purchase_date || null,
          purchase_cost: form.purchase_cost ? parseFloat(form.purchase_cost) : null,
          warranty_expires: form.warranty_expires || null,
          status: 'available',
          // Classifies the asset for Fleet sync. vehicle/equipment/tool mirror to
          // Fleet; blank = inventory-only, never synced out.
          asset_kind: form.asset_kind || null,
          // GV-backed classification (loose refs into the GV project).
          asset_type_term_id: form.asset_type_term_id || null,
          equipment_class_id: form.asset_kind === 'equipment' ? (form.equipment_class_id || null) : null,
          make: form.make.trim() || null,
          model: form.model.trim() || null,
          model_year: form.model_year ? parseInt(form.model_year, 10) : null,
        } as any);
      }

      onComplete();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary';
  const quantity = parseInt(form.quantity.toString());

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b flex items-center justify-between sticky top-0 bg-white">
          <h3 className="text-lg font-semibold">
            {lockedKind ? `Add ${KIND_LABELS[lockedKind]}` : 'Create Asset(s)'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-600">
              {error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Item Type *</label>
              <select
                value={form.catalog_item_id}
                onChange={(e) => setForm({ ...form, catalog_item_id: e.target.value })}
                className={inputClass}
                required
              >
                <option value="">Select item type...</option>
                {catalogItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.sku} - {item.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                Example: &quot;Leaf Blower Pro 3000&quot; - you can create multiple individual assets from this
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Quantity *</label>
              <input
                type="number"
                min="1"
                max="100"
                value={form.quantity}
                onChange={(e) => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })}
                className={inputClass}
                required
              />
              <p className="text-xs text-muted-foreground mt-1">
                Create multiple assets at once (e.g., 10 leaf blowers)
              </p>
            </div>

            {!lockedKind && (
              <div>
                <label className="block text-sm font-medium mb-1">Fleet Type</label>
                <select
                  value={form.asset_kind}
                  onChange={(e) => setAssetKind(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Inventory only (don&apos;t sync)</option>
                  <option value="equipment">Equipment</option>
                  <option value="vehicle">Vehicle</option>
                  <option value="tool">Tool</option>
                </select>
                <p className="text-xs text-muted-foreground mt-1">
                  Vehicles &amp; equipment sync to Fleet automatically
                </p>
              </div>
            )}

            <AssetTypeClassFields
              assetKind={form.asset_kind}
              typeTermId={form.asset_type_term_id}
              classId={form.equipment_class_id}
              onTypeChange={(v) => setForm((f) => ({ ...f, asset_type_term_id: v }))}
              onClassChange={(v) => setForm((f) => ({ ...f, equipment_class_id: v }))}
            />

            <div>
              <label className="block text-sm font-medium mb-1">Make</label>
              <input
                type="text"
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
                className={inputClass}
                placeholder="e.g. CAT"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <input
                type="text"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                className={inputClass}
                placeholder="e.g. 279D3"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Model Year</label>
              <input
                type="number"
                value={form.model_year}
                onChange={(e) => setForm({ ...form, model_year: e.target.value })}
                className={inputClass}
                placeholder="e.g. 2022"
              />
            </div>

            <div className="col-span-2">
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium">
                  {quantity === 1 ? 'Asset Tag *' : 'Asset Tags *'}
                </label>
                {quantity > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      setUseAutoNumbering(!useAutoNumbering);
                      if (useAutoNumbering) {
                        const tags = Array.from({ length: quantity }, (_, i) =>
                          `${form.asset_tag_prefix}${String(i + 1).padStart(3, '0')}`
                        ).join('\n');
                        setCustomTags(tags);
                      }
                    }}
                    className="text-xs text-primary hover:underline"
                  >
                    {useAutoNumbering ? '✏️ Customize Tags' : '🔢 Auto-Number'}
                  </button>
                )}
              </div>

              {quantity === 1 || useAutoNumbering ? (
                <>
                  <input
                    type="text"
                    value={form.asset_tag_prefix}
                    onChange={(e) => setForm({ ...form, asset_tag_prefix: e.target.value })}
                    className={inputClass}
                    placeholder={quantity === 1 ? 'LEAF-BLOWER-001' : 'LEAF-BLOWER-'}
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {quantity === 1
                      ? 'Full asset tag for single item'
                      : `Auto-numbering: ${form.asset_tag_prefix}001, ${form.asset_tag_prefix}002, etc.`}
                  </p>
                </>
              ) : (
                <>
                  <textarea
                    value={customTags}
                    onChange={(e) => setCustomTags(e.target.value)}
                    className={`${inputClass} font-mono text-sm`}
                    rows={Math.min(quantity, 10)}
                    placeholder="LEAF-BLOWER-001&#10;LEAF-BLOWER-002&#10;LEAF-BLOWER-003"
                    required
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Enter {form.quantity} custom asset tags (one per line). Current: {customTags.split('\n').filter(t => t.trim()).length} tags
                  </p>
                </>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Location</label>
              <select
                value={form.location_id}
                onChange={(e) => setForm({ ...form, location_id: e.target.value })}
                className={inputClass}
              >
                <option value="">Select location...</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.location_type?.name || 'Unknown'})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Serial/RFID Prefix</label>
              <input
                type="text"
                value={form.serial_number_prefix}
                onChange={(e) => setForm({ ...form, serial_number_prefix: e.target.value })}
                className={inputClass}
                placeholder="RFID-"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Optional: Auto-numbered for bulk creation
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Purchase Date</label>
              <input
                type="date"
                value={form.purchase_date}
                onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Purchase Cost (each)</label>
              <input
                type="number"
                step="0.01"
                value={form.purchase_cost}
                onChange={(e) => setForm({ ...form, purchase_cost: e.target.value })}
                className={inputClass}
                placeholder="0.00"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Warranty Expires</label>
              <input
                type="date"
                value={form.warranty_expires}
                onChange={(e) => setForm({ ...form, warranty_expires: e.target.value })}
                className={inputClass}
              />
            </div>
          </div>

          {quantity > 1 && useAutoNumbering && (
            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="font-medium text-blue-900 mb-1">🔢 Auto-Numbering Preview</div>
              <div className="text-sm text-blue-700">
                Creating {form.quantity} assets: {form.asset_tag_prefix}001 through {form.asset_tag_prefix}{String(form.quantity).padStart(3, '0')}
              </div>
            </div>
          )}

          {quantity > 1 && !useAutoNumbering && customTags && (
            <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="font-medium text-purple-900 mb-1">✏️ Custom Tags Preview</div>
              <div className="text-sm text-purple-700 max-h-32 overflow-y-auto">
                {customTags.split('\n').filter(t => t.trim()).slice(0, 5).map((tag, i) => (
                  <div key={i}>{i + 1}. {tag}</div>
                ))}
                {customTags.split('\n').filter(t => t.trim()).length > 5 && (
                  <div className="text-purple-600">... and {customTags.split('\n').filter(t => t.trim()).length - 5} more</div>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border text-gray-700 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? `Creating ${form.quantity} asset(s)...` : `Create ${form.quantity} Asset(s)`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
