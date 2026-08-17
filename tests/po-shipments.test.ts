/**
 * Unit tests for the shared carrier-shipment (ASN) helpers used by the PO
 * detail, desktop Receive modal, and mobile receiving surfaces.
 *
 * These shape the Amazon ship-notice metadata that lands on
 * punchout_orders.metadata.shipments[] and build the best-effort tracking URL.
 */
import { describe, it, expect } from 'vitest';
import { parseShipments, trackingUrl, shipDate } from '../src/lib/po/shipments';

describe('parseShipments', () => {
  it('shapes a metadata.shipments[] array as the ASN webhook writes it', () => {
    const raw = [
      {
        carrier: 'UPS',
        tracking_number: '1Z999AA10123456784',
        shipment_id: 'SHP-1',
        ship_date: '2026-08-17T10:00:00Z',
        delivery_date: '2026-08-19T00:00:00Z',
        received_at: '2026-08-17T10:05:00Z',
      },
    ];
    const out = parseShipments(raw);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      carrier: 'UPS',
      tracking_number: '1Z999AA10123456784',
      shipment_id: 'SHP-1',
      ship_date: '2026-08-17T10:00:00Z',
      delivery_date: '2026-08-19T00:00:00Z',
      received_at: '2026-08-17T10:05:00Z',
    });
  });

  it('defaults missing fields to null rather than undefined', () => {
    const out = parseShipments([{ carrier: 'FedEx' }]);
    expect(out[0]).toEqual({
      carrier: 'FedEx',
      tracking_number: null,
      shipment_id: null,
      ship_date: null,
      delivery_date: null,
      received_at: null,
    });
  });

  it('returns [] for non-array / missing metadata (no punchout order, no shipments)', () => {
    expect(parseShipments(undefined)).toEqual([]);
    expect(parseShipments(null)).toEqual([]);
    expect(parseShipments({})).toEqual([]);
    expect(parseShipments('nope')).toEqual([]);
  });

  it('preserves multiple shipments in order (a PO can ship in several boxes)', () => {
    const out = parseShipments([
      { carrier: 'UPS', tracking_number: 'A' },
      { carrier: 'FedEx', tracking_number: 'B' },
    ]);
    expect(out.map((s) => s.tracking_number)).toEqual(['A', 'B']);
  });
});

describe('trackingUrl', () => {
  it('maps known carriers to their tracking pages', () => {
    expect(trackingUrl('UPS', '1Z999')).toBe('https://www.ups.com/track?tracknum=1Z999');
    expect(trackingUrl('FedEx', '123')).toBe('https://www.fedex.com/fedextrack/?trknbr=123');
    expect(trackingUrl('USPS', '9400')).toBe('https://tools.usps.com/go/TrackConfirmAction?tLabels=9400');
    expect(trackingUrl('DHL', 'JD01')).toBe('https://www.dhl.com/us-en/home/tracking.html?tracking-id=JD01');
  });

  it('is case-insensitive on the carrier name', () => {
    expect(trackingUrl('ups ground', '1Z999')).toBe('https://www.ups.com/track?tracknum=1Z999');
  });

  it('falls back to a search for unknown/empty carriers', () => {
    expect(trackingUrl(null, 'XYZ')).toBe('https://www.google.com/search?q=XYZ');
    expect(trackingUrl('Some Regional Courier', 'XYZ')).toBe('https://www.google.com/search?q=XYZ');
  });

  it('url-encodes the tracking number and trims whitespace', () => {
    expect(trackingUrl('UPS', '  1Z 999  ')).toBe('https://www.ups.com/track?tracknum=1Z%20999');
  });

  it('returns null when there is no tracking number', () => {
    expect(trackingUrl('UPS', null)).toBeNull();
    expect(trackingUrl(null, null)).toBeNull();
  });
});

describe('shipDate', () => {
  it('trims an ISO timestamp to YYYY-MM-DD', () => {
    expect(shipDate('2026-08-17T10:00:00Z')).toBe('2026-08-17');
  });
  it('passes through a plain date', () => {
    expect(shipDate('2026-08-17')).toBe('2026-08-17');
  });
  it('returns null for null', () => {
    expect(shipDate(null)).toBeNull();
  });
});
