'use client';

interface MobileSessionExpiredProps {
  message?: string;
}

export function MobileSessionExpired({ message }: MobileSessionExpiredProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-sm w-full text-center space-y-4">
        <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Session Expired</h1>
        <p className="text-gray-600 text-sm">
          {message || 'This mobile counting session has expired or been revoked.'}
        </p>
        <div className="pt-4">
          <p className="text-xs text-gray-500">
            Scan a new QR code from the desktop to start a new session.
          </p>
        </div>
      </div>
    </div>
  );
}
