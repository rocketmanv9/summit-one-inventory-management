import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/supabase/client';
import { createHmac } from 'crypto';

interface TenantProfileData {
  ein?: string;
  city?: string;
  state?: string;
  country?: string;
  website?: string;
  industry?: string;
  logo_url?: string;
  org_type?: string;
  products?: string[];
  services?: string[];
  timezone?: string;
  nick_name?: string;
  tenant_id: string;
  legal_name?: string;
  naics_code?: string;
  description?: string;
  postal_code?: string;
  contact_email?: string;
  contact_phone?: string;
  address_line_1?: string;
  address_line_2?: string;
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
}

export async function POST(req: NextRequest) {
  try {
    // 1. Verify HMAC signature
    const signature = req.headers.get('x-event-signature');
    const eventType = req.headers.get('x-event-type');
    const rawBody = await req.text();
    
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing signature' },
        { status: 401 }
      );
    }
    
    if (!eventType) {
      return NextResponse.json(
        { error: 'Missing event type' },
        { status: 400 }
      );
    }
    
    const hmac = createHmac('sha256', process.env.WEBHOOK_SECRET!);
    const expectedSignature = 'sha256=' + hmac.update(rawBody).digest('hex');
    
    if (signature !== expectedSignature) {
      console.error('Invalid webhook signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }
    
    const body = JSON.parse(rawBody);
    const payload = body.payload;
    
    // 2. Check idempotency using delivery_id or event_id from body
    const deliveryId = body.delivery_id || body.event_id || `${eventType}-${Date.now()}`;
    
    const supabase = createClient();
    
    const { data: existing } = await supabase
      .from('processed_events')
      .select('id')
      .eq('delivery_id', deliveryId)
      .single();
    
    if (existing) {
      return NextResponse.json({ status: 'already_processed' });
    }
    
    // 3. Process event based on type
    await processEvent(supabase, eventType, payload);
    
    // 4. Record processing
    await supabase
      .from('processed_events')
      .insert({
        delivery_id: deliveryId,
        event_type: eventType,
        tenant_id: payload?.new?.tenant_id || payload?.tenant_id || null,
        payload: payload,
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

async function processEvent(supabase: any, eventType: string, payload: any) {
  console.log(`Processing event: ${eventType}`);
  
  switch (eventType) {
    case 'tenant.created':
      await handleTenantCreated(supabase, payload);
      break;
      
    case 'tenant.updated':
      await handleTenantUpdated(supabase, payload);
      break;
      
    case 'tenant.profile.created':
      await handleTenantProfileCreated(supabase, payload);
      break;
      
    case 'tenant.profile.updated':
      await handleTenantProfileUpdated(supabase, payload);
      break;
      
    case 'tenant.membership.created':
      await handleMembershipCreated(supabase, payload);
      break;
      
    case 'tenant.membership.updated':
      await handleMembershipUpdated(supabase, payload);
      break;
      
    case 'tenant.membership.deleted':
      await handleMembershipDeleted(supabase, payload);
      break;
      
    case 'tenant.product.entitlement.created':
      await handleProductEntitlementCreated(supabase, payload);
      break;
      
    case 'tenant.product.entitlement.deleted':
      await handleProductEntitlementDeleted(supabase, payload);
      break;
      
    default:
      console.log(`Unhandled event type: ${eventType}`);
  }
}

async function handleTenantCreated(supabase: any, payload: any) {
  const tenant = payload.new;
  console.log(`Tenant created: ${tenant.name} (ID: ${tenant.id})`);
  
  // Store basic tenant info - profile data comes via tenant.profile.created
  const { error } = await supabase
    .from('tenants')
    .insert({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.id, // Will be updated by profile event
      synced_at: new Date().toISOString(),
    });
  
  if (error) {
    console.error('Failed to create tenant:', error);
  }
}

async function handleTenantUpdated(supabase: any, payload: any) {
  const tenant = payload.new;
  console.log(`Tenant updated: ${tenant.name}`);
  
  const { error } = await supabase
    .from('tenants')
    .update({
      name: tenant.name,
      synced_at: new Date().toISOString(),
    })
    .eq('id', tenant.id);
  
  if (error) {
    console.error('Failed to update tenant:', error);
  }
}

async function handleTenantProfileCreated(supabase: any, payload: any) {
  const profile: TenantProfileData = payload.new;
  console.log(`Tenant profile created for: ${profile.tenant_id}`);
  
  // Update tenant with profile information
  const { error } = await supabase
    .from('tenants')
    .upsert({
      id: profile.tenant_id,
      name: profile.legal_name || profile.nick_name,
      slug: profile.tenant_id,
      industry: profile.industry,
      address: {
        line1: profile.address_line_1,
        line2: profile.address_line_2,
        city: profile.city,
        state: profile.state,
        postal_code: profile.postal_code,
        country: profile.country,
      },
      metadata: {
        legal_name: profile.legal_name,
        nick_name: profile.nick_name,
        org_type: profile.org_type,
        naics_code: profile.naics_code,
        ein: profile.ein,
        website: profile.website,
        contact_email: profile.contact_email,
        contact_phone: profile.contact_phone,
        logo_url: profile.logo_url,
        timezone: profile.timezone,
        products: profile.products,
        services: profile.services,
        colors: {
          primary: profile.primary_color,
          secondary: profile.secondary_color,
          accent: profile.accent_color,
        }
      },
      synced_at: new Date().toISOString(),
    });
  
  if (error) {
    console.error('Failed to sync tenant profile:', error);
  }
}

async function handleTenantProfileUpdated(supabase: any, payload: any) {
  const profile: TenantProfileData = payload.new;
  console.log(`Tenant profile updated for: ${profile.tenant_id}`);
  
  // Update tenant with latest profile information
  const { error } = await supabase
    .from('tenants')
    .update({
      name: profile.legal_name || profile.nick_name,
      industry: profile.industry,
      address: {
        line1: profile.address_line_1,
        line2: profile.address_line_2,
        city: profile.city,
        state: profile.state,
        postal_code: profile.postal_code,
        country: profile.country,
      },
      metadata: {
        legal_name: profile.legal_name,
        nick_name: profile.nick_name,
        org_type: profile.org_type,
        naics_code: profile.naics_code,
        ein: profile.ein,
        website: profile.website,
        contact_email: profile.contact_email,
        contact_phone: profile.contact_phone,
        logo_url: profile.logo_url,
        timezone: profile.timezone,
        products: profile.products,
        services: profile.services,
        colors: {
          primary: profile.primary_color,
          secondary: profile.secondary_color,
          accent: profile.accent_color,
        }
      },
      synced_at: new Date().toISOString(),
    })
    .eq('id', profile.tenant_id);
  
  if (error) {
    console.error('Failed to update tenant profile:', error);
  }
}

async function handleMembershipCreated(supabase: any, payload: any) {
  const membership = payload.new;
  console.log(`User ${membership.user_id} added to tenant ${membership.tenant_id} with role ${membership.role}`);
  
  // RLS policies handle authorization automatically via session tenant_id
  // Just log for now - could create user preferences table later
}

async function handleMembershipUpdated(supabase: any, payload: any) {
  const newData = payload.new;
  const oldData = payload.old;
  console.log(`User ${newData.user_id} role changed from ${oldData.role} to ${newData.role}`);
  
  // Update local permissions if needed
}

async function handleMembershipDeleted(supabase: any, payload: any) {
  const membership = payload.old;
  console.log(`User ${membership.user_id} removed from tenant ${membership.tenant_id}`);
  
  // RLS will automatically block access - no need to delete data
}

async function handleProductEntitlementCreated(supabase: any, payload: any) {
  const entitlement = payload.new;
  console.log(`Tenant ${entitlement.tenant_id} granted access to product ${entitlement.product_id}`);
  
  // Track which tenants have access to Inventory module
  // Could create entitlements table or just log
  // For now, if they can authenticate and have tenant_id in session, they have access
}

async function handleProductEntitlementDeleted(supabase: any, payload: any) {
  const entitlement = payload.old;
  console.log(`Tenant ${entitlement.tenant_id} lost access to product ${entitlement.product_id}`);
  
  // Could soft-delete or archive tenant data
  // Or block access via middleware check
}

