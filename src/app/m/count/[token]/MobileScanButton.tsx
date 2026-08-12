'use client';

import { useState, useCallback } from 'react';
import { BarcodeScannerOverlay } from '@/components/mobile/BarcodeScannerOverlay';
import { scanLookup, scanRecord } from './actions';

export function MobileScanButton({ token }: { token: string }) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handleScan = useCallback(async (decodedText: string) => {
    const result = await scanLookup(token, decodedText);
    if (result.error) {
      setFeedback(result.error);
      setTimeout(() => setFeedback(null), 2000);
      return;
    }

    const newQty = Number(result.currentQty ?? 0) + 1;
    const recordResult = await scanRecord(token, result.catalogItemId!, newQty);
    if (recordResult.error) {
      setFeedback(`Error: ${recordResult.error}`);
    } else {
      setFeedback(`${result.itemName} → ${newQty}`);
    }
    setTimeout(() => setFeedback(null), 2000);
  }, [token]);

  const handleClose = useCallback(() => {
    setOpen(false);
    setFeedback(null);
    // Reload the server-rendered page to show updated counts
    window.location.reload();
  }, []);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          width: '100%',
          padding: '16px 20px',
          background: '#2563eb',
          color: '#fff',
          borderRadius: '14px',
          fontWeight: 700,
          fontSize: '16px',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '10px',
          boxShadow: '0 4px 14px rgba(37,99,235,0.3)',
          letterSpacing: '-0.01em',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
        </svg>
        Open Scanner
      </button>

      <BarcodeScannerOverlay
        isOpen={open}
        onClose={handleClose}
        onScan={handleScan}
        continuous
        scanFeedback={feedback}
      />
    </>
  );
}
