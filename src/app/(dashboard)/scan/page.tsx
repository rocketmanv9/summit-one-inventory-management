'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { PageHeader } from '@/components/ui/PageHeader';
import { SubTabs } from '@/components/ui/SubTabs';
import Link from 'next/link';
import { ScanBarcode, Keyboard, Package, Wrench, AlertCircle, Loader2 } from 'lucide-react';

type LookupResult = {
  type: 'asset' | 'tool';
  entity: any;
  href: string;
} | null;

export default function ScanPage() {
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manualCode, setManualCode] = useState('');
  const [result, setResult] = useState<LookupResult>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [scannerReady, setScannerReady] = useState(false);
  const scannerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const lookup = useCallback(async (code: string) => {
    if (!code.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch(`/api/scan/lookup?code=${encodeURIComponent(code.trim())}`);
      const json = await res.json();

      if (!res.ok) {
        setError(json.message || 'Not found');
        return;
      }

      setResult(json.data);
    } catch {
      setError('Failed to look up code. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  const cleanupScanner = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Ignore cleanup errors
      }
      scannerRef.current = null;
    }
    setScannerReady(false);
  }, []);

  useEffect(() => {
    if (mode !== 'camera') {
      cleanupScanner();
      return;
    }

    let cancelled = false;

    const startScanner = async () => {
      const { Html5Qrcode } = await import('html5-qrcode');
      if (cancelled || !containerRef.current) return;

      const scanner = new Html5Qrcode('scan-page-scanner');
      scannerRef.current = scanner;

      try {
        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 250, height: 150 },
            aspectRatio: 1.0,
          },
          (decodedText) => {
            lookup(decodedText);
          },
          () => {
            // No code found in frame — expected
          },
        );
        if (!cancelled) setScannerReady(true);
      } catch (err) {
        console.error('Camera error:', err);
        if (!cancelled) {
          setError('Could not access camera. Try manual entry instead.');
          setMode('manual');
        }
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      cleanupScanner();
    };
  }, [mode, lookup, cleanupScanner]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    lookup(manualCode);
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-2xl mx-auto">
        <PageHeader
          title="Scan Barcode"
          description="Scan an asset tag or tool barcode to quickly look up details."
        />

        {/* Mode toggle */}
        <SubTabs
          value={mode}
          onChange={setMode}
          aria-label="Scan mode"
          tabs={[
            { value: 'camera', label: 'Camera', icon: ScanBarcode },
            { value: 'manual', label: 'Manual Entry', icon: Keyboard },
          ]}
        />

        {/* Camera mode */}
        {mode === 'camera' && (
          <div className="rounded-lg border bg-black overflow-hidden">
            <div
              id="scan-page-scanner"
              ref={containerRef}
              className="w-full min-h-[300px]"
            />
            {!scannerReady && !error && (
              <div className="flex items-center justify-center py-12 text-white/70 text-sm">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Starting camera...
              </div>
            )}
          </div>
        )}

        {/* Manual entry mode */}
        {mode === 'manual' && (
          <form onSubmit={handleManualSubmit} className="flex gap-2">
            <input
              type="text"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              placeholder="Enter asset tag, serial number, or tool ID..."
              className="flex-1 px-4 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-primary"
              autoFocus
            />
            <button
              type="submit"
              disabled={loading || !manualCode.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? 'Looking up...' : 'Look Up'}
            </button>
          </form>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Looking up code...
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-medium text-red-900">Not Found</div>
              <div className="text-sm text-red-700 mt-1">{error}</div>
            </div>
          </div>
        )}

        {/* Result card */}
        {result && !loading && (
          <div className="border rounded-lg p-6 bg-card">
            <div className="flex items-start gap-4">
              <div className={`p-3 rounded-lg ${
                result.type === 'asset' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'
              }`}>
                {result.type === 'asset' ? (
                  <Package className="h-6 w-6" />
                ) : (
                  <Wrench className="h-6 w-6" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase font-medium text-muted-foreground tracking-wide">
                  {result.type === 'asset' ? 'Asset' : 'Tool'}
                </div>

                {result.type === 'asset' && (
                  <>
                    <div className="text-lg font-semibold mt-1">
                      {result.entity.asset_tag}
                    </div>
                    {result.entity.catalog_items?.name && (
                      <div className="text-sm text-muted-foreground">
                        {result.entity.catalog_items.name}
                        {result.entity.catalog_items.sku && ` (${result.entity.catalog_items.sku})`}
                      </div>
                    )}
                    {result.entity.serial_number && (
                      <div className="text-sm mt-1">
                        <span className="text-muted-foreground">Serial:</span>{' '}
                        <span className="font-mono">{result.entity.serial_number}</span>
                      </div>
                    )}
                    {result.entity.locations?.name && (
                      <div className="text-sm mt-1">
                        <span className="text-muted-foreground">Location:</span>{' '}
                        {result.entity.locations.name}
                      </div>
                    )}
                    {result.entity.status && (
                      <div className="text-sm mt-1">
                        <span className="text-muted-foreground">Status:</span>{' '}
                        <span className="capitalize">{result.entity.status}</span>
                      </div>
                    )}
                  </>
                )}

                {result.type === 'tool' && (
                  <>
                    <div className="text-lg font-semibold mt-1">
                      {result.entity.name}
                    </div>
                    {result.entity.manufacturer && (
                      <div className="text-sm text-muted-foreground">
                        {result.entity.manufacturer}
                        {result.entity.model && ` - ${result.entity.model}`}
                      </div>
                    )}
                    {result.entity.description && (
                      <div className="text-sm mt-1 text-muted-foreground">
                        {result.entity.description}
                      </div>
                    )}
                  </>
                )}

                <Link
                  href={result.href}
                  className="inline-block mt-4 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  View in {result.type === 'asset' ? 'Assets' : 'Tools'}
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
