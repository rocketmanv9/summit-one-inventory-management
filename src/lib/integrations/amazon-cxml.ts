/**
 * Amazon Business cXML Document Builders & Parsers
 *
 * Implements the exact cXML spec from Amazon's integration guide:
 * - PunchOutSetupRequest (outbound: start punchout session)
 * - PunchOutOrderMessage parser (inbound: POOM returned from Amazon)
 * - OrderRequest (outbound: submit PO with SPAID from POOM)
 * - Hard limit enforcement (50 lines, 999 qty, unique payloadIDs, etc.)
 */

import { AppError } from '@rocketmanv9/chassis/errors';
import type { CxmlCredentials, ShippingAddress } from './amazon-business';

// ── XML Helpers ───────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function generatePayloadId(): string {
  const ts = Date.now();
  const rand = crypto.randomUUID();
  return `${ts}.${rand}@summit-one`;
}

function isoTimestamp(): string {
  return new Date().toISOString();
}

// ── Address normalization ─────────────────────────────────────────────
// Location address fields are free-text, but Amazon's cXML requires a 2-letter
// state code and a 2-letter ISO country code on <Country isoCountryCode="..">.
// Transmitting "Georgia"/"United States" verbatim triggers Amazon error 003-052
// ("invalid Shipping Address"), so we normalize before emitting the cXML.

const US_STATE_CODES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY', 'puerto rico': 'PR',
};

const COUNTRY_CODES: Record<string, string> = {
  us: 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US', america: 'US',
  'united states': 'US', 'united states of america': 'US',
  ca: 'CA', can: 'CA', canada: 'CA', mx: 'MX', mex: 'MX', mexico: 'MX',
};

const COUNTRY_NAMES: Record<string, string> = {
  US: 'United States', CA: 'Canada', MX: 'Mexico',
};

/** Normalize a free-text US state to its 2-letter code; pass through unknown values. */
export function normalizeStateCode(input: string): string {
  const s = (input || '').trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return US_STATE_CODES[s.toLowerCase()] ?? s;
}

/** Normalize a free-text country to a 2-letter ISO code; default to US. */
export function normalizeCountryCode(input: string): string {
  const c = (input || '').trim();
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  return COUNTRY_CODES[c.toLowerCase()] ?? 'US';
}

/** Human-readable country name for the <Country> element text. */
export function countryName(code: string): string {
  return COUNTRY_NAMES[code] ?? code;
}

// ── US ZIP ↔ state validation ─────────────────────────────────────────
// Amazon rejects a ShipTo whose state and ZIP disagree (error 003-052) and, in
// production (not test) mode, won't let a punchout cart check out at all — so a
// bad address shows up as a cart that never returns. We catch it before transmit.

/** Set of valid 2-letter USPS state/territory codes. */
const US_STATE_CODE_SET = new Set<string>([
  ...Object.values(US_STATE_CODES),
  'DC', 'AS', 'GU', 'MP', 'PR', 'VI',
]);

// ZIP3 (first three digits) → state, as contiguous ranges per the USPS
// allocation. Used only as a sanity check: an unmapped ZIP3 passes (we don't
// want false negatives), a mapped-but-mismatched one is rejected.
const ZIP3_STATE_RANGES: Array<[number, number, string]> = [
  [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'],
  [700, 714, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'], [750, 799, 'TX'],
  [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'],
  [850, 865, 'AZ'], [870, 884, 'NM'], [889, 898, 'NV'], [900, 961, 'CA'],
  [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK'],
  [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'],
  [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'], [100, 149, 'NY'],
  [150, 196, 'PA'], [197, 199, 'DE'], [200, 205, 'DC'], [206, 219, 'MD'],
  [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'], [290, 299, 'SC'],
  [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'],
  [386, 397, 'MS'], [400, 427, 'KY'], [430, 459, 'OH'], [460, 479, 'IN'],
  [480, 499, 'MI'], [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'],
  [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'],
];

/** Map a 5-digit ZIP to its expected state, or null if the prefix is unmapped. */
export function zipToState(zip: string): string | null {
  const m = (zip || '').trim().match(/^(\d{3})\d{2}/);
  if (!m) return null;
  const zip3 = parseInt(m[1], 10);
  for (const [lo, hi, st] of ZIP3_STATE_RANGES) {
    if (zip3 >= lo && zip3 <= hi) return st;
  }
  return null;
}

export interface ShipToLike {
  name?: string;
  address_line_1?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

/**
 * Validate a ship-to address before we put it in cXML. Throws AppError.badRequest
 * with an operator-actionable message (naming the location) when the address is
 * incomplete or internally inconsistent. US-only checks; non-US passes through.
 */
export function validateShipToAddress(shipTo: ShipToLike, locationName: string): void {
  if (!shipTo.address_line_1 || !shipTo.city || !shipTo.state || !shipTo.postal_code) {
    throw AppError.badRequest(
      `Location "${locationName}" is missing structured address fields (street, city, state, ZIP). ` +
      'Complete it in Inventory > Locations before ordering.'
    );
  }

  const problem = stateZipProblem(shipTo.state, shipTo.postal_code, shipTo.country);
  if (problem) {
    throw AppError.badRequest(`Location "${locationName}": ${problem}`);
  }
}

/**
 * Pure US state/ZIP consistency check, reusable outside the Amazon flow (e.g. at
 * location save time). Returns a human message describing the problem, or null
 * when the address is consistent (or non-US, or missing state/ZIP — those are the
 * caller's completeness concern, not a consistency one).
 */
export function stateZipProblem(
  stateRaw?: string | null,
  zipRaw?: string | null,
  countryRaw?: string | null,
): string | null {
  const country = normalizeCountryCode(countryRaw || 'US');
  if (country !== 'US') return null;
  if (!stateRaw || !zipRaw) return null;

  const state = normalizeStateCode(stateRaw);
  if (!US_STATE_CODE_SET.has(state)) {
    return `unrecognized state "${stateRaw}" — use the 2-letter code (e.g. WA). Amazon rejects non-ISO states (003-052).`;
  }

  const zip = String(zipRaw).trim();
  if (!/^\d{5}(-\d{4})?$/.test(zip)) {
    return `invalid ZIP "${zipRaw}" — use a 5-digit US ZIP (or ZIP+4).`;
  }

  const expected = zipToState(zip);
  if (expected && expected !== state) {
    return `state/ZIP mismatch — state is ${state} but ZIP ${zip} belongs to ${expected}. Fix it so they agree; Amazon rejects mismatched shipping addresses (003-052).`;
  }
  return null;
}

// ── cXML Header (shared by PunchOutSetupRequest and OrderRequest) ─────

function buildHeader(creds: CxmlCredentials): string {
  return `<Header>
    <From>
      <Credential domain="NetworkId">
        <Identity>${escapeXml(creds.fromIdentity)}</Identity>
      </Credential>
    </From>
    <To>
      <Credential domain="NetworkId">
        <Identity>Amazon</Identity>
      </Credential>
    </To>
    <Sender>
      <Credential domain="NetworkId">
        <Identity>${escapeXml(creds.fromIdentity)}</Identity>
        <SharedSecret>${escapeXml(creds.sharedSecret)}</SharedSecret>
      </Credential>
      <UserAgent>SummitOne</UserAgent>
    </Sender>
  </Header>`;
}

// ── Hard Limit Enforcement ────────────────────────────────────────────

export const LIMITS = {
  MAX_LINE_ITEMS: 50,
  MAX_QUANTITY_PER_LINE: 999,
  ORDER_TYPE: 'new',
} as const;

export interface OrderLineForValidation {
  supplierSku: string;
  quantity: number;
  spaid: string;
}

export function validateOrderLimits(lines: OrderLineForValidation[]): void {
  if (lines.length === 0) {
    throw AppError.badRequest('Order must contain at least one line item.');
  }

  if (lines.length > LIMITS.MAX_LINE_ITEMS) {
    throw AppError.badRequest(
      `Order exceeds ${LIMITS.MAX_LINE_ITEMS} line items (has ${lines.length}). Split into multiple POs.`
    );
  }

  for (const line of lines) {
    if (line.quantity > LIMITS.MAX_QUANTITY_PER_LINE) {
      throw AppError.badRequest(
        `Line item ${line.supplierSku} exceeds ${LIMITS.MAX_QUANTITY_PER_LINE} units (has ${line.quantity}). Split into multiple lines.`
      );
    }
    if (line.quantity < 1) {
      throw AppError.badRequest(`Line item ${line.supplierSku} has invalid quantity ${line.quantity}.`);
    }
    if (!line.spaid) {
      throw AppError.badRequest(
        `Line item ${line.supplierSku} is missing a SupplierPartAuxiliaryID (SPAID). ` +
        'A punchout session must complete before submitting an order.'
      );
    }
  }
}

// ── PunchOutSetupRequest Builder ──────────────────────────────────────

export interface PunchOutSetupParams {
  credentials: CxmlCredentials;
  buyerCookie: string;
  browserFormPostUrl: string;
  userEmail: string;
  shipTo?: ShippingAddress;
  preloadItems?: Array<{ asin: string; quantity: number }>;
}

export function buildPunchOutSetupRequest(params: PunchOutSetupParams): {
  xml: string;
  payloadId: string;
} {
  const payloadId = generatePayloadId();
  const header = buildHeader(params.credentials);

  const selectedItems = (params.preloadItems || [])
    .map((item) =>
      `<SelectedItem>
        <ItemID>
          <SupplierPartID>${escapeXml(item.asin)}</SupplierPartID>
        </ItemID>
        <ItemDetail>
          <UnitPrice><Money currency="USD">0</Money></UnitPrice>
          <Description xml:lang="en-US">Pre-loaded item</Description>
          <UnitOfMeasure>EA</UnitOfMeasure>
        </ItemDetail>
        <Quantity>${item.quantity}</Quantity>
      </SelectedItem>`
    )
    .join('\n      ');

  const setupCountryCode = params.shipTo ? normalizeCountryCode(params.shipTo.country) : 'US';
  const shipToXml = params.shipTo
    ? `<ShipTo>
        <Address isoCountryCode="${escapeXml(setupCountryCode)}" addressID="${escapeXml(params.shipTo.addressId || 'ship-1')}">
          <Name xml:lang="en-US">${escapeXml(params.shipTo.name)}</Name>
          <PostalAddress name="default">
            <DeliverTo>${escapeXml((params.shipTo.deliverTo || params.shipTo.name || 'Receiving').slice(0, 17))}</DeliverTo>
            <Street>${escapeXml(params.shipTo.address_line_1)}</Street>
            ${params.shipTo.address_line_2 ? `<Street>${escapeXml(params.shipTo.address_line_2)}</Street>` : ''}
            <City>${escapeXml(params.shipTo.city)}</City>
            <State>${escapeXml(normalizeStateCode(params.shipTo.state))}</State>
            <PostalCode>${escapeXml(params.shipTo.postal_code)}</PostalCode>
            <Country isoCountryCode="${escapeXml(setupCountryCode)}">${escapeXml(countryName(setupCountryCode))}</Country>
          </PostalAddress>
          <Email>${escapeXml(params.userEmail)}</Email>
        </Address>
      </ShipTo>`
    : '';

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd">
<cXML payloadID="${escapeXml(payloadId)}" timestamp="${isoTimestamp()}" xml:lang="en-US">
  ${header}
  <Request deploymentMode="${params.credentials.sandbox ? 'test' : 'production'}">
    <PunchOutSetupRequest operation="create">
      <BuyerCookie>${escapeXml(params.buyerCookie)}</BuyerCookie>
      <Extrinsic name="UserEmail">${escapeXml(params.userEmail)}</Extrinsic>
      <BrowserFormPost>
        <URL>${escapeXml(params.browserFormPostUrl)}</URL>
      </BrowserFormPost>
      <Contact>
        <Name xml:lang="en-US">Summit One Procurement</Name>
        <Email>${escapeXml(params.userEmail)}</Email>
      </Contact>
      ${shipToXml}
      ${selectedItems}
    </PunchOutSetupRequest>
  </Request>
</cXML>`;

  return { xml, payloadId };
}

// ── PunchOutSetupResponse Parser ──────────────────────────────────────

export interface PunchOutSetupResponse {
  statusCode: string;
  statusText: string;
  startPageUrl: string | null;
}

export function parsePunchOutSetupResponse(xml: string): PunchOutSetupResponse {
  const statusMatch = xml.match(/<Status\s+code="(\d+)"[^>]*text="([^"]*)"[^>]*\/?>/i);
  const urlMatch = xml.match(/<URL>([^<]+)<\/URL>/i);

  return {
    statusCode: statusMatch?.[1] ?? 'unknown',
    statusText: statusMatch?.[2] ?? 'unknown',
    startPageUrl: urlMatch?.[1]?.trim() ?? null,
  };
}

// ── PunchOutOrderMessage (POOM) Parser ────────────────────────────────

export interface PoomLineItem {
  supplierPartId: string;
  supplierPartAuxiliaryId: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  description: string;
  unitOfMeasure: string;
}

export interface ParsedPoom {
  buyerCookie: string;
  operationAllowed: string;
  total: number;
  totalCurrency: string;
  items: PoomLineItem[];
}

export function parsePunchOutOrderMessage(xml: string): ParsedPoom {
  const buyerCookieMatch = xml.match(/<BuyerCookie>([^<]+)<\/BuyerCookie>/i);
  if (!buyerCookieMatch) {
    throw AppError.badRequest('POOM missing BuyerCookie element.');
  }

  const operationMatch = xml.match(/operationAllowed="([^"]+)"/i);
  const totalMoneyMatch = xml.match(
    /<PunchOutOrderMessageHeader[^>]*>[\s\S]*?<Total>[\s\S]*?<Money\s+currency="([^"]+)"[^>]*>([^<]+)<\/Money>[\s\S]*?<\/Total>/i
  );

  const items: PoomLineItem[] = [];
  const itemPattern = /<ItemIn\s+quantity="([^"]+)"[^>]*>([\s\S]*?)<\/ItemIn>/gi;
  let itemMatch;

  while ((itemMatch = itemPattern.exec(xml)) !== null) {
    const quantity = parseInt(itemMatch[1], 10);
    const block = itemMatch[2];

    const spidMatch = block.match(/<SupplierPartID>([^<]+)<\/SupplierPartID>/i);
    const spaidMatch = block.match(/<SupplierPartAuxiliaryID>([^<]+)<\/SupplierPartAuxiliaryID>/i);
    const priceMatch = block.match(/<UnitPrice>[\s\S]*?<Money\s+currency="([^"]+)"[^>]*>([^<]+)<\/Money>[\s\S]*?<\/UnitPrice>/i);
    const descMatch = block.match(/<Description[^>]*>([^<]+)<\/Description>/i);
    const uomMatch = block.match(/<UnitOfMeasure>([^<]+)<\/UnitOfMeasure>/i);

    if (!spidMatch) continue;

    items.push({
      supplierPartId: spidMatch[1].trim(),
      supplierPartAuxiliaryId: spaidMatch?.[1]?.trim() ?? '',
      quantity: isNaN(quantity) ? 0 : quantity,
      unitPrice: priceMatch ? parseFloat(priceMatch[2]) : 0,
      currency: priceMatch?.[1] ?? 'USD',
      description: descMatch?.[1]?.trim() ?? '',
      unitOfMeasure: uomMatch?.[1]?.trim() ?? 'EA',
    });
  }

  if (items.length === 0) {
    throw AppError.badRequest('POOM contains no valid ItemIn elements.');
  }

  for (const item of items) {
    if (!item.supplierPartAuxiliaryId) {
      throw AppError.badRequest(
        `POOM item ${item.supplierPartId} is missing SupplierPartAuxiliaryID (SPAID). ` +
        'This is required for OrderRequest submission.'
      );
    }
  }

  return {
    buyerCookie: buyerCookieMatch[1].trim(),
    operationAllowed: operationMatch?.[1] ?? 'create',
    total: totalMoneyMatch ? parseFloat(totalMoneyMatch[2]) : 0,
    totalCurrency: totalMoneyMatch?.[1] ?? 'USD',
    items,
  };
}

/**
 * Extracts the buyer's NetworkId identities and (if present) the UserEmail from
 * a POOM header. Used to route an Amazon-initiated cart (no app session) to the
 * right tenant by matching its identity against a provider's from-identity.
 */
export function extractPoomBuyerContext(xml: string): {
  identities: string[];
  userEmail: string | null;
} {
  const headerMatch = xml.match(/<Header>([\s\S]*?)<\/Header>/i);
  const headerXml = headerMatch?.[1] ?? xml;
  const identities = [...headerXml.matchAll(/<Identity>([^<]+)<\/Identity>/gi)]
    .map((m) => m[1].trim())
    .filter((id) => id && id.toLowerCase() !== 'amazon');
  const emailMatch = xml.match(/<Extrinsic\s+name="UserEmail">([^<]+)<\/Extrinsic>/i);
  return {
    identities: [...new Set(identities)],
    userEmail: emailMatch?.[1]?.trim() ?? null,
  };
}

// ── Decode POOM from browser form POST ────────────────────────────────

export function decodePoomFromFormData(formBody: string): string {
  const params = new URLSearchParams(formBody);

  const urlEncoded = params.get('cxml-urlencoded');
  if (urlEncoded) {
    return decodeURIComponent(urlEncoded);
  }

  const base64Encoded = params.get('cxml-base64');
  if (base64Encoded) {
    return Buffer.from(base64Encoded, 'base64').toString('utf-8');
  }

  throw AppError.badRequest(
    'POOM form data missing both cxml-urlencoded and cxml-base64 fields.'
  );
}

// ── OrderRequest Builder ──────────────────────────────────────────────

export interface OrderRequestLineItem {
  supplierSku: string;
  spaid: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  description: string;
  unitOfMeasure: string;
  lineNumber: number;
}

export interface OrderRequestParams {
  credentials: CxmlCredentials;
  orderDate: string;
  orderType?: string;
  shipTo: ShippingAddress;
  billTo?: { name: string; email?: string };
  items: OrderRequestLineItem[];
  total: number;
  currency: string;
  poReferenceNumber: string;
  userEmail: string;
}

export function buildOrderRequest(params: OrderRequestParams): {
  xml: string;
  payloadId: string;
} {
  validateOrderLimits(
    params.items.map((i) => ({
      supplierSku: i.supplierSku,
      quantity: i.quantity,
      spaid: i.spaid,
    }))
  );

  const payloadId = generatePayloadId();
  const header = buildHeader(params.credentials);

  const itemOutElements = params.items
    .map(
      (item) => `<ItemOut quantity="${item.quantity}" lineNumber="${item.lineNumber}">
        <ItemID>
          <SupplierPartID>${escapeXml(item.supplierSku)}</SupplierPartID>
          <SupplierPartAuxiliaryID>${escapeXml(item.spaid)}</SupplierPartAuxiliaryID>
        </ItemID>
        <ItemDetail>
          <UnitPrice>
            <Money currency="${escapeXml(item.currency)}">${item.unitPrice.toFixed(2)}</Money>
          </UnitPrice>
          <Description xml:lang="en-US">${escapeXml(item.description)}</Description>
          <UnitOfMeasure>${escapeXml(item.unitOfMeasure)}</UnitOfMeasure>
        </ItemDetail>
      </ItemOut>`
    )
    .join('\n      ');

  const shipTo = params.shipTo;
  const shipCountryCode = normalizeCountryCode(shipTo.country);

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd">
<cXML payloadID="${escapeXml(payloadId)}" timestamp="${isoTimestamp()}" xml:lang="en-US">
  ${header}
  <Request deploymentMode="${params.credentials.sandbox ? 'test' : 'production'}">
    <OrderRequest>
      <OrderRequestHeader orderID="${escapeXml(params.poReferenceNumber)}" orderDate="${escapeXml(params.orderDate)}" type="${params.orderType ?? LIMITS.ORDER_TYPE}">
        <Total>
          <Money currency="${escapeXml(params.currency)}">${params.total.toFixed(2)}</Money>
        </Total>
        <ShipTo>
          <Address isoCountryCode="${escapeXml(shipCountryCode)}" addressID="${escapeXml(shipTo.addressId || 'ship-1')}">
            <Name xml:lang="en-US">${escapeXml(shipTo.name)}</Name>
            <PostalAddress name="default">
              <DeliverTo>${escapeXml((shipTo.deliverTo || shipTo.name || 'Receiving').slice(0, 17))}</DeliverTo>
              <Street>${escapeXml(shipTo.address_line_1)}</Street>
              ${shipTo.address_line_2 ? `<Street>${escapeXml(shipTo.address_line_2)}</Street>` : ''}
              <City>${escapeXml(shipTo.city)}</City>
              <State>${escapeXml(normalizeStateCode(shipTo.state))}</State>
              <PostalCode>${escapeXml(shipTo.postal_code)}</PostalCode>
              <Country isoCountryCode="${escapeXml(shipCountryCode)}">${escapeXml(countryName(shipCountryCode))}</Country>
            </PostalAddress>
            <Email>${escapeXml(params.userEmail)}</Email>
          </Address>
        </ShipTo>
        <BillTo>
          <Address>
            <Name xml:lang="en-US">${escapeXml(params.billTo?.name ?? shipTo.name)}</Name>
            ${params.billTo?.email ? `<Email>${escapeXml(params.billTo.email)}</Email>` : ''}
          </Address>
        </BillTo>
        <Extrinsic name="UserEmail">${escapeXml(params.userEmail)}</Extrinsic>
      </OrderRequestHeader>
      ${itemOutElements}
    </OrderRequest>
  </Request>
</cXML>`;

  return { xml, payloadId };
}

// ── OrderRequest Response Parser ──────────────────────────────────────

export interface OrderResponseResult {
  statusCode: string;
  statusText: string;
}

export function parseOrderResponse(xml: string): OrderResponseResult {
  const statusMatch = xml.match(/<Status\s+code="(\d+)"[^>]*text="([^"]*)"[^>]*\/?>/i);
  return {
    statusCode: statusMatch?.[1] ?? 'unknown',
    statusText: statusMatch?.[2] ?? 'unknown',
  };
}

// ── POST cXML to Amazon ──────────────────────────────────────────────

export async function postCxml(
  url: string,
  xml: string,
  timeoutMs = 30000
): Promise<{ status: number; body: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=UTF-8',
    },
    body: xml,
    signal: AbortSignal.timeout(timeoutMs),
  });

  const body = await res.text();
  return { status: res.status, body };
}
