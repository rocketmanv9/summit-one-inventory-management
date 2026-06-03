/**
 * Purchase Order PDF generation (pdf-lib — pure JS, serverless-safe).
 *
 * Renders a professional one-or-more-page PO document from a POContext:
 * header, PO number + date, Vendor / Bill-To / Ship-To blocks, a line-item
 * table (item, qty, unit cost, extended) and a total.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { POContext } from './po-context';

function money(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

const PAGE = { w: 612, h: 792, margin: 50 };
const INK = rgb(0.07, 0.09, 0.15);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.85, 0.87, 0.9);
const HEADBG = rgb(0.96, 0.97, 0.98);

export async function generatePurchaseOrderPdf(ctx: POContext): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Purchase Order ${ctx.poNumber}`);
  doc.setAuthor(ctx.company.name);
  doc.setSubject(`Purchase Order ${ctx.poNumber} for ${ctx.vendorName}`);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page = doc.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.margin;

  const text = (
    p: PDFPage,
    s: string,
    x: number,
    yy: number,
    opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb> } = {},
  ) => {
    p.drawText(s ?? '', { x, y: yy, size: opts.size ?? 10, font: opts.font ?? font, color: opts.color ?? INK });
  };

  const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

  // ── Header ────────────────────────────────────────────────────────────────
  text(page, ctx.company.name, PAGE.margin, y, { size: 18, font: bold });
  text(page, 'PURCHASE ORDER', PAGE.w - PAGE.margin - bold.widthOfTextAtSize('PURCHASE ORDER', 16), y, {
    size: 16,
    font: bold,
    color: MUTED,
  });
  y -= 18;
  if (ctx.company.email) text(page, ctx.company.email, PAGE.margin, y, { size: 9, color: MUTED });
  text(page, `# ${ctx.poNumber}`, PAGE.w - PAGE.margin - bold.widthOfTextAtSize(`# ${ctx.poNumber}`, 11), y, {
    size: 11,
    font: bold,
  });
  y -= 14;
  if (ctx.company.address) {
    for (const ln of ctx.company.address.split('\n')) {
      text(page, ln, PAGE.margin, y, { size: 9, color: MUTED });
      y -= 11;
    }
  }
  const dateStr = `Date: ${formatDate(ctx.orderDate)}`;
  text(page, dateStr, PAGE.w - PAGE.margin - font.widthOfTextAtSize(dateStr, 9), y + 11, { size: 9, color: MUTED });
  if (ctx.neededBy) {
    const nb = `Needed by: ${formatDate(ctx.neededBy)}`;
    text(page, nb, PAGE.w - PAGE.margin - font.widthOfTextAtSize(nb, 9), y, { size: 9, color: MUTED });
    y -= 11;
  }

  y -= 14;
  page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.w - PAGE.margin, y }, thickness: 1, color: LINE });
  y -= 22;

  // ── Address blocks: Vendor | Ship To ───────────────────────────────────────
  const colW = (PAGE.w - PAGE.margin * 2 - 20) / 2;
  const blockTop = y;

  const drawBlock = (title: string, lines: Array<string | null>, x: number) => {
    let by = blockTop;
    text(page, title, x, by, { size: 9, font: bold, color: MUTED });
    by -= 15;
    for (const ln of lines) {
      if (!ln) continue;
      for (const sub of ln.split('\n')) {
        text(page, truncate(sub, 46), x, by, { size: 10 });
        by -= 13;
      }
    }
    return by;
  };

  const vendorBottom = drawBlock(
    'VENDOR',
    [ctx.vendorName, ctx.vendorContactName, ctx.vendorEmail, ctx.vendorAddress],
    PAGE.margin,
  );
  const shipBottom = drawBlock(
    'SHIP TO',
    ctx.shipToName || ctx.shipToAddress
      ? [ctx.shipToName, ctx.shipToAddress]
      : ['(see vendor instructions)'],
    PAGE.margin + colW + 20,
  );

  y = Math.min(vendorBottom, shipBottom) - 10;

  // Bill To (company) under vendor column
  text(page, 'BILL TO', PAGE.margin, y, { size: 9, font: bold, color: MUTED });
  y -= 15;
  text(page, ctx.company.name, PAGE.margin, y, { size: 10 });
  y -= 13;
  if (ctx.company.address) {
    for (const ln of ctx.company.address.split('\n')) {
      text(page, truncate(ln, 46), PAGE.margin, y, { size: 10 });
      y -= 13;
    }
  }
  y -= 14;

  // ── Line-item table ─────────────────────────────────────────────────────────
  const cols = {
    item: PAGE.margin + 6,
    qty: PAGE.margin + 300,
    unit: PAGE.margin + 372,
    ext: PAGE.w - PAGE.margin - 6,
  };

  const drawTableHeader = (p: PDFPage, yy: number) => {
    p.drawRectangle({
      x: PAGE.margin,
      y: yy - 4,
      width: PAGE.w - PAGE.margin * 2,
      height: 20,
      color: HEADBG,
    });
    text(p, 'ITEM', cols.item, yy + 2, { size: 9, font: bold, color: MUTED });
    text(p, 'QTY', cols.qty, yy + 2, { size: 9, font: bold, color: MUTED });
    text(p, 'UNIT COST', cols.unit, yy + 2, { size: 9, font: bold, color: MUTED });
    const extLabel = 'EXTENDED';
    text(p, extLabel, cols.ext - bold.widthOfTextAtSize(extLabel, 9), yy + 2, { size: 9, font: bold, color: MUTED });
    return yy - 18;
  };

  y = drawTableHeader(page, y);

  for (const l of ctx.lines) {
    if (y < PAGE.margin + 80) {
      page = doc.addPage([PAGE.w, PAGE.h]);
      y = PAGE.h - PAGE.margin;
      y = drawTableHeader(page, y);
    }
    const desc = truncate(l.sku ? `${l.description} (${l.sku})` : l.description, 52);
    const qty = `${l.quantity}${l.uom ? ` ${l.uom}` : ''}`;
    text(page, desc, cols.item, y, { size: 10 });
    text(page, qty, cols.qty, y, { size: 10 });
    text(page, money(l.unitPrice), cols.unit, y, { size: 10 });
    const ext = money(l.extended);
    text(page, ext, cols.ext - font.widthOfTextAtSize(ext, 10), y, { size: 10 });
    y -= 16;
    page.drawLine({ start: { x: PAGE.margin, y: y + 4 }, end: { x: PAGE.w - PAGE.margin, y: y + 4 }, thickness: 0.5, color: LINE });
  }

  // ── Total ────────────────────────────────────────────────────────────────
  y -= 10;
  const totalLabel = ctx.allPriced ? 'ORDER TOTAL' : 'ORDER TOTAL (priced items)';
  text(page, totalLabel, cols.unit - 40, y, { size: 11, font: bold });
  const totalStr = money(ctx.total);
  text(page, totalStr, cols.ext - bold.widthOfTextAtSize(totalStr, 12), y, { size: 12, font: bold });
  if (!ctx.allPriced) {
    y -= 14;
    text(page, 'Some lines are quoted at market/estimated pricing — please confirm.', PAGE.margin, y, {
      size: 8,
      color: MUTED,
    });
  }

  // ── Notes ──────────────────────────────────────────────────────────────────
  if (ctx.notes?.trim()) {
    y -= 26;
    text(page, 'NOTES', PAGE.margin, y, { size: 9, font: bold, color: MUTED });
    y -= 14;
    for (const ln of wrapText(ctx.notes.trim(), 92)) {
      if (y < PAGE.margin) {
        page = doc.addPage([PAGE.w, PAGE.h]);
        y = PAGE.h - PAGE.margin;
      }
      text(page, ln, PAGE.margin, y, { size: 9 });
      y -= 12;
    }
  }

  return doc.save();
}

function wrapText(s: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const paragraph of s.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > maxChars) {
        if (line) out.push(line);
        line = word;
      } else {
        line = (line + ' ' + word).trim();
      }
    }
    out.push(line);
  }
  return out;
}
