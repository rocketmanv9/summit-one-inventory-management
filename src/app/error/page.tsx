'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

const errorMessages: Record<string, string> = {
  no_token: 'No authentication token provided',
  invalid_token: 'Invalid or expired authentication token',
  session_expired: 'Your session has expired',
  no_ticket: 'No authentication ticket provided',
  invalid_ticket: 'Invalid or expired authentication ticket',
  not_authenticated: 'You are not authenticated. Please login from Summit One.',
  'Exchange failed: 401': 'Authentication ticket has expired or is invalid',
  'Exchange failed: 404 (function not deployed)': 'Authentication service is missing the exchange function. Contact the Core team.',
  'Exchange failed: 403': 'Access denied. Please check your permissions.',
  'Exchange failed: 500': 'Authentication service error. Please try again.',
  'Missing Core configuration': 'Service configuration error. Please contact support.',
  'Invalid response from Core': 'Authentication service error. Please try again.',
};

function ErrorContent() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState<string>('');
  
  useEffect(() => {
    const messageParam = searchParams.get('msg') || searchParams.get('message') || 'invalid_token';
    // If the message is not a known code, use it directly
    setMessage(errorMessages[messageParam] || decodeURIComponent(messageParam));
  }, [searchParams]);
  
  const handleReturnToCore = () => {
    const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
    window.location.href = `${coreUrl}/dashboard`;
  };
  
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8">
        <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 rounded-full mb-4">
          <svg
            className="w-6 h-6 text-red-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
          Authentication Error
        </h1>
        
        <p className="text-gray-600 text-center mb-6">
          {message}
        </p>
        
        <button
          onClick={handleReturnToCore}
          className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
        >
          Return to Dashboard
        </button>
        
        <p className="mt-4 text-sm text-gray-500 text-center">
          You will be redirected to the Summit One dashboard
        </p>
      </div>
    </div>
  );
}

export default function ErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading...</div>
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}
