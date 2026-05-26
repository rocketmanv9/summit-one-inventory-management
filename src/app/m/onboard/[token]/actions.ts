'use server';

import { getAdminClient } from '@/utils/supabase/admin';
import { redirect } from 'next/navigation';

async function getSession(token: string) {
  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data: session } = await inv
    .from('mobile_onboarding_sessions')
    .select('id, tenant_id, location_id, created_by_user_id, status, expires_at, revoked_at')
    .eq('token', token)
    .single();

  if (!session || session.revoked_at || session.status !== 'in_progress' || new Date(session.expires_at) < new Date()) {
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
  return `/m/onboard/${token}?${params.toString()}`;
}

export async function setQuantity(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;
  const lineId = formData.get('line_id') as string;
  const qtyStr = formData.get('qty') as string;
  const qty = parseFloat(qtyStr);

  if (!token || !lineId || isNaN(qty) || qty < 0) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Invalid quantity' }));
  }

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired or submitted' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  await inv
    .from('mobile_onboarding_lines')
    .update({
      target_qty: qty,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lineId)
    .eq('onboarding_session_id', session.id);

  redirect(buildRedirectUrl(token, bypass));
}

export async function incrementQty(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;
  const lineId = formData.get('line_id') as string;
  const currentQty = parseFloat(formData.get('current_qty') as string) || 0;

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired or submitted' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  await inv
    .from('mobile_onboarding_lines')
    .update({
      target_qty: currentQty + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', lineId)
    .eq('onboarding_session_id', session.id);

  redirect(buildRedirectUrl(token, bypass));
}

export async function decrementQty(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;
  const lineId = formData.get('line_id') as string;
  const currentQty = parseFloat(formData.get('current_qty') as string) || 0;

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired or submitted' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  await inv
    .from('mobile_onboarding_lines')
    .update({
      target_qty: Math.max(0, currentQty - 1),
      updated_at: new Date().toISOString(),
    })
    .eq('id', lineId)
    .eq('onboarding_session_id', session.id);

  redirect(buildRedirectUrl(token, bypass));
}

export async function addItemToSession(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;
  const catalogItemId = formData.get('catalog_item_id') as string;

  if (!token || !catalogItemId) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Missing item' }));
  }

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired or submitted' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  // Get current stock balance for this item at this location
  const { data: balance } = await inv
    .from('stock_balances')
    .select('qty_on_hand')
    .eq('catalog_item_id', catalogItemId)
    .eq('location_id', session.location_id)
    .eq('tenant_id', session.tenant_id)
    .single();

  const currentQty = balance?.qty_on_hand ?? 0;

  // Upsert onboarding line (idempotent if item already added)
  const { error } = await inv
    .from('mobile_onboarding_lines')
    .upsert({
      tenant_id: session.tenant_id,
      onboarding_session_id: session.id,
      catalog_item_id: catalogItemId,
      existing_qty: currentQty,
      target_qty: currentQty,
    }, { onConflict: 'onboarding_session_id,catalog_item_id' })
    .select();

  if (error) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Failed to add item' }));
  }

  redirect(buildRedirectUrl(token, bypass));
}

export async function quickCreateItem(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;
  const name = (formData.get('name') as string || '').trim();

  if (!name) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Item name is required' }));
  }

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired or submitted' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  // Generate sequential SKU: NEW-XXXX
  const { data: lastItem } = await inv
    .from('catalog_items')
    .select('sku')
    .eq('tenant_id', session.tenant_id)
    .like('sku', 'NEW-%')
    .order('sku', { ascending: false })
    .limit(1);

  let nextSeq = 1;
  if (lastItem && lastItem.length > 0) {
    const match = lastItem[0].sku.match(/NEW-(\d+)/);
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }
  const sku = `NEW-${String(nextSeq).padStart(4, '0')}`;

  // Insert catalog item
  const { data: newItem, error: itemError } = await inv
    .from('catalog_items')
    .insert({
      tenant_id: session.tenant_id,
      name,
      sku,
      tracking_mode: 'stock',
      active: true,
      created_by_user_id: session.created_by_user_id,
    })
    .select()
    .single();

  if (itemError || !newItem) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Failed to create item' }));
  }

  // Add to onboarding session with qty 0
  await inv
    .from('mobile_onboarding_lines')
    .upsert({
      tenant_id: session.tenant_id,
      onboarding_session_id: session.id,
      catalog_item_id: newItem.id,
      existing_qty: 0,
      target_qty: 0,
    }, { onConflict: 'onboarding_session_id,catalog_item_id' });

  redirect(buildRedirectUrl(token, bypass));
}

export async function removeItem(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;
  const lineId = formData.get('line_id') as string;

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired or submitted' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  await inv
    .from('mobile_onboarding_lines')
    .delete()
    .eq('id', lineId)
    .eq('onboarding_session_id', session.id);

  redirect(buildRedirectUrl(token, bypass));
}

export async function submitOnboarding(formData: FormData) {
  const token = formData.get('token') as string;
  const bypass = formData.get('_bypass') as string;

  const session = await getSession(token);
  if (!session) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Session expired or submitted' }));
  }

  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data, error } = await inv.rpc('rpc_submit_onboarding', {
    p_session_id: session.id,
    p_tenant_id: session.tenant_id,
    p_user_id: session.created_by_user_id,
  });

  if (error) {
    redirect(buildRedirectUrl(token, bypass, { error: 'Failed to submit: ' + error.message }));
  }

  redirect(buildRedirectUrl(token, bypass, { submitted: '1' }));
}
