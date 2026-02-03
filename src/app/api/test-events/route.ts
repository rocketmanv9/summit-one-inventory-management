import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedClientOrThrow(request);
  if (auth instanceof NextResponse) return auth;

  const { client: supabase } = auth;

  const { data, error, count } = await supabase
    .from('event_definitions')
    .select('*', { count: 'exact' });

  return NextResponse.json({
    count,
    total: data?.length,
    error: error ? String(error) : null,
    first_five: data?.slice(0, 5),
    event_names: data?.map((d: any) => d.event_name).sort()
  });
}

