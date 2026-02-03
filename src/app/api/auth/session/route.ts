import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

function decodeJwtExp(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (payload?.exp) {
      return payload.exp * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const auth = await createAuthenticatedClientOrThrow(request);
    if (auth instanceof NextResponse) return auth;

    const { context, client } = auth;
    const authHeader = request.headers.get('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const expiresAt = decodeJwtExp(token);

    const { data: { user } } = await client.auth.getUser(token || undefined);

    return NextResponse.json({
      userId: context.userId,
      email: context.email || user?.email || null,
      tenantId: context.tenantId,
      role: context.role,
      fullName: user?.user_metadata?.full_name || null,
      expiresAt
    });
  } catch (error) {
    console.error('Session check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  return NextResponse.json({ success: true });
}

