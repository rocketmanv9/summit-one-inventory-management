import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

interface CoreEvent {
  delivery_id: string;
  event_id: string;
  event_type: string;
  tenant_id: string | null;
  aggregate_type: string | null;
  aggregate_id: string | null;
  payload: any;
  occurred_at: string;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Verify HMAC signature
    const signature = req.headers.get('x-summit-signature');
    const rawBody = await req.text();
    
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 401 }
      );
    }
    
    const expectedSignature = createHmac('sha256', process.env.WEBHOOK_SECRET!)
      .update(rawBody)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      console.error('Invalid webhook signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }
    
    const event: CoreEvent = JSON.parse(rawBody);
    
    // 2. Check idempotency (prevent duplicate processing)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );
    
    const { data: existing } = await supabase
      .from('processed_events')
      .select('id')
      .eq('delivery_id', event.delivery_id)
      .single();
    
    if (existing) {
      return NextResponse.json({ status: 'already_processed' });
    }
    
    // 3. Process event based on type
    await processEvent(supabase, event);
    
    // 4. Record processing
    await supabase
      .from('processed_events')
      .insert({
        delivery_id: event.delivery_id,
        event_type: event.event_type,
        tenant_id: event.tenant_id,
        payload: event.payload,
      });
    
    return NextResponse.json({ status: 'processed' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function processEvent(supabase: any, event: CoreEvent) {
  console.log(`Processing event: ${event.event_type}`, {
    delivery_id: event.delivery_id,
    tenant_id: event.tenant_id,
  });
  
  switch (event.event_type) {
    case 'tenant.membership.created':
      await handleMembershipCreated(supabase, event);
      break;
      
    case 'tenant.membership.updated':
      await handleMembershipUpdated(supabase, event);
      break;
      
    case 'tenant.membership.deleted':
      await handleMembershipDeleted(supabase, event);
      break;
      
    case 'tenant.profile.updated':
      await handleProfileUpdated(supabase, event);
      break;
      
    case 'tenant.created':
      await handleTenantCreated(supabase, event);
      break;
      
    case 'tenant.updated':
      await handleTenantUpdated(supabase, event);
      break;
      
    default:
      console.log(`Unhandled event type: ${event.event_type}`);
  }
}

async function handleMembershipCreated(supabase: any, event: CoreEvent) {
  const { user_id, tenant_id, role } = event.payload;
  
  console.log(`User ${user_id} added to tenant ${tenant_id} with role ${role}`);
  
  // Create local user permissions or setup
  // For inventory service, we might just log this or set up initial preferences
  // The actual authorization happens via RLS policies using tenant_id from session
}

async function handleMembershipUpdated(supabase: any, event: CoreEvent) {
  const { user_id, tenant_id, old_role, new_role } = event.payload;
  
  console.log(`User ${user_id} role changed from ${old_role} to ${new_role} in tenant ${tenant_id}`);
  
  // Update local permissions if needed
}

async function handleMembershipDeleted(supabase: any, event: CoreEvent) {
  const { user_id, tenant_id } = event.payload;
  
  console.log(`User ${user_id} removed from tenant ${tenant_id}`);
  
  // Clean up local user data if needed
  // Note: Don't delete data, just revoke access - RLS handles this automatically
}

async function handleProfileUpdated(supabase: any, event: CoreEvent) {
  const { user_id, email, first_name, last_name } = event.payload.new;
  
  console.log(`Profile updated for user ${user_id}: ${email}`);
  
  // If you maintain a local users table, sync it here
  // For now, we'll just log it since user info comes from session
}

async function handleTenantCreated(supabase: any, event: CoreEvent) {
  const { tenant_id, name, slug, industry, address, metadata } = event.payload;
  
  console.log(`New tenant created: ${name} (${slug})`);
  
  // Store tenant information locally
  const { error } = await supabase
    .from('tenants')
    .insert({
      id: tenant_id,
      name,
      slug,
      industry,
      address,
      metadata,
      synced_at: new Date().toISOString(),
    });
  
  if (error) {
    console.error('Failed to sync tenant:', error);
  } else {
    console.log(`Tenant ${name} synced successfully`);
  }
  
  // Initialize tenant-specific data if needed
  // For example, create default locations, categories, etc.
}

async function handleTenantUpdated(supabase: any, event: CoreEvent) {
  const { tenant_id, name, slug, industry, address, metadata } = event.payload;
  
  console.log(`Tenant updated: ${name}`);
  
  // Update tenant information locally
  const { error } = await supabase
    .from('tenants')
    .upsert({
      id: tenant_id,
      name,
      slug,
      industry,
      address,
      metadata,
      synced_at: new Date().toISOString(),
    });
  
  if (error) {
    console.error('Failed to update tenant:', error);
  } else {
    console.log(`Tenant ${name} updated successfully`);
  }
}

