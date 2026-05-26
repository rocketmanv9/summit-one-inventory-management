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

  const shipToXml = params.shipTo
    ? `<ShipTo>
        <Address>
          <Name xml:lang="en-US">${escapeXml(params.shipTo.name)}</Name>
          <PostalAddress>
            <Street>${escapeXml(params.shipTo.address_line_1)}</Street>
            ${params.shipTo.address_line_2 ? `<Street>${escapeXml(params.shipTo.address_line_2)}</Street>` : ''}
            <City>${escapeXml(params.shipTo.city)}</City>
            <State>${escapeXml(params.shipTo.state)}</State>
            <PostalCode>${escapeXml(params.shipTo.postal_code)}</PostalCode>
            <Country isoCountryCode="${escapeXml(params.shipTo.country)}">${escapeXml(params.shipTo.country)}</Country>
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
          <Address>
            <Name xml:lang="en-US">${escapeXml(shipTo.name)}</Name>
            <PostalAddress>
              <Street>${escapeXml(shipTo.address_line_1)}</Street>
              ${shipTo.address_line_2 ? `<Street>${escapeXml(shipTo.address_line_2)}</Street>` : ''}
              <City>${escapeXml(shipTo.city)}</City>
              <State>${escapeXml(shipTo.state)}</State>
              <PostalCode>${escapeXml(shipTo.postal_code)}</PostalCode>
              <Country isoCountryCode="${escapeXml(shipTo.country)}">${escapeXml(shipTo.country)}</Country>
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
