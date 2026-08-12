import { createInternalRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import { getAdminClient } from '@/utils/supabase/admin';
import { geocodeStructured } from '@/lib/geocode';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/**
 * POST /api/system/geocode-backfill
 *
 * Internal-only route that geocodes locations and vendors that have addresses
 * but no lat/lng coordinates. Uses Nominatim (1 req/sec rate limit).
 */
export const POST = createInternalRoute(async ({ log }) => {
  const supabase = getAdminClient();
  const results: { type: string; id: string; name: string; status: string; coords?: string }[] = [];

  // Fetch locations with addresses but no coordinates
  const { data: locations, error: locErr } = await supabase
    .schema('inventory' as any)
    .from('locations')
    .select('id, name, address')
    .eq('active', true)
    .not('address', 'is', null)
    .is('latitude' as any, null)
    .limit(50);

  if (locErr) {
    log.error('geocode_backfill.locations_failed', { error: locErr.message });
    throw AppError.internal(locErr.message);
  }

  // Fetch vendors with address fields but no coordinates
  const { data: vendors, error: vendErr } = await supabase
    .schema('supply_chain' as any)
    .from('vendors')
    .select('id, name, address_line_1, city, state, postal_code')
    .eq('active', true)
    .is('latitude' as any, null)
    .limit(50);

  if (vendErr) {
    log.error('geocode_backfill.vendors_failed', { error: vendErr.message });
    throw AppError.internal(vendErr.message);
  }

  // Geocode locations
  for (const loc of locations || []) {
    if (!loc.address) continue;

    await sleep(1100); // Nominatim rate limit: 1 req/sec

    try {
      const coords = await nominatimGeocode(loc.address);
      if (coords) {
        const { error: updateErr } = await supabase
          .schema('inventory' as any)
          .from('locations')
          .update({ latitude: coords.lat, longitude: coords.lng } as any)
          .eq('id', loc.id);

        if (updateErr) {
          results.push({ type: 'location', id: loc.id, name: loc.name, status: `update_failed: ${updateErr.message}` });
        } else {
          results.push({ type: 'location', id: loc.id, name: loc.name, status: 'geocoded', coords: `${coords.lat},${coords.lng}` });
        }
      } else {
        results.push({ type: 'location', id: loc.id, name: loc.name, status: 'no_results' });
      }
    } catch (err: any) {
      results.push({ type: 'location', id: loc.id, name: loc.name, status: `error: ${err.message}` });
    }
  }

  // Geocode vendors
  for (const vendor of vendors || []) {
    const addressParts = [
      (vendor as any).address_line_1,
      (vendor as any).city,
      (vendor as any).state,
      (vendor as any).postal_code,
    ].filter(Boolean);

    if (addressParts.length === 0) continue;

    await sleep(1100);

    try {
      const address = addressParts.join(', ');
      const coords = await nominatimGeocode(address);
      if (coords) {
        const { error: updateErr } = await supabase
          .schema('supply_chain' as any)
          .from('vendors')
          .update({ latitude: coords.lat, longitude: coords.lng } as any)
          .eq('id', vendor.id);

        if (updateErr) {
          results.push({ type: 'vendor', id: vendor.id, name: vendor.name, status: `update_failed: ${updateErr.message}` });
        } else {
          results.push({ type: 'vendor', id: vendor.id, name: vendor.name, status: 'geocoded', coords: `${coords.lat},${coords.lng}` });
        }
      } else {
        results.push({ type: 'vendor', id: vendor.id, name: vendor.name, status: 'no_results' });
      }
    } catch (err: any) {
      results.push({ type: 'vendor', id: vendor.id, name: vendor.name, status: `error: ${err.message}` });
    }
  }

  // Fetch per-vendor addresses with details but no coordinates. These power the
  // vendor locations map + nearest-location ranking, and previously had no
  // backfill path — so a street address Nominatim missed stayed null forever.
  const { data: vendorAddresses, error: addrErr } = await supabase
    .schema('supply_chain' as any)
    .from('vendor_addresses')
    .select('id, label, street1, street2, city, state, zip, country')
    .is('latitude' as any, null)
    .limit(50);

  if (addrErr) {
    log.error('geocode_backfill.vendor_addresses_failed', { error: addrErr.message });
    throw AppError.internal(addrErr.message);
  }

  // Geocode vendor addresses with the fallback cascade (street → city/ZIP → ZIP).
  for (const addr of vendorAddresses || []) {
    const a = addr as any;
    if (!a.street1 && !a.city && !a.zip) continue;

    await sleep(1100);

    try {
      const coords = await geocodeStructured(a);
      if (coords) {
        const { error: updateErr } = await supabase
          .schema('supply_chain' as any)
          .from('vendor_addresses')
          .update({ latitude: coords.latitude, longitude: coords.longitude } as any)
          .eq('id', a.id);

        if (updateErr) {
          results.push({ type: 'vendor_address', id: a.id, name: a.label || a.city || a.id, status: `update_failed: ${updateErr.message}` });
        } else {
          results.push({ type: 'vendor_address', id: a.id, name: a.label || a.city || a.id, status: 'geocoded', coords: `${coords.latitude},${coords.longitude}` });
        }
      } else {
        results.push({ type: 'vendor_address', id: a.id, name: a.label || a.city || a.id, status: 'no_results' });
      }
    } catch (err: any) {
      results.push({ type: 'vendor_address', id: a.id, name: a.label || a.city || a.id, status: `error: ${err.message}` });
    }
  }

  log.info('geocode_backfill.complete', {
    locations_processed: (locations || []).length,
    vendors_processed: (vendors || []).length,
    vendor_addresses_processed: (vendorAddresses || []).length,
    results_count: results.length,
  });

  return Response.json({
    data: {
      locations_found: (locations || []).length,
      vendors_found: (vendors || []).length,
      vendor_addresses_found: (vendorAddresses || []).length,
      results,
    },
  });
}, { serviceName: SERVICE_NAME });

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function nominatimGeocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const params = new URLSearchParams({
    q: address,
    format: 'json',
    limit: '1',
  });

  const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'SummitOne-InventoryManagement/1.0' },
  });

  if (!response.ok) return null;

  const results = await response.json();
  if (!results || results.length === 0) return null;

  const lat = parseFloat(results[0].lat);
  const lng = parseFloat(results[0].lon);

  if (isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}
