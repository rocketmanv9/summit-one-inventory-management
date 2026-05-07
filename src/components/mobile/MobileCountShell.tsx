'use client';

import { useState, useEffect } from 'react';

interface MobileCountShellProps {
  countNumber: string;
  locationName: string;
  expiresAt: string; // ISO timestamp
  itemsCounted: number;
  itemsTotal: number;
  onScanClick: () => void;
  children: React.ReactNode;
}

export function MobileCountShell({
  countNumber,
  locationName,
  expiresAt,
  itemsCounted,
  itemsTotal,
  onScanClick,
  children,
}: MobileCountShellProps) {
  const [timeLeft, setTimeLeft] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);

  useEffect(() => {
    const update = () => {
      const now = Date.now();
      const expires = new Date(expiresAt).getTime();
      const diff = expires - now;

      if (diff <= 0) {
        setTimeLeft('Expired');
        setIsUrgent(true);
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const secs = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setTimeLeft(`${hours}h ${mins}m`);
      } else {
        setTimeLeft(`${mins}:${secs.toString().padStart(2, '0')}`);
      }

      setIsUrgent(diff < 5 * 60 * 1000);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const progress = itemsTotal > 0 ? (itemsCounted / itemsTotal) * 100 : 0;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-sm font-bold">{countNumber}</div>
            <div className="text-xs text-gray-500">{locationName}</div>
          </div>
          <div className={`text-sm font-mono font-medium px-2 py-1 rounded ${
            isUrgent ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'
          }`}>
            {timeLeft}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-2">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>{itemsCounted} / {itemsTotal} items counted</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>

      {/* Scan button */}
      <div className="sticky bottom-0 bg-white border-t p-4 safe-area-bottom">
        <button
          onClick={onScanClick}
          className="w-full py-4 bg-blue-600 text-white rounded-xl font-medium text-lg flex items-center justify-center gap-2 active:bg-blue-700"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
          Scan Barcode
        </button>
      </div>
    </div>
  );
}
