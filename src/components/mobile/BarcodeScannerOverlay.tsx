'use client';

import { useEffect, useRef, useCallback, type CSSProperties } from 'react';

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

  const s: Record<string, CSSProperties> = {
    overlay: {
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: 50,
      background: '#000',
    },
    topBar: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px',
      zIndex: 10,
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
    },
    topBarTitle: {
      color: '#fff',
      fontWeight: 500,
      fontSize: '16px',
    },
    closeBtn: {
      width: '40px',
      height: '40px',
      background: 'rgba(255,255,255,0.2)',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: 'none',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent',
    },
    scannerArea: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
    },
    scannerContainer: {
      width: '100%',
      maxWidth: '448px',
    },
    bottomHint: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      padding: '24px',
      textAlign: 'center',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 24px)',
    },
    hintText: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: '14px',
      margin: 0,
    },
  };

  return (
    <div style={s.overlay}>
      <div style={s.topBar}>
        <span style={s.topBarTitle}>Scan Barcode</span>
        <button
          onClick={() => {
            cleanup();
            onClose();
          }}
          style={s.closeBtn}
        >
          <svg width="24" height="24" fill="none" stroke="#fff" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div style={s.scannerArea}>
        <div id="mobile-barcode-scanner" ref={containerRef} style={s.scannerContainer} />
      </div>

      <div style={s.bottomHint}>
        <p style={s.hintText}>
          Point your camera at a barcode or QR code
        </p>
      </div>
    </div>
  );
}
