/**
 * Backfill vendor address coordinates
 *
 * Geocodes supply_chain.vendor_addresses rows that have a street/city but no
 * latitude/longitude, so the "closest vendor location" suggestion on purchase
 * orders works for addresses created before geocoding was wired in (and for
 * addresses copied from the GV catalog during adoption, which arrive without
 * coordinates).
 *
 * Standalone script — uses the service-role client directly (allowed in
 * scripts per CLAUDE.md). Respects Nominatim's 1 req/sec policy.
 *
 * Usage: npx tsx scripts/backfill-vendor-address-geocode.ts
 */

import { createClient } from '@supabase/supabase-js';
import { geocodeAddress } from '../src/lib/geocode';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.');
  process.exit(1);
}

const sc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'supply_chain' },
});

async function backfill() {
  const { data: rows, error } = await sc
    .from('vendor_addresses')
    .select('id, street1, city, state, zip')
    .or('latitude.is.null,longitude.is.null')
    .limit(10000);

  if (error) {
    console.error('Error fetching vendor_addresses:', error.message);
    process.exit(1);
  }

  const candidates = (rows || []).filter((r: any) => r.street1 || r.city || r.zip);
  console.log(`Found ${candidates.length} vendor address(es) needing coordinates.`);

  let updated = 0;
  let skipped = 0;
  for (const r of candidates) {
    const q = [r.street1, r.city, r.state, r.zip].filter(Boolean).join(', ');
    const geo = await geocodeAddress(q); // rate-limited to 1/sec internally
    if (!geo) {
      skipped++;
      console.warn(`  no match: ${q}`);
      continue;
    }
    const { error: upErr } = await sc
      .from('vendor_addresses')
      .update({ latitude: geo.latitude, longitude: geo.longitude })
      .eq('id', r.id);
    if (upErr) {
      skipped++;
      console.warn(`  update failed for ${r.id}: ${upErr.message}`);
    } else {
      updated++;
      console.log(`  ${q} -> ${geo.latitude}, ${geo.longitude}`);
    }
  }

  console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`);
}

backfill().catch((err) => {
  console.error(err);
  process.exit(1);
});
