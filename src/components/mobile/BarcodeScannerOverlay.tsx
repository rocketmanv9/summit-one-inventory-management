'use client';

import { useEffect, useRef, useCallback } from 'react';

interface BarcodeScannerOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
}

export function BarcodeScannerOverlay({ isOpen, onClose, onScan }: BarcodeScannerOverlayProps) {
  const scannerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const cleanup = useCallback(async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch {
        // Ignore cleanup errors
      }
      scannerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      cleanup();
      return;
    }

    let cancelled = false;

    const startScanner = async () => {
      const { Html5Qrcode } = await import('html5-qrcode');

      if (cancelled || !containerRef.current) return;

      const scanner = new Html5Qrcode('mobile-barcode-scanner');
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
            onScan(decodedText);
            cleanup();
            onClose();
          },
          () => {
            // Ignore scan failures (no code found in frame)
          }
        );
      } catch (err) {
        console.error('Camera error:', err);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [isOpen, onScan, onClose, cleanup]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between p-4 z-10">
        <span className="text-white font-medium">Scan Barcode</span>
        <button
          onClick={() => {
            cleanup();
            onClose();
          }}
          className="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center"
        >
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex items-center justify-center h-full">
        <div id="mobile-barcode-scanner" ref={containerRef} className="w-full max-w-md" />
      </div>

      <div className="absolute bottom-0 left-0 right-0 p-6 text-center">
        <p className="text-white/70 text-sm">
          Point your camera at a barcode or QR code
        </p>
      </div>
    </div>
  );
}
