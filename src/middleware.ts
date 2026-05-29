import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const response = NextResponse.next({ request });

  // Mobile count pages: set deployment-protection bypass cookie as a response
  // header so it's available BEFORE the browser preloads JS chunks.
  // The inline <script> in page.tsx fires too late — <link rel="preload"> in
  // <head> triggers chunk fetches before the script runs, so Vercel blocks
  // them and React never hydrates.
  if (request.nextUrl.pathname.startsWith('/m/count/')) {
    const bypass =
      request.nextUrl.searchParams.get('x-vercel-protection-bypass') ||
      process.env.VERCEL_AUTOMATION_BYPASS_SECRET ||
      '';
    if (bypass) {
      response.cookies.set('x-vercel-protection-bypass', bypass, {
        path: '/',
        secure: true,
        sameSite: 'lax',
        maxAge: 86400,
      });
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|debug|api/system/debug|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json)$).*)',
  ],
};
