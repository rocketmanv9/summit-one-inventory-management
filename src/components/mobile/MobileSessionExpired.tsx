'use client';

import type { CSSProperties } from 'react';

interface MobileSessionExpiredProps {
  message?: string;
}

export function MobileSessionExpired({ message }: MobileSessionExpiredProps) {
  const s: Record<string, CSSProperties> = {
    wrapper: {
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f9fafb',
      padding: '24px',
    },
    card: {
      maxWidth: '384px',
      width: '100%',
      textAlign: 'center',
    },
    iconCircle: {
      width: '64px',
      height: '64px',
      margin: '0 auto',
      background: '#fee2e2',
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      fontSize: '20px',
      fontWeight: 600,
      color: '#111827',
      marginTop: '16px',
      marginBottom: '8px',
    },
    message: {
      color: '#4b5563',
      fontSize: '14px',
      lineHeight: 1.5,
      margin: 0,
    },
    hint: {
      paddingTop: '16px',
      fontSize: '12px',
      color: '#6b7280',
      margin: 0,
    },
  };

  return (
    <div style={s.wrapper}>
      <div style={s.card}>
        <div style={s.iconCircle}>
          <svg width="32" height="32" fill="none" stroke="#dc2626" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h1 style={s.title}>Session Expired</h1>
        <p style={s.message}>
          {message || 'This mobile counting session has expired or been revoked.'}
        </p>
        <p style={s.hint}>
          Scan a new QR code from the desktop to start a new session.
        </p>
      </div>
    </div>
  );
}
