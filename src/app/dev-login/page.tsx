'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function DevLoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  async function handleDevLogin() {
    setLoading(true);
    setMessage('');
    
    try {
      const response = await fetch('/api/auth/dev-login', {
        method: 'POST'
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setMessage('✓ Session created! Redirecting...');
        setTimeout(() => {
          router.push('/dashboard');
        }, 1000);
      } else {
        setMessage(`✗ Error: ${data.error}`);
        setLoading(false);
      }
    } catch (error) {
      setMessage(`✗ Error: ${error}`);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-lg shadow">
        <div>
          <h2 className="text-center text-3xl font-bold text-gray-900">
            Development Login
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Local testing only - bypasses SSO
          </p>
        </div>
        
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded p-4 text-sm">
            <p className="font-semibold text-blue-900">Test Credentials:</p>
            <p className="text-blue-800 mt-1">Email: dev@test.com</p>
            <p className="text-blue-800">Role: Admin</p>
            <p className="text-blue-800">Tenant: {process.env.NEXT_PUBLIC_TENANT_ID || 'Default'}</p>
          </div>

          <button
            onClick={handleDevLogin}
            disabled={loading}
            className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating Session...' : 'Create Dev Session'}
          </button>

          {message && (
            <div className={`p-3 rounded text-sm text-center ${
              message.includes('✓') 
                ? 'bg-green-50 text-green-800 border border-green-200' 
                : 'bg-red-50 text-red-800 border border-red-200'
            }`}>
              {message}
            </div>
          )}

          <div className="text-xs text-gray-500 text-center pt-4 border-t">
            <p>Production uses SSO from Summit One Core</p>
            <p className="mt-1">This bypass is only available in development mode</p>
          </div>
        </div>
      </div>
    </div>
  );
}
