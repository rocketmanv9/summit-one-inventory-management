import { NextResponse } from 'next/server';
import { clearAuth } from '@/lib/auth';

export async function POST() {
  try {
    await clearAuth();
    
    // Redirect to Core login page
    const coreUrl = process.env.NEXT_PUBLIC_CORE_APP_URL || 'https://dev.summit-one.app';
    
    return NextResponse.json({ 
      success: true, 
      redirectUrl: coreUrl 
    });
    
  } catch (error) {
    console.error('[Logout] Error:', error);
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    await clearAuth();
    
    // Redirect to Core login page
    const coreUrl = process.env.NEXT_PUBLIC_CORE_APP_URL || 'https://dev.summit-one.app';
    
    return NextResponse.redirect(coreUrl);
    
  } catch (error) {
    console.error('[Logout] Error:', error);
    return NextResponse.redirect(new URL('/error?msg=logout_failed', process.env.NEXT_PUBLIC_SERVICE_BASE_URL || 'http://localhost:3000'));
  }
}
