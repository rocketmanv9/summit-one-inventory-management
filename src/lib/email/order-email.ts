/**
 * Composes the vendor order-request email (subject + HTML + plaintext).
 */

export interface OrderEmailParams {
  vendorName: string;
  itemLabel: string;
  quantity: number;
  uom?: string | null;
  unitPrice?: number | null;
  neededBy?: string | null;
  message?: string | null;
  requesterName?: string | null;
  requesterEmail: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildOrderEmail(p: OrderEmailParams): { subject: string; html: string; text: string } {
  const qty = `${p.quantity}${p.uom ? ` ${p.uom}` : ''}`;
  const signer = p.requesterName?.trim() || p.requesterEmail;
  const subject = `Order Request: ${qty} × ${p.itemLabel}`;

  const detailRows: Array<[string, string]> = [
    ['Item', p.itemLabel],
    ['Quantity', qty],
  ];
  if (p.unitPrice != null) detailRows.push(['Target unit price', `$${p.unitPrice.toFixed(2)}`]);
  if (p.neededBy) detailRows.push(['Needed by', p.neededBy]);

  // ── Plaintext ──
  const textLines = [
    `Hello ${p.vendorName},`,
    '',
    'We would like to place the following order:',
    '',
    ...detailRows.map(([k, v]) => `  ${k}: ${v}`),
    '',
  ];
  if (p.message?.trim()) {
    textLines.push(p.message.trim(), '');
  }
  textLines.push(
    'Please confirm availability, pricing, and lead time.',
    '',
    `Thank you,`,
    signer,
    p.requesterEmail,
  );
  const text = textLines.join('\n');

  // ── HTML ──
  const rowsHtml = detailRows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${escapeHtml(k)}</td>` +
        `<td style="padding:4px 0;font-weight:600;">${escapeHtml(v)}</td></tr>`,
    )
    .join('');

  const messageHtml = p.message?.trim()
    ? `<p style="margin:16px 0;white-space:pre-wrap;">${escapeHtml(p.message.trim())}</p>`
    : '';

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;line-height:1.5;">
  <p>Hello ${escapeHtml(p.vendorName)},</p>
  <p>We would like to place the following order:</p>
  <table style="border-collapse:collapse;margin:12px 0;">${rowsHtml}</table>
  ${messageHtml}
  <p>Please confirm availability, pricing, and lead time.</p>
  <p style="margin-top:20px;">Thank you,<br/>${escapeHtml(signer)}<br/>
    <a href="mailto:${escapeHtml(p.requesterEmail)}">${escapeHtml(p.requesterEmail)}</a></p>
</div>`;

  return { subject, html, text };
}

// ── Purchase Order email (multi-line, with ship-to) ───────────────────

export interface POEmailLine {
  description: string;
  quantity: number;
  uom?: string | null;
  unitPrice?: number | null;
}

export interface POEmailParams {
  poNumber: string;
  vendorName: string;
  shipTo?: string | null;
  lines: POEmailLine[];
  neededBy?: string | null;
  notes?: string | null;
  message?: string | null;
  requesterName?: string | null;
  requesterEmail: string;
}

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function buildPurchaseOrderEmail(p: POEmailParams): { subject: string; html: string; text: string } {
  const signer = p.requesterName?.trim() || p.requesterEmail;
  const subject = `Purchase Order ${p.poNumber}`;
  const allPriced = p.lines.length > 0 && p.lines.every((l) => l.unitPrice != null);
  const orderTotal = p.lines.reduce((sum, l) => sum + (l.unitPrice != null ? l.unitPrice * l.quantity : 0), 0);

  const fmtQty = (l: POEmailLine) => `${l.quantity}${l.uom ? ` ${l.uom}` : ''}`;
  const lineTotal = (l: POEmailLine) => (l.unitPrice != null ? money(l.unitPrice * l.quantity) : '—');

  // ── Plaintext ──
  const textLines = [
    `Hello ${p.vendorName},`,
    '',
    `Please find our purchase order ${p.poNumber} below.`,
    '',
    'Items:',
    ...p.lines.map(
      (l) => `  - ${l.description} — ${fmtQty(l)}${l.unitPrice != null ? ` @ ${money(l.unitPrice)} = ${lineTotal(l)}` : ''}`,
    ),
  ];
  if (allPriced) textLines.push('', `Order total: ${money(orderTotal)}`);
  if (p.shipTo) textLines.push('', `Deliver to: ${p.shipTo}`);
  if (p.neededBy) textLines.push(`Needed by: ${p.neededBy}`);
  if (p.notes?.trim()) textLines.push('', `Notes: ${p.notes.trim()}`);
  if (p.message?.trim()) textLines.push('', p.message.trim());
  textLines.push('', 'Please confirm availability, pricing, and lead time.', '', 'Thank you,', signer, p.requesterEmail);
  const text = textLines.join('\n');

  // ── HTML ──
  const th = 'style="text-align:left;padding:6px 12px;border-bottom:2px solid #e5e7eb;color:#6b7280;font-size:13px;"';
  const td = 'style="padding:6px 12px;border-bottom:1px solid #f3f4f6;"';
  const rowsHtml = p.lines
    .map(
      (l) =>
        `<tr><td ${td}>${escapeHtml(l.description)}</td>` +
        `<td ${td}>${escapeHtml(fmtQty(l))}</td>` +
        `<td ${td}>${l.unitPrice != null ? money(l.unitPrice) : '—'}</td>` +
        `<td ${td}>${lineTotal(l)}</td></tr>`,
    )
    .join('');
  const totalHtml = allPriced
    ? `<tr><td ${td} colspan="3" style="padding:6px 12px;text-align:right;font-weight:600;">Order total</td><td ${td} style="font-weight:600;">${money(orderTotal)}</td></tr>`
    : '';

  const metaBits: string[] = [];
  if (p.shipTo) metaBits.push(`<p style="margin:4px 0;"><strong>Deliver to:</strong> ${escapeHtml(p.shipTo)}</p>`);
  if (p.neededBy) metaBits.push(`<p style="margin:4px 0;"><strong>Needed by:</strong> ${escapeHtml(p.neededBy)}</p>`);
  if (p.notes?.trim()) metaBits.push(`<p style="margin:4px 0;"><strong>Notes:</strong> ${escapeHtml(p.notes.trim())}</p>`);
  const messageHtml = p.message?.trim() ? `<p style="margin:16px 0;white-space:pre-wrap;">${escapeHtml(p.message.trim())}</p>` : '';

  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;line-height:1.5;">
  <p>Hello ${escapeHtml(p.vendorName)},</p>
  <p>Please find our purchase order <strong>${escapeHtml(p.poNumber)}</strong> below.</p>
  <table style="border-collapse:collapse;margin:12px 0;width:100%;max-width:560px;">
    <thead><tr><th ${th}>Item</th><th ${th}>Qty</th><th ${th}>Unit Price</th><th ${th}>Total</th></tr></thead>
    <tbody>${rowsHtml}${totalHtml}</tbody>
  </table>
  ${metaBits.join('\n  ')}
  ${messageHtml}
  <p>Please confirm availability, pricing, and lead time.</p>
  <p style="margin-top:20px;">Thank you,<br/>${escapeHtml(signer)}<br/>
    <a href="mailto:${escapeHtml(p.requesterEmail)}">${escapeHtml(p.requesterEmail)}</a></p>
</div>`;

  return { subject, html, text };
}
