import type { Metadata } from 'next';
import { loadReceivingSession, mintReceiveJwt, fetchOpenPos } from '@/app/api/m/receive/_lib/receive-session';
import { MobileReceiveClient } from './MobileReceiveClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Mobile Receiving - Summit One',
  description: 'Mobile PO receiving interface',
};

// ── Server-side data loader (validates session + fetches the open PO list) ──

async function loadReceiveData(token: string) {
  const result = await loadReceivingSession(token);
  if ('error' in result) return { error: result.error };
  const session = result.session;

  const [jwt, pos] = await Promise.all([
    mintReceiveJwt({
      sessionId: session.id,
      tenantId: session.tenant_id,
      userId: session.created_by_user_id,
    }),
    fetchOpenPos(session.tenant_id),
  ]);

  return {
    initialData: {
      jwt,
      expires_at: session.expires_at,
      pos,
    },
  };
}

// ── Page ──

export default async function MobileReceivePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  // Used by MobileReceiveClient to bypass deployment protection on its API
  // fetches. The static JS chunks are bypassed separately via Vercel's own
  // cookie, set when the page URL carries x-vercel-set-bypass-cookie=true
  // (see the URL built in the receiving mobile-session route).
  const bypass = (sp['x-vercel-protection-bypass'] as string) || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

  const result = await loadReceiveData(token);

  if ('error' in result) {
    return <ErrorPage message={result.error as string} />;
  }

  return <MobileReceiveClient bypassSecret={bypass} initialData={result.initialData} />;
}

function ErrorPage({ message }: { message: string }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#f9fafb', padding: '24px',
    }}>
      <div style={{ maxWidth: '384px', width: '100%', textAlign: 'center' }}>
        <div style={{
          width: '64px', height: '64px', margin: '0 auto', background: '#fee2e2',
          borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="32" height="32" fill="none" stroke="#dc2626" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </div>
        <h1 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', marginTop: '16px' }}>Session Error</h1>
        <p style={{ color: '#4b5563', fontSize: '14px', lineHeight: 1.5 }}>{message}</p>
        <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '16px' }}>Generate a new receiving QR from Purchasing on desktop, then scan it again.</p>
      </div>
    </div>
  );
}
