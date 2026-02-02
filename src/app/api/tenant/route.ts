/**
 * GET /api/tenant - Get current tenant information
 * SECURITY: Uses JWT + RLS for tenant isolation
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedClientOrThrow, createVerifiedServiceClient } from '@/lib/secure-server-client';

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedClientOrThrow(request);
  if (auth instanceof NextResponse) return auth;

  const { client: supabase, context } = auth;
  
  try {
    // Fetch tenant using tenant_id from JWT (RLS enforces automatically)
    let { data: tenant, error } = await supabase
      .schema('public')
      .from('tenants')
      .select('*')
      .eq('id', context.tenantId)
      .single();
    
    // Auto-provision tenant on first access if not found
    if (error && error.code === 'PGRST116') {
      console.log(`Auto-provisioning tenant: ${context.tenantId}`);
      
      // Use service role to bypass RLS for tenant creation (bootstrapping operation)
      const { client: serviceClient } = createVerifiedServiceClient(context.tenantId);
      
      // Create tenant record with default values
      const { data: newTenant, error: createError } = await serviceClient
        .schema('public')
        .from('tenants')
        .insert({
          id: context.tenantId,
          name: `Tenant ${context.tenantId.substring(0, 8)}`, // Default name, can be updated later
          slug: `tenant-${context.tenantId.substring(0, 8)}`,
          industry: 'general',
          metadata: {}
        })
        .select()
        .single();
      
      if (createError) {
        // If duplicate key error, tenant was created by another request (race condition)
        // Use service role client to read it (since it was just created by service role)
        if (createError.code === '23505') {
          console.log(`Tenant already exists (race condition), reading via service role...`);
          const { data: existingTenant, error: readError } = await serviceClient
            .schema('public')
            .from('tenants')
            .select('*')
            .eq('id', context.tenantId)
            .single();
          
          if (readError) {
            console.error('Error reading existing tenant after insert conflict:', readError);
            return NextResponse.json(
              { error: 'Failed to fetch tenant', details: readError.message },
              { status: 500 }
            );
          }
          
          tenant = existingTenant;
        } else {
          console.error('Error auto-provisioning tenant:', createError);
          return NextResponse.json(
            { error: 'Failed to provision tenant', details: createError.message },
            { status: 500 }
          );
        }
      } else {
        tenant = newTenant;
        console.log(`✓ Auto-provisioned tenant: ${context.tenantId}`);
      }
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
