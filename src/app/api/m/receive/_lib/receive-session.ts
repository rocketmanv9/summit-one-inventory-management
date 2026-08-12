/**
 * Shared helpers for the mobile receiving flow (/m/receive/[token] +
 * /api/m/receive/*). Mirrors src/lib/mobile-auth.ts (the cycle-count flow)
 * but with a distinct issuer so a receiving JWT can never be replayed against
 * the count endpoints (and vice versa).
 *
 * Lives in an underscore-prefixed folder so Next's App Router never treats it
 * as a route segment.
 */

import { SignJWT, jwtVerify } from 'jose';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { getGVClient } from '@/lib/gv';
import { statusesForBucket } from '@/lib/po/po-status';

const ISSUER = 'mobile-receive';
const AUDIENCE = 'summit-inventory';
const JWT_TTL_SECONDS = 15 * 60; // 15 minutes — same as the mobile count flow

export const RECEIVE_EXPIRED_MESSAGE =
  'This receiving session has expired. Generate a new receiving QR from Purchasing on desktop.';

/**
 * PO statuses a truck can be received against. The desktop "Receive Materials"
 * action covers the `sent` + `partially_received` buckets; mobile additionally
 * accepts `approved` (POs auto-approve on creation for this shop, so a delivery
 * can arrive while the PO never formally moved to "sent" — this matches
 * rpc_get_open_pos_for_receiving, which also includes 'approved').
 */
export const RECEIVABLE_PO_STATUSES: string[] = [
  'approved',
  ...statusesForBucket('sent'), // sent, placed, acknowledged, in_transit, ordered
  ...statusesForBucket('partially_received'), // partially_received
];

export interface MobileReceiveSession {
  sessionId: string;
  tenantId: string;
  userId: string;
}

function getSecret(): Uint8Array {
  const secret = process.env.INTERNAL_JWT_SECRET;
  if (!secret) {
    throw AppError.internal('INTERNAL_JWT_SECRET is not configured');
  }
  return new TextEncoder().encode(secret);
}

/** Mint a short-lived (15 min) JWT for mobile receiving access. */
export async function mintReceiveJwt(payload: MobileReceiveSession): Promise<string> {
  const secret = getSecret();
  return new SignJWT({
    session_id: payload.sessionId,
    tenant_id: payload.tenantId,
    user_id: payload.userId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${JWT_TTL_SECONDS}s`)
    .sign(secret);
}

/** Verify a mobile receiving JWT and extract claims. */
export async function verifyReceiveJwt(token: string): Promise<MobileReceiveSession> {
  try {
    const secret = getSecret();
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    const sessionId = payload.session_id as string;
    const tenantId = payload.tenant_id as string;
    const userId = payload.user_id as string;

    if (!sessionId || !tenantId || !userId) {
      throw AppError.unauthorized('Invalid mobile receiving token claims');
    }

    return { sessionId, tenantId, userId };
  } catch (err: any) {
    if (err instanceof AppError) throw err;
    if (err?.code === 'ERR_JWT_EXPIRED') {
      throw AppError.unauthorized('Mobile receiving session expired — please refresh');
    }
    throw AppError.unauthorized('Invalid mobile receiving token');
  }
}

/** Extract and verify the receiving session from `Authorization: Bearer <jwt>`. */
export async function requireReceiveSession(req: Request): Promise<MobileReceiveSession> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    throw AppError.unauthorized('Missing mobile authorization');
  }
  return verifyReceiveJwt(auth.slice(7));
}

export interface ReceivingSessionRow {
  id: string;
  tenant_id: string;
  created_by_user_id: string;
  expires_at: string;
  revoked_at: string | null;
}

/**
 * Look up a raw session token in supply_chain.mobile_receiving_sessions and
 * enforce revocation/expiry. Returns `{ error }` with an actionable message
 * (page rendering) — API callers should map it to AppError.unauthorized.
 */
export async function loadReceivingSession(
  token: string
): Promise<{ session: ReceivingSessionRow } | { error: string }> {
  const admin = getAdminClient();
  const sc = (admin as any).schema('supply_chain');

  const { data: session, error } = await sc
    .from('mobile_receiving_sessions')
    .select('id, tenant_id, created_by_user_id, expires_at, revoked_at')
    .eq('token', token)
    .single();

  if (error || !session) {
    return { error: 'Invalid receiving link. Generate a new receiving QR from Purchasing on desktop.' };
  }
  if (session.revoked_at) {
    return { error: 'This receiving session has been revoked. Generate a new receiving QR from Purchasing on desktop.' };
  }
  if (new Date(session.expires_at) < new Date()) {
    return { error: RECEIVE_EXPIRED_MESSAGE };
  }

  // Fire-and-forget: stamp last_used_at (never block the response on it).
  sc.from('mobile_receiving_sessions')
    .update({ last_used_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', session.id)
    .then(() => {})
    .catch(() => {});

  return { session: session as ReceivingSessionRow };
}

export interface OpenPoLine {
  id: string;
  line_number: number | null;
  catalog_item_id: string | null;
  item_description: string | null;
  name: string;
  sku: string | null;
  uom: string;
  qty_ordered: number;
  qty_received: number;
  outstanding: number;
  allow_over_delivery: boolean;
}

export interface OpenPo {
  id: string;
  po_number: string;
  vendor_name: string | null;
  expected_delivery_date: string | null;
  delivery_location_id: string | null;
  status: string;
  outstanding_line_count: number;
  lines: OpenPoLine[];
}

/**
 * Fetch every receivable PO for a tenant with its outstanding lines, enriched
 * with catalog item names/SKUs and UOM display labels.
 *
 * PostgREST returns Postgres numerics as STRINGS — every qty is coerced with
 * Number() here so no string quantity ever reaches the client payload.
 */
export async function fetchOpenPos(tenantId: string): Promise<OpenPo[]> {
  const admin = getAdminClient();
  const sc = (admin as any).schema('supply_chain');
  const inv = (admin as any).schema('inventory');

  const { data: pos, error: poError } = await sc
    .from('purchase_orders')
    .select('id, po_number, vendor_name_snapshot, expected_delivery_date, delivery_location_id, status')
    .eq('tenant_id', tenantId)
    .in('status', RECEIVABLE_PO_STATUSES)
    .order('expected_delivery_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100);

  if (poError) throw AppError.internal(poError.message);
  if (!pos || pos.length === 0) return [];

  const poIds = pos.map((p: any) => p.id);
  const { data: rawLines, error: lineError } = await sc
    .from('purchase_order_lines')
    .select('id, po_id, line_number, catalog_item_id, item_description, uom_term_id, qty_ordered, qty_received, allow_over_delivery')
    .eq('tenant_id', tenantId)
    .in('po_id', poIds)
    .order('line_number', { ascending: true })
    .limit(1000);

  if (lineError) throw AppError.internal(lineError.message);
  const lines: any[] = rawLines || [];

  // Catalog item names/SKUs for catalog-backed lines.
  const itemIds = [...new Set(lines.map((l) => l.catalog_item_id).filter(Boolean))];
  let itemMap = new Map<string, any>();
  if (itemIds.length > 0) {
    const { data: items } = await inv
      .from('catalog_items')
      .select('id, name, sku, uom_term_id')
      .eq('tenant_id', tenantId)
      .in('id', itemIds)
      .limit(1000);
    itemMap = new Map((items || []).map((i: any) => [i.id, i]));
  }

  // UOM display labels (GV) — best-effort; quantities still render without them.
  const uomTermIds = [
    ...new Set(
      lines
        .map((l) => l.uom_term_id || itemMap.get(l.catalog_item_id)?.uom_term_id)
        .filter(Boolean)
    ),
  ] as string[];
  const uomLabels: Record<string, string> = {};
  if (uomTermIds.length > 0) {
    try {
      // displayLabels returns a Record<termId, label> (see items route usage).
      const results = await getGVClient().displayLabels(tenantId, uomTermIds as any);
      Object.assign(uomLabels, results || {});
    } catch {
      // Best-effort — labels stay empty.
    }
  }

  const linesByPo = new Map<string, OpenPoLine[]>();
  for (const l of lines) {
    const item = l.catalog_item_id ? itemMap.get(l.catalog_item_id) : null;
    const qtyOrdered = l.qty_ordered == null ? 0 : Number(l.qty_ordered);
    const qtyReceived = l.qty_received == null ? 0 : Number(l.qty_received);
    const outstanding = Math.max(0, qtyOrdered - qtyReceived);
    const allowOver = l.allow_over_delivery === true;
    // A line is receivable when it still owes quantity, or when over-delivery
    // is allowed (approximate orders — e.g. gravel by the truckload).
    if (outstanding <= 0 && !allowOver) continue;
    const uomTermId = l.uom_term_id || item?.uom_term_id || null;
    const entry: OpenPoLine = {
      id: l.id,
      line_number: l.line_number ?? null,
      catalog_item_id: l.catalog_item_id || null,
      item_description: l.item_description || null,
      name: item?.name || l.item_description || 'Custom item',
      sku: item?.sku || null,
      uom: (uomTermId && uomLabels[uomTermId]) || '',
      qty_ordered: qtyOrdered,
      qty_received: qtyReceived,
      outstanding,
      allow_over_delivery: allowOver,
    };
    const list = linesByPo.get(l.po_id) || [];
    list.push(entry);
    linesByPo.set(l.po_id, list);
  }

  return pos
    .map((p: any): OpenPo => {
      const poLines = linesByPo.get(p.id) || [];
      return {
        id: p.id,
        po_number: p.po_number,
        vendor_name: p.vendor_name_snapshot || null,
        expected_delivery_date: p.expected_delivery_date || null,
        delivery_location_id: p.delivery_location_id || null,
        status: p.status,
        outstanding_line_count: poLines.filter((l) => l.outstanding > 0).length,
        lines: poLines,
      };
    })
    .filter((p: OpenPo) => p.lines.length > 0);
}
