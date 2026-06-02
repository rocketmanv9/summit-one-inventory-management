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
