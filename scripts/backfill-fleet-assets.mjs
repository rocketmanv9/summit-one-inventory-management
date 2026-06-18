// One-time backfill: mirror existing Fleet vehicles/equipment into Inventory.
// Connects to BOTH stage projects directly (server-side) so nothing routes
// through a chat context. Re-runnable: the apply RPC dedups by fleet_asset_id.
//
// Usage: node scripts/backfill-fleet-assets.mjs
// Requires .env.stage.tmp in each repo (pulled via `vercel env pull`).

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function parseEnv(path) {
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
}

const inv = parseEnv('.env.stage.tmp');
const fleet = parseEnv('../summit-one-fleet-management/.env.stage.tmp');

const fleetDb = createClient(fleet.NEXT_PUBLIC_SUPABASE_URL, fleet.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const invDb = createClient(inv.NEXT_PUBLIC_SUPABASE_URL, inv.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  db: { schema: 'inventory' },
});

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const { data: assets, error: fErr } = await fleetDb
  .from('fleet_assets')
  .select('id, tenant_id, asset_type, name, serial_number, vin, unit_number, status')
  .in('asset_type', ['vehicle', 'equipment'])
  .neq('status', 'retired');
if (fErr) throw fErr;
console.log(`Fleet vehicles/equipment to mirror: ${assets.length}`);

const rows = assets.map((a) => ({
  tn: a.tenant_id, id: a.id, t: a.asset_type, n: a.name,
  s: a.serial_number, v: a.vin, u: a.unit_number, st: a.status,
}));

let applied = 0;
const allPairs = [];
for (const part of chunk(rows, 100)) {
  const { data, error } = await invDb.rpc('rpc_bulk_apply_fleet_assets', { p_rows: part });
  if (error) throw error;
  applied += data.applied;
  allPairs.push(...data.pairs);
  console.log(`  applied ${applied}/${rows.length}`);
}

// Set the reverse link (fleet_assets.inventory_asset_id) so future inventory->fleet
// edits correlate without creating duplicates (esp. assets lacking serial/vin).
let linked = 0;
for (const part of chunk(allPairs, 200)) {
  const { data, error } = await fleetDb.rpc('rpc_link_inventory_assets', { p_pairs: part });
  if (error) throw error;
  linked += data;
}
console.log(`Done. Mirrored ${applied} assets into inventory; reverse-linked ${linked} fleet rows.`);
