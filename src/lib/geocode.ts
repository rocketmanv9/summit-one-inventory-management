/**
 * Geocoding utility using OpenStreetMap Nominatim
 * Rate-limited to 1 request/sec per Nominatim usage policy
 */

let lastRequestTime = 0;

async function rateLimitGuard(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000 - elapsed));
  }
  lastRequestTime = Date.now();
}

export interface GeocodeResult {
  latitude: number;
  longitude: number;
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  if (!address.trim()) return null;

  await rateLimitGuard();

  try {
    const params = new URLSearchParams({
      q: address,
      format: 'json',
      limit: '1',
    });

    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        headers: {
          'User-Agent': 'SummitOne-InventoryManagement/1.0',
        },
      }
    );

    if (!response.ok) return null;

    const results = await response.json();
    if (!results || results.length === 0) return null;

    const lat = parseFloat(results[0].lat);
    const lon = parseFloat(results[0].lon);

    if (isNaN(lat) || isNaN(lon)) return null;

    return { latitude: lat, longitude: lon };
  } catch {
    return null;
  }
}

export interface AddressParts {
  street1?: string | null;
  street2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
}

/**
 * Great-circle (haversine) distance in miles between two lat/lng points.
 * Mirrors the miles unit used by the server-side `rpc_nearest_vendor_addresses`
 * ranking so client and server distances are comparable.
 */
export function distanceMiles(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8; // Earth radius in miles
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

const clean = (s?: string | null) => (s ? s.trim() : '');

/**
 * Geocode an address with a progressively-coarser fallback cascade.
 *
 * Nominatim's free-form search frequently returns no result at full street
 * precision (it's OSM-coverage dependent), so a single street query silently
 * yields null. We fall back to city/state/zip and then zip so any address with
 * a city or ZIP still resolves to a usable coordinate — accurate enough for the
 * "nearest vendor location" ranking, which works in miles.
 *
 * Returns the first hit, or null if even the coarsest query misses.
 */
export async function geocodeStructured(parts: AddressParts): Promise<GeocodeResult | null> {
  const country = clean(parts.country) || 'USA';
  const street = [clean(parts.street1), clean(parts.street2)].filter(Boolean).join(' ');
  const city = clean(parts.city);
  const state = clean(parts.state);
  const zip = clean(parts.zip);

  const queries = [
    [street, city, state, zip].filter(Boolean).join(', '), // full street precision
    [city, state, zip].filter(Boolean).join(', '),         // city + ZIP centroid
    [city, state].filter(Boolean).join(', '),              // city centroid
    zip,                                                    // ZIP centroid
  ]
    .map((q) => (q ? `${q}, ${country}` : ''))
    .filter(Boolean);

  const seen = new Set<string>();
  for (const q of queries) {
    if (seen.has(q)) continue;
    seen.add(q);
    const result = await geocodeAddress(q);
    if (result) return result;
  }
  return null;
}
