import { getAdminClient } from '@/utils/supabase/admin';
import { MobileCountClient } from './MobileCountClient';

export const dynamic = 'force-dynamic';

// ── Minimal session check (server-side, no JS needed for error display) ──

async function checkSession(token: string) {
  const admin = getAdminClient();
  const inv = (admin as any).schema('inventory');

  const { data: session, error: sessionError } = await inv
    .from('mobile_count_sessions')
    .select('id, tenant_id, cycle_count_id, created_by_user_id, expires_at, revoked_at')
    .eq('token', token)
    .single();

  if (sessionError || !session) return { error: 'Invalid session link. Please generate a new QR code.' };
  if (session.revoked_at) return { error: 'This session has been revoked.' };
  if (new Date(session.expires_at) < new Date()) return { error: 'This session has expired. Please generate a new one.' };

  return { ok: true };
}

// ── Page ──

export default async function MobileCountPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const sp = await searchParams;
  const bypass = (sp['x-vercel-protection-bypass'] as string) || process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';

  const result = await checkSession(token);

  if ('error' in result) {
    return <ErrorPage message={result.error as string} />;
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#f3f4f6' }}>
      {/* Set bypass cookie so JS chunks load through deployment protection */}
      {bypass && (
        <script dangerouslySetInnerHTML={{ __html: `document.cookie="x-vercel-protection-bypass=${bypass};path=/;secure;samesite=lax;max-age=86400";` }} />
      )}
      <MobileCountClient bypassSecret={bypass} />
    </div>
  );
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
        <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '16px' }}>Scan a new QR code from the desktop to start a new session.</p>
      </div>
    </div>
  );
}
