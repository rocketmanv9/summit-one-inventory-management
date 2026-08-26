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

/** Per-line shipped quantity from the ASN (line_number = purchase_order_lines.line_number). */
export interface ShipmentLine {
  line_number: number;
  quantity: number;
}

export interface Shipment {
  carrier: string | null;
  tracking_number: string | null;
  shipment_id: string | null;
  ship_date: string | null;
  delivery_date: string | null;
  received_at: string | null;
  /** Per-line shipped quantities, when the ship-notice carried item detail. */
  lines: ShipmentLine[];
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
    lines: Array.isArray(s?.lines)
      ? s.lines
          .map((l: any) => ({ line_number: Number(l?.line_number), quantity: Number(l?.quantity) }))
          .filter((l: ShipmentLine) => Number.isFinite(l.line_number) && Number.isFinite(l.quantity))
      : [],
  }));
}

// ── Receipt ↔ shipment attribution ─────────────────────────────────────────
// A posted receipt can carry `shipment_ref` (supply_chain.receipts.shipment_ref)
// naming the shipment it came from. The ref is the ASN shipmentID, falling back
// to the tracking number — the same value shipmentRef() derives, so writer and
// reader always agree.

/** A receipt's attribution-relevant fields (subset of supply_chain.receipts). */
export interface ReceiptRef {
  id: string;
  receipt_number: string | null;
  received_at: string | null;
  shipment_ref: string | null;
}

/** The stable reference used to attribute receipts to this shipment. */
export function shipmentRef(sh: Pick<Shipment, 'shipment_id' | 'tracking_number'>): string | null {
  return sh.shipment_id || sh.tracking_number || null;
}

/** Receipts attributed to this shipment (matched on shipment_ref). */
export function receiptsForShipment(sh: Shipment, receipts: ReceiptRef[]): ReceiptRef[] {
  const ref = shipmentRef(sh);
  if (!ref) return [];
  return receipts.filter((r) => r.shipment_ref === ref);
}

/**
 * Default shipment to attribute a new receipt to: the most recent shipment with
 * no receipts yet, falling back to the most recent shipment. Returns its ref.
 */
export function defaultShipmentRef(shipments: Shipment[], receipts: ReceiptRef[]): string | null {
  const withRef = shipments.filter((sh) => shipmentRef(sh));
  if (withRef.length === 0) return null;
  // Webhook appends chronologically — walk newest-first.
  const newestFirst = [...withRef].reverse();
  const unreceived = newestFirst.find((sh) => receiptsForShipment(sh, receipts).length === 0);
  return shipmentRef(unreceived ?? newestFirst[0]);
}

/** Total quantity shipped per PO line_number across all shipments' line detail. */
export function shippedQtyByLine(shipments: Shipment[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const sh of shipments) {
    for (const l of sh.lines) {
      out[l.line_number] = (out[l.line_number] ?? 0) + l.quantity;
    }
  }
  return out;
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
