import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { compare, hash } from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts'

type DeviceAnnounceRequest = {
  device_id?: string
  fingerprint?: string
  firmware_version?: string
  capabilities?: Record<string, unknown>
  telemetry?: Record<string, unknown>
  device_type?: string
  api_key?: string
  device_secret?: string
}

type DeviceAnnounceResponse = {
  device_id: string
  status: string
  claim_code?: string
  expires_at?: string
  tenant_id?: string | null
  latest_config?: {
    version: number
    config: Record<string, unknown>
  } | null
}

const CLAIM_TTL_SECONDS = 120
const CLAIM_CODE_LENGTH = 8
const CLAIM_CODE_GROUP = 4

/**
 * Shared endpoint secret — must be set in Edge Function secrets.
 * Devices include this in the X-Device-Announce-Key header.
 * This prevents unauthenticated registration from the open internet.
 */
const ANNOUNCE_SECRET = Deno.env.get('DEVICE_ANNOUNCE_SECRET')

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // Endpoint-level auth: reject requests without the shared announce key
  if (ANNOUNCE_SECRET) {
    const provided = req.headers.get('x-device-announce-key')
    if (provided !== ANNOUNCE_SECRET) {
      return new Response(
        JSON.stringify({ error: 'Invalid or missing X-Device-Announce-Key header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      )
    }
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response('Server misconfigured', { status: 500 })
  }

  let payload: DeviceAnnounceRequest
  try {
    payload = await req.json()
  } catch (_err) {
    return new Response('Invalid JSON', { status: 400 })
  }

  const deviceType = payload.device_type ?? 'handheld_cycle_count'
  const ipAddress = req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? null

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })

  const inventory = supabase.schema('inventory')

  let deviceId = payload.device_id
  let deviceRow: any = null

  if (deviceId) {
    const { data, error } = await inventory
      .from('rfid_devices')
      .select('*')
      .eq('id', deviceId)
      .maybeSingle()

    if (error) {
      return jsonError('Failed to load device', error, 500)
    }

    deviceRow = data
  } else if (payload.fingerprint) {
    const { data, error } = await inventory
      .from('rfid_devices')
      .select('*')
      .eq('fingerprint', payload.fingerprint)
      .maybeSingle()

    if (error) {
      return jsonError('Failed to load device by fingerprint', error, 500)
    }

    deviceRow = data
    deviceId = data?.id
  }

  if (!deviceId) {
    deviceId = crypto.randomUUID()
  }

  const nowIso = new Date().toISOString()

  if (deviceRow) {
    const authError = await verifyDeviceAuth(payload, deviceRow)
    if (authError) {
      return new Response(authError, { status: 401 })
    }

    const updatePayload: Record<string, unknown> = {
      last_seen_at: nowIso,
      last_ip_address: ipAddress,
      updated_at: nowIso
    }

    if (payload.fingerprint) {
      updatePayload.fingerprint = payload.fingerprint
    }

    if (payload.firmware_version) {
      updatePayload.firmware_version = payload.firmware_version
    }

    if (payload.capabilities) {
      updatePayload.capabilities = payload.capabilities
    }

    if (!deviceRow.tenant_id) {
      updatePayload.status = 'unassigned'
    }

    if (!deviceRow.api_key_hash && !deviceRow.device_secret_hash && payload.device_secret) {
      updatePayload.device_secret_hash = await hash(payload.device_secret)
    }

    const { data, error } = await inventory
      .from('rfid_devices')
      .update(updatePayload)
      .eq('id', deviceId)
      .select('*')
      .maybeSingle()

    if (error) {
      return jsonError('Failed to update device', error, 500)
    }

    deviceRow = data
  } else {
    if (!payload.device_secret) {
      return new Response('Device secret required', { status: 401 })
    }

    const insertPayload = {
      id: deviceId,
      device_code: payload.fingerprint ?? deviceId,
      device_type: deviceType,
      status: 'unassigned',
      fingerprint: payload.fingerprint ?? null,
      firmware_version: payload.firmware_version ?? null,
      capabilities: payload.capabilities ?? null,
      last_seen_at: nowIso,
      last_ip_address: ipAddress,
      device_secret_hash: await hash(payload.device_secret)
    }

    const { data, error } = await inventory
      .from('rfid_devices')
      .insert(insertPayload)
      .select('*')
      .single()

    if (error) {
      return jsonError('Failed to create device', error, 500)
    }

    deviceRow = data
  }

  if (deviceRow.status === 'suspended' || deviceRow.status === 'disabled') {
    return jsonResponse(
      {
        device_id: deviceRow.id,
        status: deviceRow.status,
        tenant_id: deviceRow.tenant_id ?? null
      },
      403
    )
  }

  const response: DeviceAnnounceResponse = {
    device_id: deviceRow.id,
    status: deviceRow.status,
    tenant_id: deviceRow.tenant_id ?? null
  }

  const unclaimed = !deviceRow.tenant_id || deviceRow.status === 'unassigned'

  if (unclaimed) {
    const { data: existingCode, error: codeError } = await inventory
      .from('rfid_device_claim_codes')
      .select('code, expires_at')
      .eq('device_id', deviceRow.id)
      .is('consumed_at', null)
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (codeError) {
      return jsonError('Failed to check claim code', codeError, 500)
    }

    if (existingCode?.code) {
      response.claim_code = existingCode.code
      response.expires_at = existingCode.expires_at
      return jsonResponse(response)
    }

    const claim = await createClaimCode(inventory, deviceRow.id, nowIso)

    if ('error' in claim) {
      return jsonError('Failed to create claim code', claim.error, 500)
    }

    response.claim_code = claim.code
    response.expires_at = claim.expires_at
  }

  if (deviceRow.status === 'active') {
    const { data: latestConfig, error: configError } = await inventory
      .from('rfid_device_configs')
      .select('version, config')
      .eq('device_id', deviceRow.id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (configError) {
      return jsonError('Failed to load device config', configError, 500)
    }

    response.latest_config = latestConfig
      ? { version: latestConfig.version, config: latestConfig.config as Record<string, unknown> }
      : null
  }

  return jsonResponse(response)
})

async function createClaimCode(
  inventory: ReturnType<typeof createClient>['schema'],
  deviceId: string,
  nowIso: string
): Promise<{ code: string; expires_at: string } | { error: unknown }> {
  const expiresAt = new Date(Date.now() + CLAIM_TTL_SECONDS * 1000).toISOString()

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateClaimCode()

    const { data, error } = await inventory
      .from('rfid_device_claim_codes')
      .insert({
        device_id: deviceId,
        code,
        expires_at: expiresAt,
        created_at: nowIso
      })
      .select('code, expires_at')
      .single()

    if (!error && data) {
      return { code: data.code, expires_at: data.expires_at }
    }
  }

  return { error: new Error('Unable to generate unique claim code') }
}

function generateClaimCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''

  for (let i = 0; i < CLAIM_CODE_LENGTH; i += 1) {
    const idx = Math.floor(Math.random() * alphabet.length)
    out += alphabet[idx]
  }

  return `${out.slice(0, CLAIM_CODE_GROUP)}-${out.slice(CLAIM_CODE_GROUP)}`
}

async function verifyDeviceAuth(
  payload: DeviceAnnounceRequest,
  deviceRow: Record<string, any>
): Promise<string | null> {
  if (deviceRow.api_key_hash) {
    if (!payload.api_key) {
      return 'API key required'
    }

    const ok = await compare(payload.api_key, deviceRow.api_key_hash)
    return ok ? null : 'Invalid API key'
  }

  if (deviceRow.device_secret_hash) {
    if (!payload.device_secret) {
      return 'Device secret required'
    }

    const ok = await compare(payload.device_secret, deviceRow.device_secret_hash)
    return ok ? null : 'Invalid device secret'
  }

  if (payload.device_secret) {
    return null
  }

  return 'Device secret required'
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function jsonError(message: string, error: unknown, status = 400): Response {
  return new Response(
    JSON.stringify({ error: message, detail: String(error) }),
    { status, headers: { 'Content-Type': 'application/json' } }
  )
}
