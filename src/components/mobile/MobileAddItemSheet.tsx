'use client';

import { useState, useRef, type CSSProperties } from 'react';
import { validateImageFile, resizeImage } from '@/lib/image-utils';

interface Category {
  id: string;
  name: string;
  sku_prefix?: string;
}

interface MobileAddItemSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onItemCreated: (line: any, newCategory?: Category) => void;
  jwt: string;
  bypassSecret: string;
  categories: Category[];
}

function bypassHeaders(secret: string): Record<string, string> {
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

function withBypass(url: string, secret: string): string {
  if (!secret) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}x-vercel-protection-bypass=${encodeURIComponent(secret)}`;
}

export function MobileAddItemSheet({
  isOpen,
  onClose,
  onItemCreated,
  jwt,
  bypassSecret,
  categories,
}: MobileAddItemSheetProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [skuPrefix, setSkuPrefix] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [uomLabel, setUomLabel] = useState('');
  const [uomTermId, setUomTermId] = useState('');
  const [trackingMode, setTrackingMode] = useState<'stock' | 'serialized' | 'both'>('stock');
  const [imageData, setImageData] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const resetForm = () => {
    setName('');
    setDescription('');
    setSkuPrefix('');
    setCategoryId('');
    setNewCategoryName('');
    setShowNewCategory(false);
    setUomLabel('');
    setUomTermId('');
    setTrackingMode('stock');
    setImageData(null);
    setImagePreview(null);
    setSuggesting(false);
    setSaving(false);
    setError('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handlePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validationError = validateImageFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      const dataUrl = await resizeImage(file);
      setImageData(dataUrl);
      setImagePreview(dataUrl);
      setError('');

      // Auto-trigger AI suggestions
      await fetchSuggestions(dataUrl, name);
    } catch {
      setError('Failed to process image');
    }
  };

  const fetchSuggestions = async (imgData?: string | null, itemName?: string) => {
    const imageToSend = imgData ?? imageData;
    const nameToSend = itemName ?? name;

    if (!imageToSend && !nameToSend?.trim()) return;

    setSuggesting(true);
    setError('');

    try {
      const res = await fetch(withBypass('/api/m/count/ai-photo-suggest', bypassSecret), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
          ...bypassHeaders(bypassSecret),
        },
        body: JSON.stringify({
          image_data: imageToSend || undefined,
          name: nameToSend?.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'AI suggestion failed');
      }

      const { suggestion } = await res.json();

      // Auto-fill fields
      if (suggestion.name && !name.trim()) setName(suggestion.name);
      if (suggestion.description) setDescription(suggestion.description);
      if (suggestion.sku_prefix) setSkuPrefix(suggestion.sku_prefix);
      if (suggestion.uom) setUomLabel(suggestion.uom);
      if (suggestion.uom_term_id) setUomTermId(suggestion.uom_term_id);
      if (suggestion.tracking_mode) setTrackingMode(suggestion.tracking_mode);

      if (suggestion.category_id) {
        setCategoryId(suggestion.category_id);
        setShowNewCategory(false);
        setNewCategoryName('');
      } else if (suggestion.new_category_name) {
        setCategoryId('__new__');
        setShowNewCategory(true);
        setNewCategoryName(suggestion.new_category_name);
      }
    } catch (err: any) {
      // Non-fatal — user can still fill fields manually
      console.error('AI suggest error:', err);
    } finally {
      setSuggesting(false);
    }
  };

  const handleNameBlur = () => {
    if (name.trim() && !description && !suggesting) {
      fetchSuggestions(imageData, name);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Item name is required');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload: any = {
        name: name.trim(),
        description: description.trim() || undefined,
        sku_prefix: skuPrefix.trim() || undefined,
        tracking_mode: trackingMode,
        add_to_count: true,
      };

      if (uomTermId) {
        payload.uom_term_id = uomTermId;
      } else if (uomLabel.trim()) {
        payload.unit_of_measure = uomLabel.trim();
      }

      if (showNewCategory && newCategoryName.trim()) {
        payload.new_category_name = newCategoryName.trim();
      } else if (categoryId && categoryId !== '__new__') {
        payload.category_id = categoryId;
      }

      if (imageData) {
        payload.image_data = imageData;
      }

      const res = await fetch(withBypass('/api/m/count/create-item', bypassSecret), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
          'X-Idempotency-Key': crypto.randomUUID(),
          ...bypassHeaders(bypassSecret),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to create item');
      }

      const { data } = await res.json();

      // Build new category if one was created
      let createdCategory: Category | undefined;
      if (showNewCategory && newCategoryName.trim() && data.category_id) {
        createdCategory = {
          id: data.category_id,
          name: newCategoryName.trim(),
        };
      }

      onItemCreated(data.count_line, createdCategory);
      resetForm();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create item');
    } finally {
      setSaving(false);
    }
  };

  const handleCategoryChange = (value: string) => {
    if (value === '__new__') {
      setCategoryId('__new__');
      setShowNewCategory(true);
      setNewCategoryName('');
    } else {
      setCategoryId(value);
      setShowNewCategory(false);
      setNewCategoryName('');
    }
  };

  const s: Record<string, CSSProperties> = {
    overlay: {
      position: 'fixed',
      inset: 0,
      background: '#f3f4f6',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      paddingTop: 'env(safe-area-inset-top, 0px)',
    },
    header: {
      background: '#fff',
      padding: '16px 20px',
      borderBottom: '1px solid #e5e7eb',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      fontSize: '18px',
      fontWeight: 700,
      color: '#111827',
      margin: 0,
    },
    closeBtn: {
      padding: '8px',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      color: '#6b7280',
    },
    body: {
      flex: 1,
      overflowY: 'auto' as const,
      padding: '16px',
    },
    photoSection: {
      background: '#fff',
      borderRadius: '14px',
      padding: '16px',
      marginBottom: '14px',
      textAlign: 'center' as const,
    },
    photoBtn: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      width: '100%',
      padding: '14px',
      background: '#eff6ff',
      border: '2px dashed #93c5fd',
      borderRadius: '12px',
      fontSize: '15px',
      fontWeight: 600,
      color: '#2563eb',
      cursor: 'pointer',
    },
    preview: {
      width: '100%',
      maxHeight: '200px',
      objectFit: 'cover' as const,
      borderRadius: '10px',
      marginBottom: '10px',
    },
    card: {
      background: '#fff',
      borderRadius: '14px',
      padding: '16px',
      marginBottom: '14px',
    },
    label: {
      display: 'block',
      fontSize: '13px',
      fontWeight: 600,
      color: '#374151',
      marginBottom: '4px',
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      border: '1.5px solid #d1d5db',
      borderRadius: '10px',
      fontSize: '15px',
      background: '#f9fafb',
      boxSizing: 'border-box' as const,
    },
    select: {
      width: '100%',
      padding: '10px 12px',
      border: '1.5px solid #d1d5db',
      borderRadius: '10px',
      fontSize: '15px',
      background: '#f9fafb',
      boxSizing: 'border-box' as const,
      WebkitAppearance: 'none' as any,
      appearance: 'auto' as any,
    },
    fieldGroup: {
      marginBottom: '14px',
    },
    suggestBanner: {
      background: '#eff6ff',
      border: '1px solid #bfdbfe',
      borderRadius: '10px',
      padding: '10px 14px',
      fontSize: '13px',
      color: '#1d4ed8',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '14px',
    },
    footer: {
      background: 'rgba(255,255,255,0.95)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderTop: '1px solid #e5e7eb',
      padding: '12px 20px',
      paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)',
    },
    saveBtn: {
      width: '100%',
      padding: '14px',
      background: saving ? '#9ca3af' : '#16a34a',
      color: '#fff',
      borderRadius: '14px',
      fontWeight: 600,
      fontSize: '16px',
      border: 'none',
      cursor: saving ? 'default' : 'pointer',
      boxShadow: saving ? 'none' : '0 4px 14px rgba(22,163,74,0.25)',
    },
    error: {
      color: '#dc2626',
      fontSize: '13px',
      marginBottom: '10px',
      textAlign: 'center' as const,
    },
    trackingRow: {
      display: 'flex',
      gap: '8px',
    },
    trackingBtn: {
      flex: 1,
      padding: '8px',
      borderRadius: '8px',
      fontSize: '13px',
      fontWeight: 500,
      border: 'none',
      cursor: 'pointer',
      textAlign: 'center' as const,
    },
  };

  return (
    <div style={s.overlay}>
      {/* Header */}
      <div style={s.header}>
        <h2 style={s.title}>New Item</h2>
        <button style={s.closeBtn} onClick={handleClose}>
          <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div style={s.body}>
        {/* AI suggest banner */}
        {suggesting && (
          <div style={s.suggestBanner}>
            <div style={{
              width: '16px', height: '16px',
              border: '2px solid #2563eb', borderTopColor: 'transparent',
              borderRadius: '50%', animation: 'm-spin 1s linear infinite',
              flexShrink: 0,
            }} />
            AI analyzing... fields will auto-fill
          </div>
        )}

        {/* Photo capture */}
        <div style={s.photoSection}>
          {imagePreview && (
            <img src={imagePreview} alt="Item photo" style={s.preview} />
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handlePhotoCapture}
            style={{ display: 'none' }}
          />
          <button
            style={s.photoBtn}
            onClick={() => fileInputRef.current?.click()}
            disabled={suggesting}
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {imagePreview ? 'Retake Photo' : 'Take Photo'}
          </button>
        </div>

        {/* Form fields */}
        <div style={s.card}>
          <div style={s.fieldGroup}>
            <label style={s.label}>Item Name *</label>
            <input
              style={s.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={handleNameBlur}
              placeholder="e.g. Hot Mix Asphalt"
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Description</label>
            <input
              style={s.input}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description"
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>SKU Prefix</label>
            <input
              style={s.input}
              value={skuPrefix}
              onChange={(e) => setSkuPrefix(e.target.value.toUpperCase())}
              placeholder="e.g. HMA"
              maxLength={5}
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Category</label>
            <select
              style={s.select}
              value={showNewCategory ? '__new__' : categoryId}
              onChange={(e) => handleCategoryChange(e.target.value)}
            >
              <option value="">-- Select --</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
              <option value="__new__">+ Create new...</option>
            </select>

            {showNewCategory && (
              <input
                style={{ ...s.input, marginTop: '8px' }}
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                placeholder="New category name"
                autoFocus
              />
            )}
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Unit of Measure</label>
            <input
              style={s.input}
              value={uomLabel}
              onChange={(e) => { setUomLabel(e.target.value); setUomTermId(''); }}
              placeholder="e.g. Ton, Each, Gallon"
            />
          </div>

          <div style={s.fieldGroup}>
            <label style={s.label}>Tracking Mode</label>
            <div style={s.trackingRow}>
              {(['stock', 'serialized', 'both'] as const).map((mode) => (
                <button
                  key={mode}
                  style={{
                    ...s.trackingBtn,
                    background: trackingMode === mode ? '#2563eb' : '#f3f4f6',
                    color: trackingMode === mode ? '#fff' : '#374151',
                  }}
                  onClick={() => setTrackingMode(mode)}
                >
                  {mode === 'stock' ? 'Stock' : mode === 'serialized' ? 'Serial' : 'Both'}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={s.footer}>
        {error && <div style={s.error}>{error}</div>}
        <button
          style={s.saveBtn}
          onClick={handleSave}
          disabled={saving || suggesting}
        >
          {saving ? 'Creating...' : 'Save & Add to Count'}
        </button>
      </div>
    </div>
  );
}
