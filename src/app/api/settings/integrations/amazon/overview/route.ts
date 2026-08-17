/**
 * GET /api/settings/integrations/amazon/overview
 *
 * Everything the Amazon integration hub (item 06) needs in one round trip:
 * connection health, the purchaser registry (with each person's position and
 * spending limit), recent punchout sessions, and the Amazon product mappings
 * item 05's paste-a-link flow writes.
 *
 * Read-only and secret-free: the connection card shows HOSTNAMES, never the
 * cXML From Identity or Shared Secret (those live in Vault and stay there).
 * integration_mode is DISPLAY ONLY — flipping test↔active is a deliberate
 * manual DB step, not a button.
 */
import { createSessionReadRoute } from '@rocketmanv9/chassis/nextjs';
import { getAdminClient } from '@/utils/supabase/admin';
import { listPurchaserAccounts, AMAZON_PUNCHOUT_CAPABILITY } from '@/lib/amazon-access';

const SERVICE_NAME = process.env.INTERNAL_JWT_ISSUER || 'summit-inventory';

/** Hostname only — never echo a full credentialed URL back to the browser. */
function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export const GET = createSessionReadRoute(async ({ session, log }) => {
  const tenantId = session.tenantId!;
  const admin = getAdminClient();
  const prov = (admin as any).schema('provisioning');
  const inv = (admin as any).schema('inventory');
  const sc = (admin as any).schema('supply_chain');

  // ── Connection ────────────────────────────────────────────────────────
  const { data: provider } = await prov
    .from('providers')
    .select('id, provider_key, display_name, provider_type, config, is_active, integration_mode, webhook_status, updated_at')
    .eq('tenant_id', tenantId)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .limit(1)
    .maybeSingle();

  const config = provider?.config ?? {};
  const hasCredentials = !!(config.from_identity_ref && config.shared_secret_ref);
  const sandbox = config.sandbox ?? true;

  const connection = provider
    ? {
        provider_id: provider.id as string,
        provider_key: provider.provider_key as string,
        display_name: (provider.display_name as string) ?? 'Amazon Business',
        configured: hasCredentials,
        is_active: !!provider.is_active,
        integration_mode: (provider.integration_mode as string) ?? 'test',
        // The cXML deploymentMode flag the credentials were saved with.
        sandbox,
        webhook_status: (provider.webhook_status as string) ?? null,
        punchout_host: hostOf(config.punchout_url),
        punchout_test_host: hostOf(config.punchout_test_url),
        po_request_host: hostOf(config.po_request_url),
        // Which endpoint a session would actually hit right now.
        effective_punchout_host: hostOf(sandbox ? config.punchout_test_url : config.punchout_url),
        updated_at: (provider.updated_at as string) ?? null,
      }
    : null;

  // ── Purchaser registry (+ the people behind the ids) ──────────────────
  const registry = await listPurchaserAccounts(admin, tenantId);

  const { data: users } = await admin
    .from('local_users')
    .select('user_id, name, email, role, position_id, spending_limit')
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
    .limit(500);

  const positionIds = [...new Set((users ?? []).map((u: any) => u.position_id).filter(Boolean))];
  const { data: positions } = positionIds.length
    ? await admin.from('positions').select('id, title, name').eq('tenant_id', tenantId).in('id', positionIds).limit(500)
    : { data: [] as any[] };

  const positionById = new Map<string, string>(
    (positions ?? []).map((p: any) => [p.id, p.title || p.name || '']),
  );
  const userById = new Map<string, any>((users ?? []).map((u: any) => [u.user_id, u]));

  const purchasers = registry.map((row) => {
    const u = userById.get(row.user_id);
    return {
      ...row,
      name: u?.name ?? null,
      work_email: u?.email ?? null,
      role: u?.role ?? null,
      position_title: u?.position_id ? positionById.get(u.position_id) ?? null : null,
      spending_limit: u?.spending_limit ?? null,
    };
  });

  // People not yet registered — the "add a purchaser" picker.
  const registered = new Set(registry.map((r) => r.user_id));
  const candidates = (users ?? [])
    .filter((u: any) => !registered.has(u.user_id))
    .map((u: any) => ({
      user_id: u.user_id,
      name: u.name ?? null,
      email: u.email ?? null,
      role: u.role ?? null,
      position_title: u.position_id ? positionById.get(u.position_id) ?? null : null,
      spending_limit: u.spending_limit ?? null,
    }));

  // ── Positions that grant Amazon buying (the OTHER grant path) ─────────
  // Item 07 unified the Amazon punchout gate with position_capabilities: a
  // position listing the `amazon.punchout` capability may punch out without an
  // individual registry seat. Surface those positions read-only next to the
  // per-person registry so an admin sees BOTH ways access is granted. Editing
  // the position→capability set lives in the existing capabilities editor.
  const { data: capRows } = await admin
    .from('position_capabilities')
    .select('position_id, capability_keys')
    .eq('tenant_id', tenantId)
    .contains('capability_keys', [AMAZON_PUNCHOUT_CAPABILITY])
    .limit(500);

  const grantPositionIds = [...new Set((capRows ?? []).map((r: any) => r.position_id).filter(Boolean))];
  const { data: grantPositions } = grantPositionIds.length
    ? await admin.from('positions').select('id, title, name').eq('tenant_id', tenantId).in('id', grantPositionIds).limit(500)
    : { data: [] as any[] };
  const grantPositionTitleById = new Map<string, string>(
    (grantPositions ?? []).map((p: any) => [p.id, p.title || p.name || '']),
  );

  // How many people sit in each granting position (context for the admin).
  const headcountByPosition = new Map<string, number>();
  for (const u of users ?? []) {
    if (u.position_id && grantPositionTitleById.has(u.position_id)) {
      headcountByPosition.set(u.position_id, (headcountByPosition.get(u.position_id) ?? 0) + 1);
    }
  }

  const capabilityPositions = (capRows ?? [])
    .map((r: any) => ({
      position_id: r.position_id as string,
      title: grantPositionTitleById.get(r.position_id) ?? null,
      people_count: headcountByPosition.get(r.position_id) ?? 0,
    }))
    .filter((p) => p.title !== null)
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  // ── Activity: recent punchout sessions ────────────────────────────────
  const { data: sessions } = await inv
    .from('punchout_orders')
    .select('id, status, user_email, initiated_by, poom_total, total_cost, purchase_order_id, amazon_order_id, error_message, created_at, updated_at, metadata')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20);

  const poIds = [...new Set((sessions ?? []).map((s: any) => s.purchase_order_id).filter(Boolean))];
  const { data: pos } = poIds.length
    ? await sc.from('purchase_orders').select('id, po_number, status').eq('tenant_id', tenantId).in('id', poIds).limit(50)
    : { data: [] as any[] };
  const poById = new Map<string, any>((pos ?? []).map((p: any) => [p.id, p]));

  const activity = (sessions ?? []).map((s: any) => ({
    id: s.id,
    status: s.status,
    user_email: s.user_email,
    initiated_by: s.initiated_by,
    purchaser_name: s.initiated_by ? userById.get(s.initiated_by)?.name ?? null : null,
    total: s.poom_total ?? s.total_cost ?? null,
    purchase_order_id: s.purchase_order_id,
    po_number: s.purchase_order_id ? poById.get(s.purchase_order_id)?.po_number ?? null : null,
    po_status: s.purchase_order_id ? poById.get(s.purchase_order_id)?.status ?? null : null,
    amazon_order_id: s.amazon_order_id,
    error_message: s.error_message,
    created_at: s.created_at,
    integration_mode: s.metadata?.integration_mode ?? null,
  }));

  // Status tallies across ALL sessions, not just the 20 shown.
  const { data: allStatuses } = await inv
    .from('punchout_orders')
    .select('status, created_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1000);

  const statusCounts: Record<string, number> = {};
  for (const row of allStatuses ?? []) {
    statusCounts[(row as any).status] = (statusCounts[(row as any).status] ?? 0) + 1;
  }
  const lastSessionAt = (allStatuses ?? [])[0]?.created_at ?? null;
  const lastSuccessfulAt =
    (allStatuses ?? []).find((r: any) => r.status === 'submitted' || r.status === 'confirmed')?.created_at ?? null;

  // ── Mappings (item 05's paste-a-link output) ──────────────────────────
  let mappingCount = 0;
  let recentMappings: any[] = [];
  if (provider?.id) {
    const { count } = await prov
      .from('provider_item_mappings')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('provider_id', provider.id);
    mappingCount = count ?? 0;

    const { data: recent } = await prov
      .from('provider_item_mappings')
      .select('id, external_product_id, unit_cost, metadata, created_at')
      .eq('tenant_id', tenantId)
      .eq('provider_id', provider.id)
      .order('created_at', { ascending: false })
      .limit(5);

    recentMappings = (recent ?? []).map((m: any) => ({
      id: m.id,
      asin: m.external_product_id,
      title: m.metadata?.title ?? null,
      unit_cost: m.unit_cost,
      source_url: m.metadata?.source_url ?? (m.external_product_id ? `https://www.amazon.com/dp/${m.external_product_id}` : null),
      mapped_via: m.metadata?.mapped_via ?? null,
      created_at: m.created_at,
    }));
  }

  log.info('amazon.hub.overview', {
    connected: !!connection?.configured,
    purchasers: purchasers.length,
    capability_positions: capabilityPositions.length,
    sessions: activity.length,
    mappings: mappingCount,
  });

  return Response.json({
    data: {
      connection,
      purchasers,
      candidates,
      // Positions granted `amazon.punchout` — the second, role-based grant path.
      capability_positions: capabilityPositions,
      // Empty registry = the punchout gate is dormant; the UI says so out loud.
      gate: { configured: purchasers.length > 0, dormant: purchasers.length === 0 },
      activity,
      status_counts: statusCounts,
      last_session_at: lastSessionAt,
      last_successful_at: lastSuccessfulAt,
      mappings: { count: mappingCount, recent: recentMappings },
    },
  });
}, { serviceName: SERVICE_NAME });
