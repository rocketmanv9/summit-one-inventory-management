'use client';

import { useState, type CSSProperties } from 'react';
import { apiErrorMessage } from '@/lib/api-error';

interface MobileAddCategoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCategoryCreated: (category: { id: string; name: string; sku_prefix?: string }) => void;
  jwt: string;
  bypassSecret: string;
}

function bypassHeaders(secret: string): Record<string, string> {
  return secret ? { 'x-vercel-protection-bypass': secret } : {};
}

function withBypass(url: string, secret: string): string {
  if (!secret) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}x-vercel-protection-bypass=${encodeURIComponent(secret)}`;
}

export function MobileAddCategoryModal({
  isOpen,
  onClose,
  onCategoryCreated,
  jwt,
  bypassSecret,
}: MobileAddCategoryModalProps) {
  const [name, setName] = useState('');
  const [skuPrefix, setSkuPrefix] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const res = await fetch(withBypass('/api/m/count/create-category', bypassSecret), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`,
          'X-Idempotency-Key': crypto.randomUUID(),
          ...bypassHeaders(bypassSecret),
        },
        body: JSON.stringify({
          name: name.trim(),
          sku_prefix: skuPrefix.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(apiErrorMessage(data, 'Failed to create category'));
      }

      const { data } = await res.json();
      onCategoryCreated(data);
      setName('');
      setSkuPrefix('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create category');
    } finally {
      setSaving(false);
    }
  };

  const s: Record<string, CSSProperties> = {
    backdrop: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.5)',
      zIndex: 9999,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px',
    },
    modal: {
      background: '#fff',
      borderRadius: '16px',
      width: '100%',
      maxWidth: '360px',
      padding: '24px',
      boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
    },
    title: {
      fontSize: '18px',
      fontWeight: 700,
      color: '#111827',
      margin: '0 0 16px 0',
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
    fieldGroup: {
      marginBottom: '14px',
    },
    actions: {
      display: 'flex',
      gap: '10px',
      marginTop: '20px',
    },
    cancelBtn: {
      flex: 1,
      padding: '12px',
      background: '#f3f4f6',
      color: '#374151',
      borderRadius: '12px',
      fontWeight: 600,
      fontSize: '14px',
      border: 'none',
      cursor: 'pointer',
    },
    createBtn: {
      flex: 1,
      padding: '12px',
      background: saving ? '#9ca3af' : '#2563eb',
      color: '#fff',
      borderRadius: '12px',
      fontWeight: 600,
      fontSize: '14px',
      border: 'none',
      cursor: saving ? 'default' : 'pointer',
    },
    error: {
      color: '#dc2626',
      fontSize: '13px',
      marginTop: '8px',
    },
  };

  return (
    <div style={s.backdrop} onClick={onClose}>
      <div style={s.modal} onClick={(e) => e.stopPropagation()}>
        <h2 style={s.title}>New Category</h2>

        <div style={s.fieldGroup}>
          <label style={s.label}>Name *</label>
          <input
            style={s.input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Raw Materials"
            autoFocus
          />
        </div>

        <div style={s.fieldGroup}>
          <label style={s.label}>SKU Prefix (optional)</label>
          <input
            style={s.input}
            value={skuPrefix}
            onChange={(e) => setSkuPrefix(e.target.value.toUpperCase())}
            placeholder="e.g. RM"
            maxLength={10}
          />
        </div>

        {error && <div style={s.error}>{error}</div>}

        <div style={s.actions}>
          <button style={s.cancelBtn} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button style={s.createBtn} onClick={handleCreate} disabled={saving}>
            {saving ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
