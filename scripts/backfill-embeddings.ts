/**
 * Backfill Embeddings Queue
 *
 * Scans catalog_items, vendors, and locations that lack embeddings
 * and inserts them into the embedding_queue table for async processing.
 *
 * Usage: npx tsx scripts/backfill-embeddings.ts
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'inventory' },
});

const supplyChain = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'supply_chain' },
});

async function backfill() {
  let totalQueued = 0;

  // ── Catalog items without embeddings ─────────────────────────────────
  console.log('Scanning catalog_items without embeddings...');
  const { data: items, error: itemsErr } = await supabase
    .from('catalog_items')
    .select('id, tenant_id')
    .is('embedding', null)
    .limit(10000);

  if (itemsErr) {
    console.error('Error fetching catalog_items:', itemsErr.message);
  } else if (items && items.length > 0) {
    const itemRows = items.map((item: any) => ({
      tenant_id: item.tenant_id,
      entity_type: 'item',
      entity_id: item.id,
      status: 'pending',
    }));

    const { error: insertErr } = await supabase
      .from('embedding_queue')
      .upsert(itemRows, { onConflict: 'entity_type,entity_id' })
      .select('id');

    if (insertErr) {
      console.error('Error inserting item queue entries:', insertErr.message);
    } else {
      console.log(`  Queued ${itemRows.length} catalog items.`);
      totalQueued += itemRows.length;
    }
  } else {
    console.log('  No catalog items need embeddings.');
  }

  // ── Vendors without embeddings ───────────────────────────────────────
  console.log('Scanning vendors without embeddings...');
  const { data: vendors, error: vendorsErr } = await supplyChain
    .from('vendors')
    .select('id, tenant_id')
    .is('embedding', null)
    .limit(10000);

  if (vendorsErr) {
    console.error('Error fetching vendors:', vendorsErr.message);
  } else if (vendors && vendors.length > 0) {
    const vendorRows = vendors.map((v: any) => ({
      tenant_id: v.tenant_id,
      entity_type: 'vendor',
      entity_id: v.id,
      status: 'pending',
    }));

    const { error: insertErr } = await supabase
      .from('embedding_queue')
      .upsert(vendorRows, { onConflict: 'entity_type,entity_id' })
      .select('id');

    if (insertErr) {
      console.error('Error inserting vendor queue entries:', insertErr.message);
    } else {
      console.log(`  Queued ${vendorRows.length} vendors.`);
      totalQueued += vendorRows.length;
    }
  } else {
    console.log('  No vendors need embeddings.');
  }

  // ── Locations without embeddings ─────────────────────────────────────
  console.log('Scanning locations without embeddings...');
  const { data: locations, error: locationsErr } = await supabase
    .from('locations')
    .select('id, tenant_id')
    .is('embedding', null)
    .limit(10000);

  if (locationsErr) {
    console.error('Error fetching locations:', locationsErr.message);
  } else if (locations && locations.length > 0) {
    const locationRows = locations.map((l: any) => ({
      tenant_id: l.tenant_id,
      entity_type: 'location',
      entity_id: l.id,
      status: 'pending',
    }));

    const { error: insertErr } = await supabase
      .from('embedding_queue')
      .upsert(locationRows, { onConflict: 'entity_type,entity_id' })
      .select('id');

    if (insertErr) {
      console.error('Error inserting location queue entries:', insertErr.message);
    } else {
      console.log(`  Queued ${locationRows.length} locations.`);
      totalQueued += locationRows.length;
    }
  } else {
    console.log('  No locations need embeddings.');
  }

  console.log(`\nDone. Total entities queued for embedding: ${totalQueued}`);
}

backfill().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
