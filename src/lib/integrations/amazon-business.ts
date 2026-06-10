/**
 * Amazon Business cXML Integration
 *
 * Per-tenant cXML credentials (From Identity, Shared Secret, Punchout URLs,
 * PO Request URL). Orders are cXML OrderRequests POSTed to the tenant's
 * PO request URL. Actual cXML document format is stubbed pending the
 * Amazon Business integration guide.
 */

import { AppError } from '@rocketmanv9/chassis/errors';

// ── Types ──────────────────────────────────────────────────────────────

export interface CxmlCredentials {
  fromIdentity: string;
  sharedSecret: string;
  /** Effective PunchOutSetupRequest endpoint for the current mode (test vs live). */
  punchoutUrl: string;
  /** All configured punchout endpoints (legacy; kept for backward compatibility). */
  punchoutUrls: string[];
  poRequestUrl: string;
  sandbox: boolean;
}

export interface ShippingAddress {
  name: string;
  address_line_1: string;
  address_line_2?: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  /** Stable identifier for the <Address addressID="..."> attribute Amazon requires. */
  addressId?: string;
  /** Recipient/attention line for <DeliverTo> (Amazon caps at ~17 chars for card orders). */
  deliverTo?: string;
}

/**
 * @deprecated Use the punchout flow instead (POST /api/settings/integrations/amazon-business/punchout/submit).
 * Direct ordering without a punchout session is impossible — Amazon cXML requires SPAID from the session.
 */
export interface OrderLineItem {
  supplier_sku: string;
  quantity: number;
  unit_price?: number;
  description?: string;
  pack_quantity: number;
}

/**
 * @deprecated Use the punchout flow instead (POST /api/settings/integrations/amazon-business/punchout/submit).
 * Direct ordering without a punchout session is impossible — Amazon cXML requires SPAID from the session.
 */
export interface PlaceOrderRequest {
  credentials: CxmlCredentials;
  lineItems: OrderLineItem[];
  shipTo: ShippingAddress;
  poReferenceNumber: string;
}

/**
 * @deprecated Use the punchout flow instead (POST /api/settings/integrations/amazon-business/punchout/submit).
 * Direct ordering without a punchout session is impossible — Amazon cXML requires SPAID from the session.
 */
export interface PlaceOrderResult {
  externalOrderId: string;
  status: 'submitted' | 'pending';
  submittedAt: string;
}

// ── Pack Quantity Rounding ─────────────────────────────────────────────

export function roundToPackQuantity(requestedQty: number, packQuantity: number): number {
  if (packQuantity <= 1) return Math.max(1, Math.ceil(requestedQty));
  return Math.ceil(requestedQty / packQuantity) * packQuantity;
}

// ── Stubbed Order Placement ───────────────────────────────────────────

/**
 * @deprecated Direct cXML ordering is not possible — Amazon requires SupplierPartAuxiliaryID (SPAID)
 * which can only come from a punchout session. Use the punchout flow instead:
 *   1. POST /api/settings/integrations/amazon-business/punchout/start
 *   2. User shops on Amazon and returns via POOM webhook
 *   3. POST /api/settings/integrations/amazon-business/punchout/submit
 *
 * See PlaceOrderModal for the full UI flow.
 */
export async function placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult> {
  if (!request.credentials.poRequestUrl) {
    throw AppError.badRequest('PO Request URL is not configured. Update cXML credentials in Settings > Integrations.');
  }

  if (request.lineItems.length === 0) {
    throw AppError.badRequest('Order must contain at least one line item.');
  }

  throw AppError.badRequest(
    'Direct cXML ordering is not supported. Amazon Business requires a punchout session ' +
    '(SupplierPartAuxiliaryID). Use the punchout flow via Purchasing > Place Order instead.'
  );
}

// ── Config Resolution ─────────────────────────────────────────────────

/**
 * Loads the Amazon Business provider for a tenant and resolves cXML
 * credentials from Vault. Returns ready-to-use CxmlCredentials.
 */
export async function resolveCxmlCredentials(
  adminClient: any,
  tenantId: string
): Promise<CxmlCredentials & { providerId: string; integrationMode: string }> {
  const prov = (adminClient as any).schema('provisioning');

  const { data: provider } = await prov
    .from('providers')
    .select('id, config, is_active, integration_mode')
    .eq('tenant_id', tenantId)
    .eq('provider_type', 'procurement_marketplace')
    .like('provider_key', 'amazon-business%')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (!provider) {
    throw AppError.badRequest('Amazon Business is not connected. Configure it in Settings > Integrations.');
  }

  const fromIdentityRef = provider.config?.from_identity_ref;
  const sharedSecretRef = provider.config?.shared_secret_ref;

  if (!fromIdentityRef || !sharedSecretRef) {
    throw AppError.internal('Amazon Business provider config is incomplete (missing cXML credential references)');
  }

  const resolveSecret = async (ref: string): Promise<string> => {
    const { data } = await adminClient
      .from('decrypted_secrets')
      .select('decrypted_secret')
      .eq('name', ref)
      .limit(1)
      .single();
    if (!data?.decrypted_secret) {
      throw AppError.internal(`Amazon Business secret not found in Vault: ${ref}`);
    }
    return data.decrypted_secret;
  };

  const [fromIdentity, sharedSecret] = await Promise.all([
    resolveSecret(fromIdentityRef),
    resolveSecret(sharedSecretRef),
  ]);

  const sandbox = provider.config?.sandbox ?? true;
  const legacyPunchoutUrls: string[] = provider.config?.punchout_urls ?? [];
  const punchoutLive = provider.config?.punchout_url ?? legacyPunchoutUrls[0] ?? '';
  const punchoutTest = provider.config?.punchout_test_url ?? legacyPunchoutUrls[0] ?? '';

  return {
    fromIdentity,
    sharedSecret,
    // Mode-aware: the Test/Live toggle now switches the actual punchout endpoint,
    // not just the cXML deploymentMode flag.
    punchoutUrl: sandbox ? punchoutTest : punchoutLive,
    punchoutUrls: legacyPunchoutUrls,
    poRequestUrl: provider.config?.po_request_url ?? '',
    sandbox,
    providerId: provider.id,
    integrationMode: provider.integration_mode ?? 'test',
  };
}

/**
 * Validates that a provider has complete cXML configuration.
 * Does not call any external service — just checks that all required
 * credential refs and URLs are present.
 */
export async function validateCxmlConfig(
  adminClient: any,
  tenantId: string
): Promise<boolean> {
  try {
    const creds = await resolveCxmlCredentials(adminClient, tenantId);
    return !!(creds.fromIdentity && creds.sharedSecret && creds.poRequestUrl);
  } catch {
    return false;
  }
}
