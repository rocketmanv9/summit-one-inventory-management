/**
 * Amazon Business Inbound cXML (status documents Amazon POSTs back to us)
 *
 * After an OrderRequest is accepted, Amazon sends asynchronous status docs:
 *   - ConfirmationRequest  → order accepted/confirmed (optionally an Amazon order id)
 *   - ShipNoticeRequest    → shipment dispatched, carrier + tracking number
 *
 * Amazon posts these server-to-server to the URLs configured under
 * Business Settings → System Integrations → Order Confirmation / Ship Notification.
 * Each request carries HTTP Basic auth credentials that WE define in that screen;
 * we validate them here and reply with a cXML Response envelope.
 *
 * Parsers are tolerant regex (matching the style of amazon-cxml.ts) rather than a
 * full XML parser — Amazon's documents are flat and predictable.
 */

import { timingSafeEqual } from 'crypto';

// ── cXML Response envelope (what we return to Amazon) ─────────────────────

function isoTimestamp(): string {
  return new Date().toISOString();
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build the cXML <Response> Amazon expects as the HTTP body for a status POST. */
export function buildCxmlResponse(code: number, text: string): string {
  const ts = isoTimestamp();
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd">
<cXML payloadID="${ts}.summit@summit-one" timestamp="${ts}">
  <Response>
    <Status code="${code}" text="${escapeXml(text)}"/>
  </Response>
</cXML>`;
}

// ── HTTP Basic auth validation ────────────────────────────────────────────

/** Constant-time string compare that never throws on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface BasicCreds {
  username: string;
  password: string;
}

/** Parse an `Authorization: Basic base64(user:pass)` header. Returns null if absent/malformed. */
export function parseBasicAuth(header: string | null): BasicCreds | null {
  if (!header) return null;
  const m = header.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1].trim(), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return null;
  return { username: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
}

/** True only when both username AND password match (constant-time). */
export function basicAuthMatches(got: BasicCreds, expected: BasicCreds): boolean {
  return safeEqual(got.username, expected.username) && safeEqual(got.password, expected.password);
}

// ── ConfirmationRequest parser (Order Confirmation) ───────────────────────

export interface ParsedConfirmation {
  /** orderID echoed from our OrderRequest — equals the PO number we sent. */
  orderId: string | null;
  /** Confirmation type: 'detail' | 'accept' | 'reject' | 'except' | etc. */
  confirmationType: string | null;
  /** Amazon's own order id, when present on a DocumentReference. */
  amazonOrderId: string | null;
  /** Per-line confirmation statuses (lineNumber + Amazon's confirmed quantity). */
  items: Array<{ lineNumber: number; quantity: number; status: string }>;
  /** Authoritative header money (Amazon's actual numbers), when present. */
  itemsTotal: number | null; // <Total> — goods subtotal Amazon will charge
  shipping: number | null;
  tax: number | null;
}

/** First <Money> inside a named child element of a block (header-scoped). */
function moneyIn(block: string, tag: string): number | null {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>\\s*<Money\\b[^>]*>([\\d.]+)<\\/Money>`, 'i'));
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

export function parseConfirmationRequest(xml: string): ParsedConfirmation {
  const orderId = xml.match(/orderID="([^"]+)"/i)?.[1]?.trim() ?? null;
  const confirmationType =
    xml.match(/<ConfirmationHeader[^>]*\btype="([^"]+)"/i)?.[1]?.trim() ?? null;
  // Amazon's order id rides on a DocumentReference payloadID inside OrderReference.
  const amazonOrderId =
    xml.match(/<OrderReference[^>]*>[\s\S]*?<DocumentReference[^>]*payloadID="([^"]+)"/i)?.[1]?.trim() ??
    null;

  // Header money (Total/Shipping/Tax) — scope to the ConfirmationHeader so we
  // don't pick up the nested per-line Shipping/Tax elements.
  const headerBlock = xml.match(/<ConfirmationHeader\b[\s\S]*?<\/ConfirmationHeader>/i)?.[0] ?? '';
  const itemsTotal = moneyIn(headerBlock, 'Total');
  const shipping = moneyIn(headerBlock, 'Shipping');
  const tax = moneyIn(headerBlock, 'Tax');

  // Per-line confirmed quantities live on <ConfirmationItem lineNumber=".." quantity="..">,
  // with the status on the nested <ConfirmationStatus type="..">.
  const items: ParsedConfirmation['items'] = [];
  const itemPattern = /<ConfirmationItem\b([^>]*)>([\s\S]*?)<\/ConfirmationItem>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemPattern.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const qty = parseInt(attrs.match(/quantity="([^"]+)"/i)?.[1] ?? '0', 10);
    const line = parseInt(attrs.match(/lineNumber="([^"]+)"/i)?.[1] ?? '0', 10);
    const status = body.match(/<ConfirmationStatus\b[^>]*\btype="([^"]+)"/i)?.[1]?.trim() ?? 'detail';
    items.push({ lineNumber: isNaN(line) ? 0 : line, quantity: isNaN(qty) ? 0 : qty, status });
  }

  return { orderId, confirmationType, amazonOrderId, items, itemsTotal, shipping, tax };
}

// ── ShipNoticeRequest parser (Ship Notification / ASN) ────────────────────

export interface ParsedShipNotice {
  /** orderID from the ShipNoticePortion — equals the PO number we sent. */
  orderId: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  shipmentId: string | null;
  shipDate: string | null;
  deliveryDate: string | null;
  /**
   * Per-line shipped quantities from <ShipNoticeItem lineNumber=".." quantity="..">.
   * lineNumber echoes the OrderRequest ItemOut lineNumber, which we populate from
   * purchase_order_lines.line_number — so it maps straight back to our PO lines.
   * Empty when the ASN is header-only (no item detail).
   */
  items: Array<{ lineNumber: number; quantity: number }>;
}

export function parseShipNoticeRequest(xml: string): ParsedShipNotice {
  const header = xml.match(/<ShipNoticeHeader\b([^>]*)>/i)?.[1] ?? '';

  // Per-line shipped quantities (optional in the ASN). Matches both container
  // (<ShipNoticeItem ...>...</ShipNoticeItem>) and self-closing forms.
  const items: ParsedShipNotice['items'] = [];
  const itemPattern = /<ShipNoticeItem\b([^>]*?)\/?>/gi;
  let im: RegExpExecArray | null;
  while ((im = itemPattern.exec(xml)) !== null) {
    const attrs = im[1];
    const line = parseInt(attrs.match(/lineNumber="([^"]+)"/i)?.[1] ?? '', 10);
    const qty = parseFloat(attrs.match(/quantity="([^"]+)"/i)?.[1] ?? '');
    if (Number.isFinite(line) && Number.isFinite(qty)) {
      items.push({ lineNumber: line, quantity: qty });
    }
  }

  return {
    orderId: xml.match(/orderID="([^"]+)"/i)?.[1]?.trim() ?? null,
    // CarrierIdentifier text is the human carrier name (UPS, FedEx, ...).
    carrier:
      xml.match(/<CarrierIdentifier[^>]*>([^<]+)<\/CarrierIdentifier>/i)?.[1]?.trim() ?? null,
    // ShipmentIdentifier (or TrackingNumber) carries the tracking string.
    trackingNumber:
      xml.match(/<ShipmentIdentifier[^>]*>([^<]+)<\/ShipmentIdentifier>/i)?.[1]?.trim() ??
      xml.match(/trackingNumber="([^"]+)"/i)?.[1]?.trim() ??
      null,
    shipmentId: header.match(/shipmentID="([^"]+)"/i)?.[1]?.trim() ?? null,
    shipDate: header.match(/shipmentDate="([^"]+)"/i)?.[1]?.trim() ?? null,
    deliveryDate: header.match(/deliveryDate="([^"]+)"/i)?.[1]?.trim() ?? null,
    items,
  };
}

// ── Tenant resolution by inbound Basic auth ───────────────────────────────

/**
 * Resolves which tenant an inbound status POST belongs to by validating its
 * Basic-auth credentials against each active Amazon Business provider's stored
 * confirmation credentials (in Vault). Returns the matching tenant + provider,
 * or null when no provider's credentials match (caller replies 401).
 *
 * Security: we ALWAYS verify the password; there is no single-tenant
 * "trust the only provider" fallback for inbound writes.
 */
export async function resolveTenantFromConfirmationAuth(
  adminClient: any,
  got: BasicCreds | null
): Promise<{ tenantId: string; providerId: string } | null> {
  if (!got) return null;
  const prov = adminClient.schema('provisioning');
  const { data: providers } = await prov
    .from('providers')
    .select('id, tenant_id, config, is_active')
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .eq('is_active', true)
    .limit(50);

  if (!providers?.length) return null;

  for (const p of providers) {
    const userRef = p.config?.confirmation_auth_user_ref;
    const secretRef = p.config?.confirmation_auth_secret_ref;
    if (!userRef || !secretRef) continue;

    const [{ data: u }, { data: s }] = await Promise.all([
      adminClient.from('decrypted_secrets').select('decrypted_secret').eq('name', userRef).limit(1).maybeSingle(),
      adminClient.from('decrypted_secrets').select('decrypted_secret').eq('name', secretRef).limit(1).maybeSingle(),
    ]);
    const expected = {
      username: (u?.decrypted_secret ?? '').trim(),
      password: s?.decrypted_secret ?? '',
    };
    if (expected.username && expected.password && basicAuthMatches(got, expected)) {
      return { tenantId: p.tenant_id, providerId: p.id };
    }
  }
  return null;
}
