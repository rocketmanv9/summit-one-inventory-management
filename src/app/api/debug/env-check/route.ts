import { NextResponse } from 'next/server';

export async function GET() {
  console.log('--- ENV CHECK ---');
  console.log('URL:', process.env.NEXT_PUBLIC_SUPABASE_URL);
  console.log(
    'ANON (Start):',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.substring(0, 5)
  );
  console.log(
    'JWT SECRET (Start):',
    process.env.SUPABASE_JWT_SECRET?.substring(0, 5)
  );
  console.log('--- IF THESE DO NOT MATCH YOUR SUPABASE DASHBOARD, AUTH WILL FAIL ---');

  return NextResponse.json({ status: 'Check server console' });
}
