import { NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';

export async function GET() {
  const supabase = createClient();

  const { data, error, count } = await supabase
    .from('event_definitions')
    .select('*', { count: 'exact' });

  return NextResponse.json({
    count,
    total: data?.length,
    error: error ? String(error) : null,
    first_five: data?.slice(0, 5),
    event_names: data?.map(d => d.event_name).sort()
  });
}
