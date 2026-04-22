import { NextResponse, type NextRequest } from 'next/server';
import { assertChassisSchemaVersion } from '@rocketmanv9/chassis/config';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';

// One-time schema version check on first request
let schemaChecked = false;

export async function middleware(request: NextRequest) {
  // Verify chassis DB migrations are applied (runs once per cold start)
  if (!schemaChecked) {
    try {
      const supabaseAdmin = await createTenantServiceClient({
        url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        tenantId: '__system__',
      });
      await assertChassisSchemaVersion(supabaseAdmin);
      schemaChecked = true;
    } catch (err) {
      console.error('[chassis] Schema version check failed:', err);
      // Don't block requests — log and continue, check again next request
    }
  }

  return NextResponse.next({ request });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|debug|api/system/debug|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|json)$).*)',
  ],
};
