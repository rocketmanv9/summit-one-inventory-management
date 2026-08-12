/**
 * Cross-Tenant Security Tests
 * Verifies JWT + RLS prevents unauthorized access to other tenants' data
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';

interface Vendor {
  id: string;
  tenant_id: string;
  name: string;
  code: string;
  active: boolean;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Helper to create test JWT tokens with different tenant IDs
async function createTestUser(tenantId: string, userId: string = `user-${Date.now()}`) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  // Create user with specific tenant in app_metadata
  const { data: user, error } = await supabase.auth.admin.createUser({
    email: `test-${userId}@example.com`,
    password: 'test-password-123',
    email_confirm: true,
    user_metadata: {},
    app_metadata: {
      tenant_id: tenantId,
      role: 'user'
    }
  });
  
  if (error) throw error;
  return user;
}

async function createTestVendor(tenantId: string, name: string) {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  
  const { data, error } = await supabase
    .schema('supply_chain')
    .from('vendors')
    .insert({
      tenant_id: tenantId,
      name,
      code: `TEST-${Date.now()}`,
      active: true
    })
    .select()
    .single();
    
  if (error) throw error;
  return data;
}

async function getJWTForUser(email: string, password: string) {
  const supabase = createClient(
    supabaseUrl,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  
  if (error) throw error;
  return data.session?.access_token;
}

describe('Cross-Tenant Security', () => {
  let tenant1Id: string;
  let tenant2Id: string;
  let user1Email: string;
  let user2Email: string;
  let vendor1Id: string;
  let vendor2Id: string;
  
  beforeAll(async () => {
    // Setup: Create two tenants with users and vendors
    tenant1Id = `tenant-1-${Date.now()}`;
    tenant2Id = `tenant-2-${Date.now()}`;
    
    const user1 = await createTestUser(tenant1Id, 'user1');
    const user2 = await createTestUser(tenant2Id, 'user2');
    
    user1Email = user1.user!.email!;
    user2Email = user2.user!.email!;
    
    const vendor1 = await createTestVendor(tenant1Id, 'Vendor A');
    const vendor2 = await createTestVendor(tenant2Id, 'Vendor B');
    
    vendor1Id = vendor1.id;
    vendor2Id = vendor2.id;
  });
  
  afterAll(async () => {
    // Cleanup: Delete test data
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    await supabase.schema('supply_chain').from('vendors').delete().eq('id', vendor1Id);
    await supabase.schema('supply_chain').from('vendors').delete().eq('id', vendor2Id);
    
    // Note: deleteUser requires user ID, not email
    // Skipping user cleanup for now as it requires user IDs
  });
  
  describe('API Route Security', () => {
    it('should block cross-tenant vendor access via API route', async () => {
      // Get JWT for tenant 1 user
      const jwt1 = await getJWTForUser(user1Email, 'test-password-123');
      
      // Try to access vendors via API route
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/inventory/vendors`, {
        headers: {
          'Authorization': `Bearer ${jwt1}`
        }
      });
      
      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Should only see Vendor A (tenant 1), not Vendor B (tenant 2)
      expect(data.data).toHaveLength(1);
      expect(data.data[0].name).toBe('Vendor A');
      expect(data.data[0].tenant_id).toBe(tenant1Id);
      
      // Should NOT see vendor from other tenant
      const vendor2Included = data.data.some((v: Vendor) => v.id === vendor2Id);
      expect(vendor2Included).toBe(false);
    });
    
    it('should reject requests with tampered JWT', async () => {
      // Get valid JWT
      const validJWT = await getJWTForUser(user1Email, 'test-password-123');
      
      // Tamper with JWT (this will invalidate the signature)
      const tamperedJWT = validJWT!.replace(tenant1Id, tenant2Id);
      
      // Try to access API with tampered JWT
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/inventory/vendors`, {
        headers: {
          'Authorization': `Bearer ${tamperedJWT}`
        }
      });
      
      // Should be rejected (401 Unauthorized)
      expect(response.status).toBe(401);
    });
    
    it('should reject requests without JWT', async () => {
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/inventory/vendors`);
      
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain('Unauthorized');
    });
  });
  
  describe('Direct Database RLS', () => {
    it('should enforce RLS when using JWT-authenticated client', async () => {
      // Get JWT for tenant 1
      const jwt1 = await getJWTForUser(user1Email, 'test-password-123');
      
      // Create Supabase client with JWT
      const supabase = createClient(
        supabaseUrl,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: {
              Authorization: `Bearer ${jwt1}`
            }
          }
        }
      );
      
      // Query vendors - RLS should filter to only tenant 1
      const { data: vendors, error } = await supabase
        .schema('supply_chain')
        .from('vendors')
        .select('*');
      
      expect(error).toBeNull();
      expect(vendors).toBeDefined();
      
      // Should only see tenant 1 vendors
      const hasOtherTenantData = vendors!.some(v => v.tenant_id !== tenant1Id);
      expect(hasOtherTenantData).toBe(false);
    });
    
    it('should prevent insert with wrong tenant_id in JWT', async () => {
      const jwt1 = await getJWTForUser(user1Email, 'test-password-123');
      
      const supabase = createClient(
        supabaseUrl,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: {
              Authorization: `Bearer ${jwt1}`
            }
          }
        }
      );
      
      // Try to insert vendor for different tenant (should fail RLS check)
      const { data, error } = await supabase
        .schema('supply_chain')
        .from('vendors')
        .insert({
          tenant_id: tenant2Id, // Different tenant!
          name: 'Malicious Vendor',
          code: 'HACK-123'
        })
        .select();
      
      // Should fail RLS policy check
      expect(error).toBeDefined();
      expect(data).toBeNull();
    });
  });
  
  describe('Tenant Isolation Verification', () => {
    it('tenant 1 user should only see tenant 1 data', async () => {
      const jwt1 = await getJWTForUser(user1Email, 'test-password-123');
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/inventory/vendors`, {
        headers: { 'Authorization': `Bearer ${jwt1}` }
      });
      
      const data = await response.json();
      const allTenant1 = data.data.every((v: Vendor) => v.tenant_id === tenant1Id);

      expect(allTenant1).toBe(true);
    });
    
    it('tenant 2 user should only see tenant 2 data', async () => {
      const jwt2 = await getJWTForUser(user2Email, 'test-password-123');
      
      const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/inventory/vendors`, {
        headers: { 'Authorization': `Bearer ${jwt2}` }
      });
      
      const data = await response.json();
      const allTenant2 = data.data.every((v: Vendor) => v.tenant_id === tenant2Id);

      expect(allTenant2).toBe(true);
    });
    
    it('should not allow accessing specific vendor from different tenant', async () => {
      const jwt1 = await getJWTForUser(user1Email, 'test-password-123');
      
      // Try to access vendor 2 (belongs to tenant 2) using tenant 1 JWT
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_APP_URL}/api/inventory/vendors/${vendor2Id}`,
        {
          headers: { 'Authorization': `Bearer ${jwt1}` }
        }
      );
      
      // Should return 404 (not found) because RLS filtered it out
      expect(response.status).toBe(404);
    });
  });
});

describe('local_users write lockdown (migration 20260529000001)', () => {
  // local_users must be writable ONLY by the service role (the core-events
  // webhook). An authenticated browser client must not be able to insert ANY
  // row — own-tenant, cross-tenant, or with an elevated role — because
  // local_users.role overrides the Core session role on login/refresh.
  function authedClient(jwt: string) {
    return createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
  }

  it('blocks an authenticated user from inserting their OWN local_users row', async () => {
    const jwt1 = await getJWTForUser(user1Email, 'test-password-123');
    const supabase = authedClient(jwt1!);

    const { data, error } = await supabase
      .from('local_users')
      .insert({
        user_id: crypto.randomUUID(),
        tenant_id: tenant1Id, // own tenant
        email: 'self@example.com',
        name: 'Self Insert',
        role: 'member',
      })
      .select();

    expect(error).toBeDefined(); // RLS denies: no INSERT policy for authenticated
    expect(data).toBeNull();
  });

  it('blocks self privilege-escalation via role=admin', async () => {
    const jwt1 = await getJWTForUser(user1Email, 'test-password-123');
    const supabase = authedClient(jwt1!);

    const { data, error } = await supabase
      .from('local_users')
      .insert({
        user_id: crypto.randomUUID(),
        tenant_id: tenant1Id,
        email: 'escalate@example.com',
        name: 'Escalation Attempt',
        role: 'admin', // would grant admin on next token refresh if it landed
      })
      .select();

    expect(error).toBeDefined();
    expect(data).toBeNull();
  });

  it('blocks inserting a cross-tenant local_users row', async () => {
    const jwt1 = await getJWTForUser(user1Email, 'test-password-123');
    const supabase = authedClient(jwt1!);

    const { data, error } = await supabase
      .from('local_users')
      .insert({
        user_id: crypto.randomUUID(),
        tenant_id: tenant2Id, // different tenant
        email: 'cross@example.com',
        name: 'Cross Tenant',
        role: 'admin',
      })
      .select();

    expect(error).toBeDefined();
    expect(data).toBeNull();
  });
});

describe('Service Role vs JWT Comparison', () => {
  it('should demonstrate service role bypasses RLS (dangerous)', async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Service role can see ALL tenants' data
    const { data: vendors } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('*');
    
    // Will see vendors from multiple tenants
    const tenants = new Set(vendors?.map(v => v.tenant_id));
    
    // Service role bypasses RLS, so we can see multiple tenants
    // This is why we must NOT use it for user-driven routes!
    console.log(`Service role sees ${tenants.size} different tenants`);
  });
  
  it('should demonstrate JWT + anon key enforces RLS (secure)', async () => {
    const jwt = await getJWTForUser(user1Email, 'test-password-123');
    
    const supabase = createClient(
      supabaseUrl,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: {
          headers: {
            Authorization: `Bearer ${jwt}`
          }
        }
      }
    );
    
    // JWT + anon key = RLS enforced
    const { data: vendors } = await supabase
      .schema('supply_chain')
      .from('vendors')
      .select('*');
    
    // Will only see ONE tenant's data
    const tenants = new Set(vendors?.map(v => v.tenant_id));
    
    expect(tenants.size).toBe(1);
    expect(tenants.has(tenant1Id)).toBe(true);
    
    console.log(`JWT client sees only 1 tenant (as expected)`);
  });
});
