/**
 * Carrier shipment (ASN) shared types + display helpers.
 *
 * A shipment is what the Amazon Business ship-notice webhook appends to a
 * linked punchout order's `metadata.shipments[]` (see
 * src/app/api/webhooks/amazon-business/ship-notice/route.ts). It carries the
 * carrier + tracking number captured when Amazon dispatches the box.
 *
 * These helpers are shared by every surface that renders that tracking so the
 * carrier-URL logic lives in exactly one place: the desktop PO-detail vendor
 * activity, the desktop Receive modal, and the mobile receiving screen.
 */

export interface Shipment {
  carrier: string | null;
  tracking_number: string | null;
  shipment_id: string | null;
  ship_date: string | null;
  delivery_date: string | null;
  received_at: string | null;
}

/** Coerce an unknown `metadata.shipments` value into a typed array. */
export function parseShipments(raw: unknown): Shipment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s: any) => ({
    carrier: s?.carrier ?? null,
    tracking_number: s?.tracking_number ?? null,
    shipment_id: s?.shipment_id ?? null,
    ship_date: s?.ship_date ?? null,
    delivery_date: s?.delivery_date ?? null,
    received_at: s?.received_at ?? null,
  }));
}

/** Build a best-effort carrier tracking URL from the ASN carrier + number. */
export function trackingUrl(carrier: string | null, num: string | null): string | null {
  if (!num) return null;
  const c = (carrier || '').toLowerCase();
  const n = encodeURIComponent(num.trim());
  if (c.includes('ups')) return `https://www.ups.com/track?tracknum=${n}`;
  if (c.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${n}`;
  if (c.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${n}`;
  if (c.includes('dhl')) return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${n}`;
  return `https://www.google.com/search?q=${n}`; // carrier-agnostic fallback
}

/** Trim an ISO timestamp/date down to a plain YYYY-MM-DD (or null). */
export function shipDate(s: string | null): string | null {
  return s ? s.split('T')[0] : null;
}
