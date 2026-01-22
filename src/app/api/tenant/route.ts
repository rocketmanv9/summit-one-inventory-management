import { NextRequest, NextResponse } from 'next/server';
import { getTenantIdFromHeaders } from '@/lib/db-middleware';
import { createClient } from '@supabase/supabase-js';

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
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
    
    // Try to fetch existing tenant
    let { data: tenant, error } = await supabase
      .schema('public')
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .single();
    
    // Auto-provision tenant on first access if not found
    if (error && error.code === 'PGRST116') {
      console.log(`Auto-provisioning tenant: ${tenantId}`);
      
      // Create tenant record with default values
      const { data: newTenant, error: createError } = await supabase
        .schema('public')
        .from('tenants')
        .insert({
          id: tenantId,
          name: `Tenant ${tenantId.substring(0, 8)}`, // Default name, can be updated later
          slug: `tenant-${tenantId.substring(0, 8)}`,
          industry: 'general',
          metadata: {}
        })
        .select()
        .single();
      
      if (createError) {
        console.error('Error auto-provisioning tenant:', createError);
        return NextResponse.json(
          { error: 'Failed to provision tenant', details: createError.message },
          { status: 500 }
        );
      }
      
      tenant = newTenant;
      console.log(`✓ Auto-provisioned tenant: ${tenantId}`);
    } else if (error) {
      // Other errors (not "not found")
      console.error('Error fetching tenant:', error);
      return NextResponse.json(
        { error: 'Database error', details: error.message },
        { status: 500 }
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
