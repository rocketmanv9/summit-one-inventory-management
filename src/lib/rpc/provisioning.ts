/**
 * Provisioning RPC Service Layer
 * Bounded Context: Provisioning (Kits, Policies, Requests, Employee Gear)
 * Schema: provisioning
 */

export const ProvisioningRPC = {
  // ── Kits ────────────────────────────────────────────────────────────

  async getKits(filters?: { active?: boolean }) {
    const url = new URL('/api/provisioning/kits', window.location.origin);
    if (filters?.active) url.searchParams.set('active', 'true');
    const res = await fetch(url);
    return res.json();
  },

  async getKit(id: string) {
    const res = await fetch(`/api/provisioning/kits/${id}`);
    return res.json();
  },

  async createKit(payload: {
    name: string;
    description?: string;
    is_active?: boolean;
    lines?: Array<{
      catalog_item_id: string;
      qty?: number;
      is_required?: boolean;
      size_source?: string;
      fixed_variant_attributes?: Record<string, string>;
      provider_id?: string;
      substitute_catalog_item_id?: string;
      sort_order?: number;
    }>;
  }) {
    const res = await fetch('/api/provisioning/kits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async updateKit(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/provisioning/kits/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  // ── Policies ──────────────────────────────────────────────────────

  async getPolicies(filters?: { active?: boolean }) {
    const url = new URL('/api/provisioning/policies', window.location.origin);
    if (filters?.active) url.searchParams.set('active', 'true');
    const res = await fetch(url);
    return res.json();
  },

  async getPolicy(id: string) {
    const res = await fetch(`/api/provisioning/policies/${id}`);
    return res.json();
  },

  async createPolicy(payload: Record<string, unknown>) {
    const res = await fetch('/api/provisioning/policies', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async updatePolicy(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/provisioning/policies/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async evaluatePolicy(payload: {
    trigger_event: string;
    employee: Record<string, unknown>;
  }) {
    const res = await fetch('/api/provisioning/policies/evaluate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  // ── Requests ──────────────────────────────────────────────────────

  async getRequests(filters?: { status?: string; employee_id?: string }) {
    const url = new URL('/api/provisioning/requests', window.location.origin);
    if (filters?.status) url.searchParams.set('status', filters.status);
    if (filters?.employee_id) url.searchParams.set('employee_id', filters.employee_id);
    const res = await fetch(url);
    return res.json();
  },

  async getRequest(id: string) {
    const res = await fetch(`/api/provisioning/requests/${id}`);
    return res.json();
  },

  async createRequest(payload: {
    employee_id: string;
    employee_name?: string;
    trigger_event?: string;
    employee_attributes?: Record<string, unknown>;
    kit_id?: string;
    delivery_method?: string;
    shipping_address?: Record<string, unknown>;
    priority?: number;
    needed_by?: string;
    skip_policy_evaluation?: boolean;
  }) {
    const res = await fetch('/api/provisioning/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async approveRequest(id: string, notes?: string) {
    const res = await fetch(`/api/provisioning/requests/${id}/approve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ notes }),
    });
    return res.json();
  },

  async rejectRequest(id: string, reason: string) {
    const res = await fetch(`/api/provisioning/requests/${id}/reject`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ reason }),
    });
    return res.json();
  },

  async cancelRequest(id: string, reason: string) {
    const res = await fetch(`/api/provisioning/requests/${id}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ reason }),
    });
    return res.json();
  },

  async retryRequest(id: string, lineIds?: string[]) {
    const res = await fetch(`/api/provisioning/requests/${id}/retry`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ line_ids: lineIds }),
    });
    return res.json();
  },

  // ── Line Actions ──────────────────────────────────────────────────

  async issueLine(requestId: string, lineId: string, notes?: string) {
    const res = await fetch(`/api/provisioning/requests/${requestId}/lines/${lineId}/issue`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ notes }),
    });
    return res.json();
  },

  async substituteLine(requestId: string, lineId: string, substituteItemId: string, reason: string) {
    const res = await fetch(`/api/provisioning/requests/${requestId}/lines/${lineId}/substitute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ substitute_catalog_item_id: substituteItemId, reason }),
    });
    return res.json();
  },

  async cancelLine(requestId: string, lineId: string, reason: string) {
    const res = await fetch(`/api/provisioning/requests/${requestId}/lines/${lineId}/cancel`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ reason }),
    });
    return res.json();
  },

  // ── Employee Provisions ───────────────────────────────────────────

  async getEmployeeProvisions(employeeId: string, filters?: { status?: string }) {
    const url = new URL(`/api/provisioning/employees/${employeeId}/provisions`, window.location.origin);
    if (filters?.status) url.searchParams.set('status', filters.status);
    const res = await fetch(url);
    return res.json();
  },

  async returnProvision(employeeId: string, provisionId: string, notes?: string) {
    const res = await fetch(`/api/provisioning/employees/${employeeId}/provisions/${provisionId}/return`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ notes }),
    });
    return res.json();
  },

  // ── Providers ─────────────────────────────────────────────────────

  async getProviders() {
    const res = await fetch('/api/provisioning/providers');
    return res.json();
  },

  async getProvider(id: string) {
    const res = await fetch(`/api/provisioning/providers/${id}`);
    return res.json();
  },

  async createProvider(payload: Record<string, unknown>) {
    const res = await fetch('/api/provisioning/providers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async updateProvider(id: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/provisioning/providers/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async validateProvider(id: string) {
    const res = await fetch(`/api/provisioning/providers/${id}/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({}),
    });
    return res.json();
  },

  async getProviderMappings(providerId: string) {
    const res = await fetch(`/api/provisioning/providers/${providerId}/mappings`);
    return res.json();
  },

  async createProviderMapping(providerId: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/provisioning/providers/${providerId}/mappings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async getProviderProducts(providerId: string) {
    const res = await fetch(`/api/provisioning/providers/${providerId}/products`);
    return res.json();
  },
};
