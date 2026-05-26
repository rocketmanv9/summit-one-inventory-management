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
}

export interface OrderLineItem {
  supplier_sku: string;
  quantity: number;
  unit_price?: number;
  description?: string;
  pack_quantity: number;
}

export interface PlaceOrderRequest {
  credentials: CxmlCredentials;
  lineItems: OrderLineItem[];
  shipTo: ShippingAddress;
  poReferenceNumber: string;
}

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
 * Place an order via cXML OrderRequest.
 *
 * Currently a stub — the actual cXML document format will be implemented
 * once the Amazon Business cXML integration guide is provided. The
 * OrderRequest will POST to `credentials.poRequestUrl` with the From
 * Identity + Shared Secret in the cXML header and one ItemOut per line
 * keyed by supplier_sku (ASIN) + quantity + ship-to.
 */
export async function placeOrder(request: PlaceOrderRequest): Promise<PlaceOrderResult> {
  if (!request.credentials.poRequestUrl) {
    throw AppError.badRequest('PO Request URL is not configured. Update cXML credentials in Settings > Integrations.');
  }

  if (request.lineItems.length === 0) {
    throw AppError.badRequest('Order must contain at least one line item.');
  }

  // TODO: Build and POST cXML OrderRequest document.
  // Waiting on Amazon Business cXML integration guide PDF.
  throw AppError.internal(
    'cXML OrderRequest submission is not yet implemented. ' +
    'The integration is in test mode — order document format pending Amazon Business integration guide.'
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

  return {
    fromIdentity,
    sharedSecret,
    punchoutUrls: provider.config?.punchout_urls ?? [],
    poRequestUrl: provider.config?.po_request_url ?? '',
    sandbox: provider.config?.sandbox ?? true,
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
