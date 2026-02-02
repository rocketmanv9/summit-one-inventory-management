/**
 * SSO AuthGate Page
 * Handles ticket-based SSO redirect from Core
 * 
 * Flow:
 * 1. Core redirects to: /auth-gate?ticket=<64hex>&target_service=inventory&target_org=<tenant>
 * 2. This page extracts ticket and calls sso-callback
 * 3. Session is established and user redirected to dashboard
 */

'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthGatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(true);

  useEffect(() => {
    const processSSO = async () => {
      try {
        const ticket = searchParams.get('ticket');
        const targetService = searchParams.get('target_service') || 'dashboard';
        const targetOrg = searchParams.get('target_org');

        // Validate required parameters
        if (!ticket) {
          setError('No SSO ticket provided. Please log in through the main portal.');
          setIsProcessing(false);
          return;
        }

        // Validate ticket format (should be 64-char hex)
        if (!/^[a-f0-9]{64}$/i.test(ticket)) {
          setError('Invalid ticket format. Please try logging in again.');
          setIsProcessing(false);
          return;
        }

        console.log('[AuthGate] Processing SSO:', { 
          ticket: ticket.substring(0, 8) + '...', 
          targetService, 
          targetOrg 
        });

        // Call sso-callback endpoint with ticket parameter
        const callbackUrl = new URL('/api/auth/sso-callback', window.location.origin);
        callbackUrl.searchParams.set('ticket', ticket);
        if (targetOrg) {
          callbackUrl.searchParams.set('target_org', targetOrg);
        }

        const response = await fetch(callbackUrl.toString(), {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          setError(
            data.error || `Validation failed (${response.status}). Please try logging in again.`
          );
          setIsProcessing(false);
          return;
        }

        const data = await response.json();
        console.log('[AuthGate] SSO successful, redirecting to', targetService);

        // Redirect to target page
        router.push(`/${targetService}`);
      } catch (err) {
        console.error('[AuthGate] SSO error:', err);
        setError(
          err instanceof Error 
            ? `Login error: ${err.message}`
            : 'An error occurred during login. Please try again.'
        );
        setIsProcessing(false);
      }
    };

    processSSO();
  }, [searchParams, router]);

  // Error state
  if (error) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        backgroundColor: '#f5f5f5'
      }}>
        <div style={{
          backgroundColor: 'white',
          padding: '40px',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          maxWidth: '500px',
          textAlign: 'center'
        }}>
          <h1 style={{ color: '#d32f2f', marginTop: 0 }}>Login Error</h1>
          <p style={{ color: '#666', fontSize: '16px' }}>{error}</p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              marginTop: '20px',
              padding: '10px 20px',
              backgroundColor: '#1976d2',
              color: 'white',
              textDecoration: 'none',
              borderRadius: '4px',
              fontSize: '14px'
            }}
          >
            Return to Home
          </a>
        </div>
      </div>
    );
  }

  // Loading state
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      backgroundColor: '#f5f5f5'
    }}>
      <div style={{
        backgroundColor: 'white',
        padding: '40px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        maxWidth: '400px',
        textAlign: 'center'
      }}>
        <h1 style={{ marginTop: 0 }}>Processing Login</h1>
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          gap: '4px',
          height: '30px'
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#1976d2',
            animation: 'bounce 1.4s infinite'
          }} />
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#1976d2',
            animation: 'bounce 1.4s infinite 0.2s'
          }} />
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#1976d2',
            animation: 'bounce 1.4s infinite 0.4s'
          }} />
        </div>
        <p style={{ color: '#666', marginTop: '20px', fontSize: '14px' }}>
          Validating your credentials...
        </p>
      </div>
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% {
            opacity: 0.3;
            transform: translateY(0);
          }
          40% {
            opacity: 1;
            transform: translateY(-10px);
          }
        }
      `}</style>
    </div>
  );
}
