'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { scanLookup, scanRecord } from '../actions';

/**
 * Dedicated mobile scan page — uses native getUserMedia + BarcodeDetector.
 * No external libraries needed. Works on iOS Safari 17.2+ and Chrome 88+.
 * Falls back to manual entry if BarcodeDetector is unavailable.
 */
export default function MobileScanPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const bypass = searchParams.get('x-vercel-protection-bypass') || '';

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectingRef = useRef(false);
  const cooldownRef = useRef(false);

  const [status, setStatus] = useState<'loading' | 'scanning' | 'no-detector' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [manualCode, setManualCode] = useState('');

  // Set bypass cookie on load
  useEffect(() => {
    if (bypass) {
      document.cookie = `x-vercel-protection-bypass=${bypass};path=/;secure;samesite=lax;max-age=86400`;
    }
  }, [bypass]);

  const showFeedback = useCallback((text: string, isError: boolean) => {
    setFeedback({ text, isError });
    setTimeout(() => setFeedback(null), 2500);
  }, []);

  const handleDetectedCode = useCallback(async (code: string) => {
    if (cooldownRef.current) return;
    cooldownRef.current = true;

    // Extract code from URL if QR
    let lookupCode = code;
    try {
      const url = new URL(code);
      const codeParam = url.searchParams.get('code');
      if (codeParam) lookupCode = codeParam;
    } catch {
      // Not a URL, use as-is
    }

    const result = await scanLookup(token, lookupCode);
    if (result.error) {
      showFeedback(result.error, true);
      setTimeout(() => { cooldownRef.current = false; }, 2000);
      return;
    }

    const newQty = (result.currentQty ?? 0) + 1;
    const recordResult = await scanRecord(token, result.catalogItemId!, newQty);
    if (recordResult.error) {
      showFeedback(`Error: ${recordResult.error}`, true);
    } else {
      showFeedback(`${result.itemName} → ${newQty}`, false);
      setScanCount((c) => c + 1);
    }
    setTimeout(() => { cooldownRef.current = false; }, 2000);
  }, [token, showFeedback]);

  // Start camera + barcode detection
  useEffect(() => {
    let cancelled = false;
    let animFrameId: number;

    async function start() {
      // 1. Get camera
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } catch (err: any) {
        if (cancelled) return;
        const msg = err?.name === 'NotAllowedError'
          ? 'Camera access denied. Please allow camera access in your browser settings.'
          : `Camera error: ${err?.message || 'unknown'}`;
        setErrorMsg(msg);
        setStatus('error');
        return;
      }

      // 2. Check for BarcodeDetector
      if (!('BarcodeDetector' in window)) {
        if (!cancelled) setStatus('no-detector');
        return;
      }

      // 3. Start detection loop
      try {
        const detector = new (window as any).BarcodeDetector({
          formats: ['qr_code', 'ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'data_matrix'],
        });

        if (!cancelled) setStatus('scanning');

        const detect = async () => {
          if (cancelled || !videoRef.current || videoRef.current.readyState < 2) {
            if (!cancelled) animFrameId = requestAnimationFrame(detect);
            return;
          }
          if (!detectingRef.current && !cooldownRef.current) {
            detectingRef.current = true;
            try {
              const barcodes = await detector.detect(videoRef.current);
              if (barcodes.length > 0 && !cooldownRef.current) {
                handleDetectedCode(barcodes[0].rawValue);
              }
            } catch {
              // detect() can throw if video frame not ready
            }
            detectingRef.current = false;
          }
          if (!cancelled) animFrameId = requestAnimationFrame(detect);
        };

        animFrameId = requestAnimationFrame(detect);
      } catch {
        if (!cancelled) setStatus('no-detector');
      }
    }

    start();

    return () => {
      cancelled = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [handleDetectedCode]);

  const goBack = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    const countUrl = `/m/count/${token}${bypass ? `?x-vercel-protection-bypass=${bypass}` : ''}`;
    window.location.href = countUrl;
  };

  const handleManualSubmit = () => {
    const code = manualCode.trim();
    if (!code) return;
    setManualCode('');
    handleDetectedCode(code);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: '#000', display: 'flex', flexDirection: 'column',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px', paddingTop: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        zIndex: 10, position: 'relative',
      }}>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: '17px' }}>
          Scan Items {scanCount > 0 && `(${scanCount})`}
        </span>
        <button
          onClick={goBack}
          style={{
            width: '40px', height: '40px', background: 'rgba(255,255,255,0.2)',
            borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: 'none', cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}
        >
          <svg width="24" height="24" fill="none" stroke="#fff" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Feedback toast */}
      {feedback && (
        <div style={{
          padding: '12px 20px',
          background: feedback.isError ? 'rgba(220, 38, 38, 0.95)' : 'rgba(22, 163, 74, 0.95)',
          color: '#fff', textAlign: 'center', fontSize: '15px', fontWeight: 600, zIndex: 20,
        }}>
          {feedback.text}
        </div>
      )}

      {/* Camera view */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative' }}>
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            display: status === 'error' ? 'none' : 'block',
          }}
        />

        {/* Scan guide overlay */}
        {status === 'scanning' && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '260px', height: '160px',
            border: '2px solid rgba(255,255,255,0.6)',
            borderRadius: '12px',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.3)',
          }} />
        )}

        {/* Loading state */}
        {status === 'loading' && (
          <div style={{ position: 'absolute', color: 'rgba(255,255,255,0.7)', fontSize: '15px', textAlign: 'center', padding: '24px' }}>
            Starting camera...
          </div>
        )}

        {/* Error state */}
        {status === 'error' && (
          <div style={{ position: 'absolute', color: '#fca5a5', fontSize: '15px', textAlign: 'center', padding: '24px' }}>
            {errorMsg}
          </div>
        )}

        {/* No detector - camera works but can't auto-detect */}
        {status === 'no-detector' && (
          <div style={{
            position: 'absolute', bottom: '16px', left: '16px', right: '16px',
            background: 'rgba(0,0,0,0.7)', borderRadius: '10px', padding: '12px',
            color: 'rgba(255,255,255,0.8)', fontSize: '13px', textAlign: 'center',
          }}>
            Auto-detect not supported. Use manual entry below.
          </div>
        )}
      </div>

      {/* Bottom area — manual entry + close */}
      <div style={{
        padding: '16px 20px',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
        background: 'rgba(0,0,0,0.85)',
      }}>
        {status === 'scanning' && (
          <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: '13px', textAlign: 'center', margin: '0 0 12px 0' }}>
            Point at a barcode or QR code
          </p>
        )}

        {/* Manual entry - always visible */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            inputMode="text"
            placeholder="Type barcode, SKU, or asset tag..."
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleManualSubmit(); }}
            style={{
              flex: 1, padding: '12px 16px', fontSize: '16px', borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.15)',
              color: '#fff', WebkitAppearance: 'none', appearance: 'none' as any, outline: 'none',
            }}
          />
          <button
            onClick={handleManualSubmit}
            disabled={!manualCode.trim()}
            style={{
              padding: '12px 20px', background: '#2563eb', color: '#fff', borderRadius: '10px',
              fontWeight: 600, fontSize: '14px', border: 'none', cursor: 'pointer',
              whiteSpace: 'nowrap', opacity: manualCode.trim() ? 1 : 0.5,
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Go
          </button>
        </div>

        <button
          onClick={goBack}
          style={{
            width: '100%', marginTop: '12px', padding: '12px', background: 'none',
            color: 'rgba(255,255,255,0.6)', fontSize: '14px', border: 'none',
            cursor: 'pointer', textDecoration: 'underline',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          Back to count
        </button>
      </div>
    </div>
  );
}
