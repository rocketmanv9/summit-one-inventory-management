/**
 * print_labels feature tests
 *
 * Covers the regex-fallback intent parsing (the no-AI path) and the
 * sessionStorage handoff the assets page consumes. The AI tool-calling path is
 * covered by tests/ai-tool-wiring.test.ts (definition, registry, intent gate).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseIntent } from '../src/lib/chat/intents';
import {
  stashPendingLabelBatch,
  consumePendingLabelBatch,
  PENDING_LABEL_BATCH_KEY,
  PENDING_LABEL_BATCH_EVENT,
} from '../src/lib/labels/pending-batch';

describe('print_labels intent parsing', () => {
  it('parses the canonical yard request with a location param', () => {
    const parsed = parseIntent('I need labels for all the assets in my yard');
    expect(parsed.type).toBe('print_labels');
    expect(parsed.extractedParams.location).toBe('yard');
  });

  it('parses bare "print labels"', () => {
    expect(parseIntent('print labels').type).toBe('print_labels');
  });

  it('parses "print barcodes for the shop" with location', () => {
    const parsed = parseIntent('print barcodes for everything at the shop');
    expect(parsed.type).toBe('print_labels');
    expect(parsed.extractedParams.location).toBe('shop');
  });

  it('wins precedence over create_asset for "create asset labels"', () => {
    expect(parseIntent('create asset labels').type).toBe('print_labels');
  });

  it('does not steal plain asset registration', () => {
    expect(parseIntent('create an asset').type).toBe('create_asset');
    expect(parseIntent('register a new asset').type).toBe('create_asset');
  });
});

describe('pending label batch handoff', () => {
  const store = new Map<string, string>();
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    store.clear();
    dispatchEvent.mockClear();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('Event', class { constructor(public type: string) {} });
  });

  it('stash → consume roundtrips and clears the key', () => {
    const batch = {
      items: [{ code: 'PAVER-001', label: 'PAVER-001 - Asphalt Paver', kind: 'individual' as const }],
      entityType: 'asset' as const,
    };
    stashPendingLabelBatch(batch);
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: PENDING_LABEL_BATCH_EVENT }));

    const consumed = consumePendingLabelBatch();
    expect(consumed).toEqual(batch);
    // Consumed = gone; a second read must not re-open the dialog.
    expect(consumePendingLabelBatch()).toBeNull();
    expect(store.has(PENDING_LABEL_BATCH_KEY)).toBe(false);
  });

  it('returns null for an empty or malformed batch', () => {
    expect(consumePendingLabelBatch()).toBeNull();
    store.set(PENDING_LABEL_BATCH_KEY, '{not json');
    expect(consumePendingLabelBatch()).toBeNull();
    store.set(PENDING_LABEL_BATCH_KEY, JSON.stringify({ items: [], entityType: 'asset' }));
    expect(consumePendingLabelBatch()).toBeNull();
  });
});
