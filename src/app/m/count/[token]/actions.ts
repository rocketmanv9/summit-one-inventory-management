'use server';

import { getAdminClient } from '@/utils/supabase/admin';
import { redirect } from 'next/navigation';

async function getSession(token: string) {
  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data: session } = await inv
    .from('mobile_count_sessions')
    .select('id, tenant_id, cycle_count_id, created_by_user_id, expires_at, revoked_at')
    .eq('token', token)
    .single();

  if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
    return null;
  }
  return session;
}

function buildRedirectUrl(token: string, bypass: string, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (bypass) params.set('x-vercel-protection-bypass', bypass);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      params.set(k, v);
    }
  }
  return `/m/count/${token}?${params.toString()}`;
}

export async function recordCount(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;
  const catalogItemId = formData.get('catalog_item_id') as string;
  const qtyStr = formData.get('qty') as string;
  const qty = parseFloat(qtyStr);

  if (!token || !catalogItemId || isNaN(qty) || qty < 0) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Invalid count value' }));
  }

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data: line } = await inv
    .from('cycle_count_lines')
    .select('id, qty_expected')
    .eq('cycle_count_id', session.cycle_count_id)
    .eq('catalog_item_id', catalogItemId)
    .eq('tenant_id', session.tenant_id)
    .single();

  if (line) {
    await inv
      .from('cycle_count_lines')
      .update({
        qty_counted: qty,
        counted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', line.id);
  }

  redirect(buildRedirectUrl(token, bypass));
}

export async function toggleAsset(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;
  const assetId = formData.get('asset_id') as string;
  const currentlyChecked = formData.get('currently_checked') === 'true';

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  await inv
    .from('cycle_count_asset_lines')
    .update({
      counted_present: !currentlyChecked,
      updated_at: new Date().toISOString(),
    })
    .eq('cycle_count_id', session.cycle_count_id)
    .eq('asset_id', assetId)
    .eq('tenant_id', session.tenant_id);

  redirect(buildRedirectUrl(token, bypass));
}

export async function submitCount(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { error } = await inv
    .from('cycle_counts')
    .update({
      status: 'under_review',
      completed_at: new Date().toISOString(),
    })
    .eq('id', session.cycle_count_id)
    .eq('tenant_id', session.tenant_id)
    .eq('status', 'in_progress');

  if (error) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Failed to submit' }));
  }

  redirect(buildRedirectUrl(token, bypass, { submitted: '1' }));
}

/** Called by the client-side scanner — returns data instead of redirecting */
export async function scanLookup(token: string, code: string): Promise<{ catalogItemId?: string; itemName?: string; currentQty?: number | null; error?: string }> {
  const session = await getSession(token);
  if (!session) return { error: 'Session expired' };

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

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

  if (!catalogItemId) return { error: `Not found: ${lookupCode}` };

  // Get the count line
  const { data: line } = await inv
    .from('cycle_count_lines')
    .select('id, qty_counted, catalog_item_id')
    .eq('cycle_count_id', session.cycle_count_id)
    .eq('catalog_item_id', catalogItemId)
    .eq('tenant_id', session.tenant_id)
    .single();

  if (!line) return { error: `Not in count list: ${lookupCode}` };

  // Get item name
  const { data: item } = await inv.from('catalog_items').select('name').eq('id', catalogItemId).single();

  return {
    catalogItemId,
    itemName: item?.name || lookupCode,
    currentQty: line.qty_counted,
  };
}

/** Called by the client-side scanner to record a count */
export async function scanRecord(token: string, catalogItemId: string, newQty: number): Promise<{ success?: boolean; error?: string }> {
  const session = await getSession(token);
  if (!session) return { error: 'Session expired' };

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data: line } = await inv
    .from('cycle_count_lines')
    .select('id')
    .eq('cycle_count_id', session.cycle_count_id)
    .eq('catalog_item_id', catalogItemId)
    .eq('tenant_id', session.tenant_id)
    .single();

  if (!line) return { error: 'Line not found' };

  const { error } = await inv
    .from('cycle_count_lines')
    .update({
      qty_counted: newQty,
      counted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', line.id);

  if (error) return { error: error.message };
  return { success: true };
}

export async function lookupBarcode(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;
  const code = (formData.get('code') as string || '').trim();

  if (!code) {
    redirect(buildRedirectUrl(token, bypass));
  }

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  // Search catalog items by barcode, SKU, or asset tag
  const { data: byBarcode } = await inv
    .from('catalog_items')
    .select('id')
    .eq('barcode', code)
    .limit(1);

  if (byBarcode && byBarcode.length > 0) {
    redirect(buildRedirectUrl(token, bypass, { highlight: byBarcode[0].id }));
  }

  const { data: bySku } = await inv
    .from('catalog_items')
    .select('id')
    .eq('sku', code)
    .limit(1);

  if (bySku && bySku.length > 0) {
    redirect(buildRedirectUrl(token, bypass, { highlight: bySku[0].id }));
  }

  // Try asset tag
  const { data: byTag } = await inv
    .from('assets')
    .select('catalog_item_id')
    .eq('asset_tag', code)
    .limit(1);

  if (byTag && byTag.length > 0) {
    redirect(buildRedirectUrl(token, bypass, { highlight: byTag[0].catalog_item_id }));
  }

  redirect(buildRedirectUrl(token, bypass, { error: `No item found for: ${code}` }));
}
