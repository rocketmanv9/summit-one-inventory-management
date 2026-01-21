import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@/supabase/client';

/**
 * GET /api/tenant - Get current tenant information
 */
export async function GET(request: NextRequest) {
  const tenantId = getTenantIdFromHeaders(request.headers);
  
  if (!tenantId) {
    return NextResponse.json(
      { error: 'Not authenticated' },
      { status: 401 }
    );
  }
  
  try {
    const supabase = createClient();
    
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();
    
    if (error) {
      console.error('Error fetching tenant:', error);
      return NextResponse.json(
        { error: 'Tenant not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ tenant });
  } catch (error) {
    console.error('Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
