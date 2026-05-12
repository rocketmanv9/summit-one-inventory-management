'use client';

import { useState, useEffect } from 'react';

interface MobileCountShellProps {
  countNumber: string;
  locationName: string;
  expiresAt: string;
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
  const allDone = itemsCounted === itemsTotal && itemsTotal > 0;

  return (
    <div className="min-h-[100dvh] bg-gray-100 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
        <div className="px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900 tracking-tight">{countNumber}</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-sm text-gray-500">{locationName}</span>
              </div>
            </div>
            <div className={`text-sm font-mono font-semibold px-3 py-1.5 rounded-full ${
              isUrgent ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'
            }`}>
              {timeLeft}
            </div>
          </div>

          {/* Progress */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-medium text-gray-700">{itemsCounted} of {itemsTotal} counted</span>
              <span className={`font-semibold ${allDone ? 'text-green-600' : 'text-blue-600'}`}>
                {Math.round(progress)}%
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ease-out ${allDone ? 'bg-green-500' : 'bg-blue-600'}`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>

      {/* Scan button */}
      <div className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-gray-200 px-5 py-4" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 16px)' }}>
        <button
          onClick={onScanClick}
          className="w-full py-4 bg-blue-600 text-white rounded-2xl font-semibold text-base flex items-center justify-center gap-2.5 active:bg-blue-700 active:scale-[0.98] transition-transform shadow-lg shadow-blue-600/25"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
          Scan Barcode
        </button>
      </div>
    </div>
  );
}
