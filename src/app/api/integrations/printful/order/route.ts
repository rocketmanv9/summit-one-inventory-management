import { z } from 'zod';
import { createSessionWriteRoute } from '@rocketmanv9/chassis/nextjs';
import { AppError } from '@rocketmanv9/chassis/errors';
import {
  createDraftOrder,
  confirmOrder,
  type PrintfulOrderItem,
  type PrintfulRecipient,
} from '@/lib/printful';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'my-service';

/**
 * Place a Printful order for an approved apparel order.
 *
 * Called by the approve_apparel_order Isabelle tool after manager approval.
 * Builds the Printful payload from apparel_orders + apparel_config, creates a
 * draft order, optionally confirms it, and records the Printful order ID.
 *
 * Design files (logo) are fetched from Core tenant branding at order time —
 * Core/HR owns the brand assets, not inventory.
 */

const OrderSchema = z.object({
  apparel_order_id: z.string().uuid('Invalid apparel order ID'),
});

export const POST = createSessionWriteRoute(
  async ({ req, log, supabase, idempotencyKey, ctx }) => {
    const body = OrderSchema.parse(await req.json());
    const inv = (supabase as any).schema('inventory');
    const tenantId = (ctx as any).tenantId;

    // 1. Load apparel order
    const { data: order, error: orderErr } = await inv
      .from('apparel_orders')
      .select('*')
      .eq('id', body.apparel_order_id)
      .eq('tenant_id', tenantId)
      .limit(1)
      .single();

    if (orderErr || !order) throw AppError.notFound('Apparel order not found');
    if (order.status !== 'pending_approval' && order.status !== 'approved') {
      throw AppError.conflict(`Order status is "${order.status}", expected "pending_approval" or "approved"`);
    }

    // 2. Load apparel config
    const { data: config, error: configErr } = await inv
      .from('apparel_config')
      .select('*')
      .eq('tenant_id', tenantId)
      .limit(1)
      .single();

    if (configErr || !config) throw AppError.notFound('Apparel config not found for tenant');

    // 3. Resolve design file URL from Core tenant branding
    let logoUrl = '';
    const coreUrl = process.env.NEXT_PUBLIC_CORE_SUPABASE_URL;
    const coreKey = process.env.NEXT_PUBLIC_CORE_SUPABASE_ANON_KEY;
    if (coreUrl && coreKey) {
      try {
        const brandingRes = await fetch(`${coreUrl}/rest/v1/rpc/get_public_branding`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: coreKey,
            Authorization: `Bearer ${coreKey}`,
          },
          body: JSON.stringify({ target_tenant_id: tenantId }),
        });
        if (brandingRes.ok) {
          const brandingData = await brandingRes.json();
          const parsed = Array.isArray(brandingData) ? brandingData[0] : brandingData;
          if (parsed?.logo_asset_id) {
            // Resolve full storage path from the brand-assets bucket
            const prefix = `tenants/${tenantId}/tenant_logo/${parsed.logo_asset_id}/`;
            const listRes = await fetch(`${coreUrl}/storage/v1/object/list/brand-assets`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                apikey: coreKey,
                Authorization: `Bearer ${coreKey}`,
              },
              body: JSON.stringify({ prefix, limit: 1 }),
            });
            if (listRes.ok) {
              const files = await listRes.json();
              if (Array.isArray(files) && files.length > 0 && files[0].name) {
                logoUrl = `${coreUrl}/storage/v1/object/public/brand-assets/${prefix}${files[0].name}`;
              }
            }
          }
        }
      } catch {
        log.warn('printful-order.branding_fetch_failed', { tenantId });
      }
    }

    // 4. Build Printful order payload
    const shipping = config.shipping_address as PrintfulRecipient | null;
    if (!shipping?.address1) throw AppError.badRequest('Shipping address not configured in apparel config');

    const items: PrintfulOrderItem[] = (order.items as any[]).map((item: any) => ({
      variant_id: item.variant_id,
      quantity: item.quantity,
      name: `Company Shirt - ${item.size}`,
      files: logoUrl
        ? [{ type: 'front', url: logoUrl }]
        : [],
    }));

    const recipient: PrintfulRecipient = {
      name: shipping.name || config.shipping_address?.company || 'Office',
      company: shipping.company,
      address1: shipping.address1,
      address2: shipping.address2,
      city: shipping.city,
      state_code: shipping.state_code,
      country_code: shipping.country_code || 'US',
      zip: shipping.zip,
      phone: shipping.phone,
      email: shipping.email,
    };

    // 5. Create draft order on Printful
    const printfulOrder = await createDraftOrder({
      external_id: order.id,
      recipient,
      items,
    });

    log.info('printful-order.draft_created', {
      printfulOrderId: printfulOrder.id,
      apparelOrderId: order.id,
    });

    // 6. Auto-confirm the order
    const confirmedOrder = await confirmOrder(printfulOrder.id);

    // 7. Update apparel order with Printful details
    const { data: updated, error: updateErr } = await inv
      .from('apparel_orders')
      .update({
        status: 'ordered',
        printful_order_id: confirmedOrder.id,
        printful_external_id: order.id,
        printful_status: confirmedOrder.status,
        total_estimated_cost: parseFloat(confirmedOrder.retail_costs?.total || '0'),
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .select()
      .single();

    if (updateErr) throw AppError.internal(updateErr.message);

    return {
      data: {
        apparel_order_id: order.id,
        printful_order_id: confirmedOrder.id,
        printful_status: confirmedOrder.status,
        estimated_cost: confirmedOrder.retail_costs?.total,
      },
      status: 201,
      events: [{
        event_name: 'apparel.order_placed',
        payload: {
          apparel_order_id: order.id,
          printful_order_id: confirmedOrder.id,
          tenant_id: tenantId,
          items: order.items,
        },
        last_event_id: idempotencyKey,
      }],
    };
  },
  {
    serviceName: SERVICE_NAME,
    scope: 'POST /api/integrations/printful/order',
  }
);
