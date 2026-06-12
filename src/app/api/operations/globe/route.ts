import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { createTenantServiceClient } from '@rocketmanv9/chassis/supabase';
import { AppError } from '@rocketmanv9/chassis/errors';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

export const GET = createSessionReadRoute(async ({ req, session, log }) => {
  const supabase = await createTenantServiceClient({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    tenantId: session.tenantId!,
  });

  const url = new URL(req.url);
  const dateFrom = url.searchParams.get('date_from') || undefined;
  const dateTo = url.searchParams.get('date_to') || undefined;
  const showVendors = url.searchParams.get('show_vendors') !== 'false';
  const showPOs = url.searchParams.get('show_pos') !== 'false';

  const inv = (supabase as any).schema('inventory');
  const sc = (supabase as any).schema('supply_chain');

  // Fetch geocoded locations
  const { data: locations, error: locErr } = await inv
    .from('locations')
    .select('id, name, address, latitude, longitude, active, location_type:location_types(id, name)')
    .eq('active', true)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .limit(500);

  if (locErr) {
    log.error('globe.locations_failed', { error: locErr.message });
    throw AppError.internal(locErr.message);
  }

  // Fetch transfers
  let transferQuery = inv
    .from('transfers')
    .select(
      'id, status, notes, created_at, initiated_at, completed_at, from_location:from_location_id(id, name, latitude, longitude), to_location:to_location_id(id, name, latitude, longitude), transfer_lines(id, qty, catalog_items:catalog_item_id(id, name, sku))'
    )
    .order('created_at', { ascending: false })
    .limit(500);

  if (dateFrom) {
    transferQuery = transferQuery.gte('created_at', dateFrom);
  }
  if (dateTo) {
    transferQuery = transferQuery.lte('created_at', dateTo);
  }

  const { data: transfers, error: transErr } = await transferQuery;

  if (transErr) {
    log.error('globe.transfers_failed', { error: transErr.message });
    throw AppError.internal(transErr.message);
  }

  // Normalize transfer relations
  const normalizedTransfers = (transfers || []).map((t: any) => ({
    ...t,
    from_location: Array.isArray(t.from_location) ? t.from_location[0] ?? null : t.from_location ?? null,
    to_location: Array.isArray(t.to_location) ? t.to_location[0] ?? null : t.to_location ?? null,
    transfer_lines: Array.isArray(t.transfer_lines)
      ? t.transfer_lines.map((line: any) => ({
          ...line,
          catalog_items: Array.isArray(line.catalog_items) ? line.catalog_items[0] ?? null : line.catalog_items ?? null,
        }))
      : [],
  }));

  // Fetch geocoded vendors (if requested)
  let vendors: any[] = [];
  if (showVendors) {
    const { data: vendorData, error: vendErr } = await sc
      .from('vendors')
      .select('id, name, code, contact_name, contact_email, contact_phone, city, state, latitude, longitude')
      .eq('active', true)
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .limit(200);

    if (vendErr) {
      log.error('globe.vendors_failed', { error: vendErr.message });
      throw AppError.internal(vendErr.message);
    }
    vendors = vendorData || [];
  }

  // Fetch purchase orders with vendor/location links (if requested).
  // Voided (soft-deleted drafts) and cancelled POs never belong on the map.
  let purchaseOrders: any[] = [];
  if (showPOs) {
    let poQuery = sc
      .from('purchase_orders')
      .select('id, po_number, status, needed_by_date, expected_delivery_date, vendor_id, delivery_location_id, created_at')
      .not('status', 'in', '(voided,cancelled)')
      .order('created_at', { ascending: false })
      .limit(500);

    if (dateFrom) {
      poQuery = poQuery.gte('created_at', dateFrom);
    }
    if (dateTo) {
      poQuery = poQuery.lte('created_at', dateTo);
    }

    const { data: poData, error: poErr } = await poQuery;

    if (poErr) {
      log.error('globe.pos_failed', { error: poErr.message });
      throw AppError.internal(poErr.message);
    }
    purchaseOrders = poData || [];

    // Attach Amazon shipment tracking (carrier / tracking # / ETA from the
    // ship-notice webhook) so in-transit packages can be drawn on the map.
    if (purchaseOrders.length > 0) {
      const { data: punchouts, error: punchErr } = await inv
        .from('punchout_orders')
        .select('purchase_order_id, metadata')
        .in('purchase_order_id', purchaseOrders.map((po: any) => po.id))
        .limit(500);

      if (punchErr) {
        // Tracking is enrichment — log and continue rather than failing the map
        log.warn('globe.shipments_failed', { error: punchErr.message });
      } else {
        const shipmentsByPo = new Map<string, any[]>();
        for (const p of punchouts || []) {
          const shipments = Array.isArray(p.metadata?.shipments) ? p.metadata.shipments : [];
          if (shipments.length > 0) {
            shipmentsByPo.set(p.purchase_order_id, [
              ...(shipmentsByPo.get(p.purchase_order_id) || []),
              ...shipments,
            ]);
          }
        }
        purchaseOrders = purchaseOrders.map((po: any) => ({
          ...po,
          shipments: shipmentsByPo.get(po.id) || [],
        }));
      }
    }
  }

  return Response.json({
    data: {
      locations: locations || [],
      transfers: normalizedTransfers,
      vendors,
      purchaseOrders,
    },
  });
}, { serviceName: SERVICE_NAME });
