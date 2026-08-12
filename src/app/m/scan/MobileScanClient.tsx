'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Package, AlertCircle, Loader2, MapPin, Tag } from 'lucide-react';

type LookupResult = {
  type: 'asset';
  entity: {
    id: string;
    asset_tag: string;
    serial_number: string | null;
    status: string | null;
    catalog_item: { id: string; name: string; sku: string } | null;
    location: { id: string; name: string } | null;
  };
} | null;

function withBypass(url: string, secret: string): string {
  if (!secret) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}x-vercel-protection-bypass=${encodeURIComponent(secret)}`;
}

export function MobileScanClient({ bypassSecret }: { bypassSecret: string }) {
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const [result, setResult] = useState<LookupResult>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!code) return;

    setLoading(true);
    setError('');
    setResult(null);

    const url = withBypass(`/api/m/scan?code=${encodeURIComponent(code)}`, bypassSecret);

    fetch(url, {
      headers: bypassSecret
        ? { 'x-vercel-protection-bypass': bypassSecret }
        : {},
    })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) {
          // Error envelope can be { error: { message } } (chassis) or
          // { error: 'string' } — handle both, never render '[object Object]'.
          const err = json?.error;
          const message =
            typeof err === 'string' ? err : err?.message || json?.message;
          setError(typeof message === 'string' && message ? message : 'Not found');
          return;
        }
        setResult(json.data);
      })
      .catch(() => {
        setError('Failed to look up code. Check your connection.');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [code, bypassSecret]);

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      {/* Header */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-600 mb-3">
          <Package className="h-6 w-6" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Asset Lookup</h1>
        {code && (
          <p className="text-sm text-gray-500 mt-1 font-mono">{code}</p>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-12 text-gray-500">
          <Loader2 className="h-8 w-8 animate-spin mb-3" />
          <span className="text-sm">Looking up...</span>
        </div>
      )}

      {/* No code provided */}
      {!code && !loading && (
        <div className="p-6 bg-yellow-50 border border-yellow-200 rounded-xl text-center">
          <p className="text-sm text-yellow-800">
            No code provided. Scan a barcode or QR code to look up an item.
          </p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
          <div>
            <div className="font-medium text-red-900">Not Found</div>
            <div className="text-sm text-red-700 mt-1">{error}</div>
          </div>
        </div>
      )}

      {/* Result card */}
      {result && !loading && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {/* Status bar */}
          <div className={`px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white ${
            result.entity.status === 'available' ? 'bg-green-500' :
            result.entity.status === 'assigned' ? 'bg-blue-500' :
            result.entity.status === 'maintenance' ? 'bg-orange-500' :
            result.entity.status === 'retired' ? 'bg-gray-500' :
            'bg-gray-400'
          }`}>
            {result.entity.status || 'Unknown'}
          </div>

          <div className="p-5 space-y-4">
            {/* Asset tag */}
            <div className="flex items-center gap-3">
              <Tag className="h-5 w-5 text-gray-400 flex-shrink-0" />
              <div>
                <div className="text-xs text-gray-500 uppercase">Asset Tag</div>
                <div className="text-lg font-bold font-mono">{result.entity.asset_tag}</div>
              </div>
            </div>

            {/* Item name */}
            {result.entity.catalog_item && (
              <div className="flex items-center gap-3">
                <Package className="h-5 w-5 text-gray-400 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500 uppercase">Item</div>
                  <div className="font-medium">{result.entity.catalog_item.name}</div>
                  {result.entity.catalog_item.sku && (
                    <div className="text-xs text-gray-500">SKU: {result.entity.catalog_item.sku}</div>
                  )}
                </div>
              </div>
            )}

            {/* Serial number */}
            {result.entity.serial_number && (
              <div className="flex items-center gap-3">
                <Tag className="h-5 w-5 text-gray-400 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500 uppercase">Serial Number</div>
                  <div className="font-mono">{result.entity.serial_number}</div>
                </div>
              </div>
            )}

            {/* Location */}
            {result.entity.location && (
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-gray-400 flex-shrink-0" />
                <div>
                  <div className="text-xs text-gray-500 uppercase">Location</div>
                  <div className="font-medium">{result.entity.location.name}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
