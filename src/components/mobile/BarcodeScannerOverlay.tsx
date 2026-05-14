'use client';

import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';

interface BarcodeScannerOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
}

export function BarcodeScannerOverlay({ isOpen, onClose, onScan }: BarcodeScannerOverlayProps) {
  const scannerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [manualCode, setManualCode] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [showManual, setShowManual] = useState(false);
  const hasScannedRef = useRef(false);

  const cleanup = useCallback(async () => {
    if (scannerRef.current) {
      try {
        const state = scannerRef.current.getState?.();
        // State 2 = SCANNING, 3 = PAUSED
        if (state === 2 || state === 3) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // Ignore cleanup errors
      }
      scannerRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    cleanup();
    setManualCode('');
    setCameraError('');
    setShowManual(false);
    hasScannedRef.current = false;
    onClose();
  }, [cleanup, onClose]);

  const handleManualSubmit = useCallback(() => {
    const code = manualCode.trim();
    if (!code) return;
    handleClose();
    onScan(code);
  }, [manualCode, handleClose, onScan]);

  useEffect(() => {
    if (!isOpen) {
      cleanup();
      return;
    }

    hasScannedRef.current = false;
    let cancelled = false;

    const startScanner = async () => {
      // Dynamic import to avoid SSR issues
      const { Html5Qrcode } = await import('html5-qrcode');

      if (cancelled || !containerRef.current) return;

      const scannerId = 'barcode-scanner-region';
      // Ensure the container div exists
      if (!document.getElementById(scannerId)) {
        const div = document.createElement('div');
        div.id = scannerId;
        containerRef.current.appendChild(div);
      }

      try {
        const scanner = new Html5Qrcode(scannerId);
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          {
            fps: 10,
            qrbox: { width: 260, height: 160 },
            aspectRatio: 1.777,
          },
          (decodedText: string) => {
            if (hasScannedRef.current) return;
            hasScannedRef.current = true;
            cleanup();
            onScan(decodedText);
            onClose();
          },
          () => {
            // Ignore scan failures (no barcode in frame)
          }
        );
      } catch (err: any) {
        if (cancelled) return;
        const msg =
          err?.message?.includes('NotAllowed') || err?.name === 'NotAllowedError'
            ? 'Camera access denied. Please allow camera access or use manual entry.'
            : 'Could not access camera. Use manual entry below.';
        setCameraError(msg);
        setShowManual(true);
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
      display: 'flex',
      flexDirection: 'column',
    },
    topBar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px',
      paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
      zIndex: 10,
      position: 'relative',
    },
    topBarTitle: {
      color: '#fff',
      fontWeight: 600,
      fontSize: '17px',
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
    videoArea: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      position: 'relative',
    },
    bottomArea: {
      padding: '16px 20px',
      paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
      background: 'rgba(0,0,0,0.8)',
    },
    hintText: {
      color: 'rgba(255,255,255,0.7)',
      fontSize: '14px',
      textAlign: 'center',
      margin: '0 0 12px 0',
    },
    errorText: {
      color: '#fca5a5',
      fontSize: '14px',
      textAlign: 'center',
      margin: '0 0 12px 0',
    },
    manualToggle: {
      color: '#93c5fd',
      fontSize: '14px',
      textAlign: 'center',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      padding: '8px',
      width: '100%',
      textDecoration: 'underline',
      WebkitTapHighlightColor: 'transparent',
    },
    manualRow: {
      display: 'flex',
      gap: '8px',
      marginTop: '8px',
    },
    manualInput: {
      flex: 1,
      padding: '12px 16px',
      fontSize: '16px',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.3)',
      background: 'rgba(255,255,255,0.15)',
      color: '#fff',
      WebkitAppearance: 'none',
      appearance: 'none' as any,
    },
    manualSubmit: {
      padding: '12px 20px',
      background: '#2563eb',
      color: '#fff',
      borderRadius: '10px',
      fontWeight: 600,
      fontSize: '14px',
      border: 'none',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      WebkitTapHighlightColor: 'transparent',
    },
  };

  return (
    <div style={s.overlay}>
      <div style={s.topBar}>
        <span style={s.topBarTitle}>Scan Barcode</span>
        <button onClick={handleClose} style={s.closeBtn}>
          <svg width="24" height="24" fill="none" stroke="#fff" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div style={s.videoArea} ref={containerRef}>
        {cameraError && (
          <div style={{ position: 'absolute', padding: '24px', textAlign: 'center', zIndex: 5 }}>
            <p style={{ color: '#fca5a5', fontSize: '15px', margin: 0 }}>{cameraError}</p>
          </div>
        )}
      </div>

      <div style={s.bottomArea}>
        {cameraError ? (
          <p style={s.errorText}>{cameraError}</p>
        ) : (
          <p style={s.hintText}>Point camera at a barcode or QR code</p>
        )}

        {!showManual && (
          <button onClick={() => setShowManual(true)} style={s.manualToggle}>
            Enter code manually
          </button>
        )}

        {showManual && (
          <div style={s.manualRow}>
            <input
              type="text"
              placeholder="Type barcode or SKU..."
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
              autoFocus
              className="m-input"
              style={s.manualInput}
            />
            <button
              onClick={handleManualSubmit}
              disabled={!manualCode.trim()}
              style={{
                ...s.manualSubmit,
                opacity: manualCode.trim() ? 1 : 0.5,
              }}
            >
              Look Up
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
