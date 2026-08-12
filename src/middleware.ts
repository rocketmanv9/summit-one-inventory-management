import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Note: mobile count pages (/m/count/*) bypass Vercel deployment protection
  // via Vercel's own bypass cookie — set at the edge when the QR URL carries
  // x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true. A
  // manually-set cookie named x-vercel-protection-bypass is NOT read by Vercel's
  // edge, so we don't try to set one here.
  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|debug|api/system/debug|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json)$).*)',
  ],
};
