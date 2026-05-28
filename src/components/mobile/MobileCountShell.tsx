'use client';

import { useState, useEffect, type CSSProperties } from 'react';

interface MobileCountShellProps {
  countNumber: string;
  locationName: string;
  expiresAt: string;
  itemsCounted: number;
  itemsTotal: number;
  isSubmitted: boolean;
  isSubmitting: boolean;
  countType?: string;
  onScanClick: () => void;
  onSubmitClick: () => void;
  /** Rendered between header and scrollable content — outside the scroll container */
  toolbar?: React.ReactNode;
  children: React.ReactNode;
}

export function MobileCountShell({
  countNumber,
  locationName,
  expiresAt,
  itemsCounted,
  itemsTotal,
  isSubmitted,
  isSubmitting,
  countType,
  onScanClick,
  onSubmitClick,
  toolbar,
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

  const s: Record<string, CSSProperties> = {
    wrapper: {
      minHeight: '100dvh',
      background: '#f3f4f6',
      display: 'flex',
      flexDirection: 'column',
    },
    header: {
      background: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
      position: 'sticky',
      top: 0,
      zIndex: 10,
      paddingTop: 'env(safe-area-inset-top, 0px)',
    },
    headerInner: {
      padding: '16px 20px',
    },
    headerRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    title: {
      fontSize: '18px',
      fontWeight: 700,
      color: '#111827',
      margin: 0,
      letterSpacing: '-0.01em',
    },
    locationRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      marginTop: '2px',
    },
    locationText: {
      fontSize: '14px',
      color: '#6b7280',
    },
    timerBadge: {
      fontSize: '13px',
      fontFamily: 'ui-monospace, monospace',
      fontWeight: 600,
      padding: '6px 12px',
      borderRadius: '9999px',
      background: isUrgent ? '#fee2e2' : '#f3f4f6',
      color: isUrgent ? '#b91c1c' : '#4b5563',
    },
    progressSection: {
      marginTop: '16px',
    },
    progressRow: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '6px',
    },
    progressLabel: {
      fontSize: '12px',
      fontWeight: 500,
      color: '#374151',
    },
    progressPercent: {
      fontSize: '12px',
      fontWeight: 600,
      color: allDone ? '#16a34a' : '#2563eb',
    },
    progressTrack: {
      width: '100%',
      background: '#e5e7eb',
      borderRadius: '9999px',
      height: '10px',
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      borderRadius: '9999px',
      background: allDone ? '#22c55e' : '#2563eb',
      width: `${progress}%`,
      transition: 'width 0.5s ease-out',
    },
    content: {
      flex: 1,
      overflowY: 'auto' as const,
    },
    footer: {
      position: 'sticky' as const,
      bottom: 0,
      background: 'rgba(255,255,255,0.95)',
      backdropFilter: 'blur(8px)',
      WebkitBackdropFilter: 'blur(8px)',
      borderTop: '1px solid #e5e7eb',
      padding: '12px 20px',
      paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 12px)',
      display: 'flex',
      gap: '10px',
    },
    scanButton: {
      flex: 1,
      padding: '14px',
      background: '#2563eb',
      color: '#fff',
      borderRadius: '14px',
      fontWeight: 600,
      fontSize: '15px',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(37,99,235,0.25)',
      WebkitTapHighlightColor: 'transparent',
    },
    submitButton: {
      flex: 1,
      padding: '14px',
      background: isSubmitting ? '#9ca3af' : '#16a34a',
      color: '#fff',
      borderRadius: '14px',
      fontWeight: 600,
      fontSize: '15px',
      border: 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '8px',
      cursor: isSubmitting ? 'default' : 'pointer',
      boxShadow: isSubmitting ? 'none' : '0 4px 14px rgba(22,163,74,0.25)',
      WebkitTapHighlightColor: 'transparent',
    },
    submittedBanner: {
      padding: '20px',
      textAlign: 'center',
      background: '#f0fdf4',
      borderTop: '1px solid #bbf7d0',
    },
  };

  return (
    <div style={s.wrapper}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerInner}>
          <div style={s.headerRow}>
            <div>
              <h1 style={s.title}>{countNumber}</h1>
              <div style={s.locationRow}>
                <svg width="14" height="14" fill="none" stroke="#9ca3af" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span style={s.locationText}>{locationName}</span>
              </div>
            </div>
            <div style={s.timerBadge}>{timeLeft}</div>
          </div>

          {/* Progress */}
          <div style={s.progressSection}>
            {countType === 'initial' ? (
              <div style={s.progressRow}>
                <span style={s.progressLabel}>{itemsCounted} items counted</span>
              </div>
            ) : (
              <>
                <div style={s.progressRow}>
                  <span style={s.progressLabel}>{itemsCounted} of {itemsTotal} counted</span>
                  <span style={s.progressPercent}>{Math.round(progress)}%</span>
                </div>
                <div style={s.progressTrack}>
                  <div style={s.progressFill} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Toolbar (outside scroll container so buttons respond to touch) */}
      {toolbar}

      {/* Content */}
      <div style={s.content}>
        {children}
      </div>

      {/* Footer */}
      {isSubmitted ? (
        <div style={s.submittedBanner}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
            <svg width="20" height="20" fill="none" stroke="#16a34a" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
            <span style={{ fontWeight: 600, fontSize: '16px', color: '#15803d' }}>
              Submitted for Review
            </span>
          </div>
          <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px', marginBottom: 0 }}>
            You can close this page. Review happens on desktop.
          </p>
        </div>
      ) : (
        <div style={s.footer}>
          <button className="m-btn" onClick={onScanClick} style={s.scanButton}>
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
            Scan
          </button>
          <button
            className="m-btn"
            onClick={onSubmitClick}
            disabled={isSubmitting}
            style={s.submitButton}
          >
            {isSubmitting ? (
              <>
                <div style={{
                  width: '18px', height: '18px',
                  border: '2.5px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
                  borderRadius: '50%', animation: 'm-spin 1s linear infinite',
                }} />
                Submitting...
              </>
            ) : (
              <>
                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Submit
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
