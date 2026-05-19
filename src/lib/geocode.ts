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
