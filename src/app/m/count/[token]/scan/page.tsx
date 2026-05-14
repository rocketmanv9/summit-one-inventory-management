'use client';

import { useState, useCallback, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { BarcodeScannerOverlay } from '@/components/mobile/BarcodeScannerOverlay';
import { scanLookup, scanRecord } from '../actions';

export default function MobileScanPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const token = params.token as string;
  const bypass = searchParams.get('x-vercel-protection-bypass') || '';

  const [feedback, setFeedback] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);

  // Set bypass cookie on load
  useEffect(() => {
    if (bypass) {
      document.cookie = `x-vercel-protection-bypass=${bypass};path=/;secure;samesite=lax;max-age=86400`;
    }
  }, [bypass]);

  const handleScan = useCallback(async (decodedText: string) => {
    const result = await scanLookup(token, decodedText);
    if (result.error) {
      setFeedback(result.error);
      setTimeout(() => setFeedback(null), 2000);
      return;
    }

    const newQty = (result.currentQty ?? 0) + 1;
    const recordResult = await scanRecord(token, result.catalogItemId!, newQty);
    if (recordResult.error) {
      setFeedback(`Error: ${recordResult.error}`);
    } else {
      setFeedback(`${result.itemName} → ${newQty}`);
      setScanCount((c) => c + 1);
    }
    setTimeout(() => setFeedback(null), 2000);
  }, [token]);

  const handleClose = useCallback(() => {
    // Go back to the count page
    const countUrl = `/m/count/${token}${bypass ? `?x-vercel-protection-bypass=${bypass}` : ''}`;
    window.location.href = countUrl;
  }, [token, bypass]);

  return (
    <div style={{ minHeight: '100dvh', background: '#000' }}>
      {/* Scanner is always open on this page */}
      <BarcodeScannerOverlay
        isOpen={true}
        onClose={handleClose}
        onScan={handleScan}
        continuous
        scanFeedback={feedback}
      />
    </div>
  );
}
