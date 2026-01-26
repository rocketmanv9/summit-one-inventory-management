'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);
  
  useEffect(() => {
    // Check if already logged in
    fetch('/api/auth/session-check')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) {
          router.push('/dashboard');
        } else {
          setCheckingSession(false);
        }
      })
      .catch(() => setCheckingSession(false));
  }, [router]);

  const handleSSOLogin = () => {
    const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
    window.location.href = `${coreUrl}/apps/inventory`;
  };

  const handleDevLogin = async () => {
    try {
      const response = await fetch('/api/auth/dev-login', { method: 'POST' });
      if (response.ok) {
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Dev login failed:', error);
    }
  };
  
  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Checking session...</p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow-md">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Inventory Management
          </h1>
          <p className="text-gray-600">
            Choose how to sign in
          </p>
        </div>
        
        <div className="space-y-4">
          <button
            onClick={handleSSOLogin}
            className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Sign in with Core SSO
          </button>
          
          {process.env.NODE_ENV === 'development' && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-300"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 bg-white text-gray-500">Dev Only</span>
                </div>
              </div>
              
              <button
                onClick={handleDevLogin}
                className="w-full flex items-center justify-center px-4 py-3 border border-gray-300 text-base font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Quick Dev Login (Grant)
              </button>
            </>
          )}
        </div>
        
        <div className="text-center">
          <p className="text-sm text-gray-500">
            Local development: {process.env.NODE_ENV}
          </p>
        </div>
      </div>
    </div>
  );
}
