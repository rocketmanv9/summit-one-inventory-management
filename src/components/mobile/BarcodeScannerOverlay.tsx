'use client';

import { useEffect, useRef, useState, useCallback, type CSSProperties } from 'react';

interface BarcodeScannerOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (decodedText: string) => void;
}

export function BarcodeScannerOverlay({ isOpen, onClose, onScan }: BarcodeScannerOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<any>(null);
  const scanningRef = useRef(false);
  const [manualCode, setManualCode] = useState('');
  const [cameraError, setCameraError] = useState('');
  const [showManual, setShowManual] = useState(false);

  const stopCamera = useCallback(() => {
    scanningRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    stopCamera();
    setManualCode('');
    setCameraError('');
    setShowManual(false);
    onClose();
  }, [stopCamera, onClose]);

  const handleManualSubmit = useCallback(() => {
    const code = manualCode.trim();
    if (!code) return;
    handleClose();
    onScan(code);
  }, [manualCode, handleClose, onScan]);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    let cancelled = false;

    const startCamera = async () => {
      // Check if BarcodeDetector is available (Safari 16.4+, Chrome 83+)
      const hasBarcodeDetector = typeof (window as any).BarcodeDetector !== 'undefined';

      if (!hasBarcodeDetector) {
        setCameraError('Barcode scanning is not supported on this device. Use manual entry below.');
        setShowManual(true);
        return;
      }

      try {
        detectorRef.current = new (window as any).BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e'],
        });
      } catch {
        setCameraError('Could not initialize barcode detector. Use manual entry below.');
        setShowManual(true);
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          scanningRef.current = true;
          scanLoop();
        }
      } catch (err: any) {
        if (cancelled) return;
        const msg =
          err.name === 'NotAllowedError'
            ? 'Camera access denied. Please allow camera access or use manual entry.'
            : 'Could not access camera. Use manual entry below.';
        setCameraError(msg);
        setShowManual(true);
      }
    };

    const scanLoop = async () => {
      if (!scanningRef.current || !videoRef.current || !detectorRef.current) return;

      try {
        const barcodes = await detectorRef.current.detect(videoRef.current);
        if (barcodes && barcodes.length > 0) {
          const code = barcodes[0].rawValue;
          if (code) {
            stopCamera();
            onScan(code);
            onClose();
            return;
          }
        }
      } catch {
        // Detection errors are normal, keep scanning
      }

      if (scanningRef.current) {
        requestAnimationFrame(scanLoop);
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [isOpen, onScan, onClose, stopCamera]);

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
    video: {
      width: '100%',
      height: '100%',
      objectFit: 'cover' as const,
    },
    scanGuide: {
      position: 'absolute',
      width: '260px',
      height: '160px',
      border: '3px solid rgba(255,255,255,0.6)',
      borderRadius: '12px',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      boxShadow: '0 0 0 9999px rgba(0,0,0,0.4)',
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

      <div style={s.videoArea}>
        <video ref={videoRef} playsInline muted style={s.video} />
        {!cameraError && <div style={s.scanGuide} />}
        {cameraError && !showManual && (
          <div style={{ position: 'absolute', padding: '24px', textAlign: 'center' }}>
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
