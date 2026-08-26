import { describe, it, expect } from 'vitest';
import {
  parseBasicAuth,
  basicAuthMatches,
  parseConfirmationRequest,
  parseShipNoticeRequest,
  buildCxmlResponse,
} from '../src/lib/integrations/amazon-cxml-inbound';

describe('parseBasicAuth', () => {
  it('decodes a valid Basic header', () => {
    const header = 'Basic ' + Buffer.from('user:p@ss:word').toString('base64');
    expect(parseBasicAuth(header)).toEqual({ username: 'user', password: 'p@ss:word' });
  });

  it('returns null for missing/garbage headers', () => {
    expect(parseBasicAuth(null)).toBeNull();
    expect(parseBasicAuth('Bearer abc')).toBeNull();
  });
});

describe('basicAuthMatches', () => {
  const expected = { username: 'summit-amzn-confirm', password: 'Sm1tCnf-9Kq2Xb7Tn4Rd' };
  it('matches identical creds', () => {
    expect(basicAuthMatches({ ...expected }, expected)).toBe(true);
  });
  it('rejects wrong password and wrong username', () => {
    expect(basicAuthMatches({ username: 'summit-amzn-confirm', password: 'nope' }, expected)).toBe(false);
    expect(basicAuthMatches({ username: 'x', password: 'Sm1tCnf-9Kq2Xb7Tn4Rd' }, expected)).toBe(false);
  });
});

describe('parseConfirmationRequest', () => {
  const xml = `<?xml version="1.0"?>
<cXML>
  <Request deploymentMode="production">
    <ConfirmationRequest>
      <ConfirmationHeader type="detail" noticeDate="2026-06-10T12:00:00Z"/>
      <OrderReference orderID="PO-2026-0042">
        <DocumentReference payloadID="111-2223334-4445556@amazon.com"/>
      </OrderReference>
      <ConfirmationItem quantity="2" lineNumber="1">
        <UnitOfMeasure>EA</UnitOfMeasure>
        <ConfirmationStatus quantity="2" type="accept" lineNumber="1"/>
      </ConfirmationItem>
    </ConfirmationRequest>
  </Request>
</cXML>`;

  it('extracts orderID, type, amazon order id and line statuses', () => {
    const r = parseConfirmationRequest(xml);
    expect(r.orderId).toBe('PO-2026-0042');
    expect(r.confirmationType).toBe('detail');
    expect(r.amazonOrderId).toBe('111-2223334-4445556@amazon.com');
    expect(r.items).toEqual([{ lineNumber: 1, quantity: 2, status: 'accept' }]);
  });
});

describe('parseShipNoticeRequest', () => {
  const xml = `<?xml version="1.0"?>
<cXML>
  <Request>
    <ShipNoticeRequest>
      <ShipNoticeHeader shipmentID="SHIP-1" noticeDate="2026-06-10T13:00:00Z" shipmentDate="2026-06-10T13:00:00Z" deliveryDate="2026-06-12T13:00:00Z"/>
      <ShipControl>
        <CarrierIdentifier domain="companyName">UPS</CarrierIdentifier>
        <ShipmentIdentifier>1Z999AA10123456784</ShipmentIdentifier>
      </ShipControl>
      <ShipNoticePortion>
        <OrderReference orderID="PO-2026-0042"/>
      </ShipNoticePortion>
    </ShipNoticeRequest>
  </Request>
</cXML>`;

  it('extracts orderID, carrier, tracking, and dates', () => {
    const r = parseShipNoticeRequest(xml);
    expect(r.orderId).toBe('PO-2026-0042');
    expect(r.carrier).toBe('UPS');
    expect(r.trackingNumber).toBe('1Z999AA10123456784');
    expect(r.shipmentId).toBe('SHIP-1');
    expect(r.shipDate).toBe('2026-06-10T13:00:00Z');
    expect(r.deliveryDate).toBe('2026-06-12T13:00:00Z');
  });

  it('returns empty items for a header-only ASN', () => {
    expect(parseShipNoticeRequest(xml).items).toEqual([]);
  });

  it('extracts per-line shipped quantities from ShipNoticeItem elements', () => {
    const withItems = xml.replace(
      '</ShipNoticePortion>',
      `  <ShipNoticeItem quantity="2" lineNumber="1">
          <UnitOfMeasure>EA</UnitOfMeasure>
        </ShipNoticeItem>
        <ShipNoticeItem quantity="5" lineNumber="3"/>
      </ShipNoticePortion>`,
    );
    const r = parseShipNoticeRequest(withItems);
    expect(r.items).toEqual([
      { lineNumber: 1, quantity: 2 },
      { lineNumber: 3, quantity: 5 },
    ]);
  });

  it('skips ShipNoticeItem elements missing lineNumber or quantity', () => {
    const bad = xml.replace(
      '</ShipNoticePortion>',
      `<ShipNoticeItem quantity="2"/><ShipNoticeItem lineNumber="1"/></ShipNoticePortion>`,
    );
    expect(parseShipNoticeRequest(bad).items).toEqual([]);
  });
});

describe('buildCxmlResponse', () => {
  it('emits a cXML Response with the given status', () => {
    const out = buildCxmlResponse(200, 'OK');
    expect(out).toContain('<Status code="200" text="OK"/>');
    expect(out).toContain('<Response>');
  });
});
