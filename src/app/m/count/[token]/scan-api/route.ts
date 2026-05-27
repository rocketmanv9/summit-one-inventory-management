import { getAdminClient } from '@/utils/supabase/admin';
import { NextRequest } from 'next/server';

/**
 * POST /m/count/[token]/scan-api
 * Body: { code: string }
 *
 * Looks up a barcode/SKU/asset_tag in the cycle count, increments qty by 1,
 * and returns the result. Used by the inline-script scanner page to avoid
 * needing React hydration (which fails under Vercel deployment protection).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Parse body
  let code: string;
  try {
    const body = await req.json();
    code = (body.code || '').trim();
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!code) {
    return Response.json({ error: 'No code provided' }, { status: 400 });
  }

  // Validate session
  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data: session } = await inv
    .from('mobile_count_sessions')
    .select('id, tenant_id, cycle_count_id, created_by_user_id, expires_at, revoked_at')
    .eq('token', token)
    .single();

  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
    return Response.json({ error: 'Session expired' }, { status: 401 });
  }

  // Extract code from URL if QR
  let lookupCode = code;
  try {
    const url = new URL(code);
    const codeParam = url.searchParams.get('code');
    if (codeParam) lookupCode = codeParam;
  } catch {
    // Not a URL
  }

  // Find catalog item by barcode → SKU → asset_tag
  let catalogItemId: string | null = null;
  for (const [table, field, idField] of [
    ['catalog_items', 'barcode', 'id'],
    ['catalog_items', 'sku', 'id'],
    ['assets', 'asset_tag', 'catalog_item_id'],
  ] as const) {
    const { data } = await inv.from(table).select(idField).eq(field, lookupCode).limit(1);
    if (data && data.length > 0) {
      catalogItemId = (data[0] as any)[idField];
      break;
    }
  }

  if (!catalogItemId) {
    return Response.json({ error: `Not found: ${lookupCode}` }, { status: 404 });
  }

  // Get the count line
  let { data: line } = await inv
    .from('cycle_count_lines')
    .select('id, qty_counted, catalog_item_id')
    .eq('cycle_count_id', session.cycle_count_id)
    .eq('catalog_item_id', catalogItemId)
    .eq('tenant_id', session.tenant_id)
    .single();

  // For initial counts, auto-add the item if it exists in the catalog but not in the count
  if (!line) {
    const { data: cc } = await inv
      .from('cycle_counts')
      .select('count_type')
      .eq('id', session.cycle_count_id)
      .single();

    if (cc?.count_type === 'initial') {
      const { data: addedLine, error: addError } = await inv.rpc('rpc_inv_cycle_count_add_line', {
        p_cycle_count_id: session.cycle_count_id,
        p_catalog_item_id: catalogItemId,
        p_tenant_id: session.tenant_id,
        p_last_event_id: crypto.randomUUID(),
      });

      if (addError || !addedLine) {
        return Response.json({ error: addError?.message || 'Failed to add item to count' }, { status: 500 });
      }

      line = { id: addedLine.id, qty_counted: null, catalog_item_id: catalogItemId };
    } else {
      return Response.json({ error: `Not in count list: ${lookupCode}` }, { status: 404 });
    }
  }

  // Get item name
  const { data: item } = await inv
    .from('catalog_items')
    .select('name')
    .eq('id', catalogItemId)
    .single();

  // Increment qty
  const newQty = (line.qty_counted ?? 0) + 1;

  const { error: updateError } = await inv
    .from('cycle_count_lines')
    .update({
      qty_counted: newQty,
      counted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', line.id);

  if (updateError) {
    return Response.json({ error: updateError.message }, { status: 500 });
  }

  return Response.json({
    itemName: item?.name || lookupCode,
    newQty,
    added: true,
  });
}
