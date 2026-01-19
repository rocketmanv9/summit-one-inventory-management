// ================================================================
// Events Poller Edge Function
// ================================================================
// Purpose: Poll events_outbox table and publish events to downstream
//          systems via webhooks or message queues
// Schedule: Runs every minute via cron
// ================================================================

/// <reference types="https://esm.sh/@types/deno@1.38.0/index.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const BATCH_SIZE = 100
const MAX_ATTEMPTS = 5

interface OutboxEvent {
  id: string
  tenant_id: string
  scope: string
  event_type: string
  aggregate_type: string
  aggregate_id: string
  payload: Record<string, any>
  metadata: Record<string, any>
  status: string
  retry_count: number
  created_at: string
  last_error?: string
}

Deno.serve(async (req) => {
  const startTime = Date.now()
  
  // Initialize Supabase client with service role key (bypasses RLS)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  
  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  })

  console.log('[POLLER] Starting event polling cycle...')

  // ================================================================
  // STEP 1: Select pending events with row locking
  // ================================================================
  
  // Using public schema wrapper function that calls inventory.poll_pending_events
  const { data: events, error: selectError } = await supabase
    .rpc('poll_inventory_events', {
      p_batch_size: BATCH_SIZE,
      p_max_attempts: MAX_ATTEMPTS
    })

  if (selectError) {
    console.error('[POLLER] Error selecting events:', selectError)
    return new Response(
      JSON.stringify({ error: 'Failed to select events', details: selectError }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }

  if (!events || events.length === 0) {
    console.log('[POLLER] No pending events found')
    return new Response(
      JSON.stringify({ processed: 0, failed: 0, duration_ms: Date.now() - startTime }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  }

  console.log(`[POLLER] Found ${events.length} pending events`)

  // ================================================================
  // STEP 2: Process each event
  // ================================================================
  
  let processed = 0
  let failed = 0

  for (const event of events as OutboxEvent[]) {
    try {
      console.log(`[POLLER] Processing event ${event.id} (${event.event_type})`)
      
      // Publish event to downstream system
      const published = await publishEvent(event)
      
      if (published) {
        // Mark as published
        const { error: updateError } = await supabase
          .rpc('update_event_status', {
            p_event_id: event.id,
            p_status: 'published',
            p_published_at: new Date().toISOString()
          })
        
        if (updateError) {
          console.error(`[POLLER] Error marking event ${event.id} as published:`, updateError)
        } else {
          console.log(`[POLLER] ✅ Event ${event.id} published successfully`)
          processed++
        }
      } else {
        throw new Error('Publish returned false')
      }
    } catch (err) {
      // Increment retry count and log error
      const errorMessage = err instanceof Error ? err.message : String(err)
      const newRetryCount = event.retry_count + 1
      const newStatus = newRetryCount >= MAX_ATTEMPTS ? 'failed' : 'pending'
      
      console.error(`[POLLER] ❌ Error processing event ${event.id}:`, errorMessage)
      
      const { error: updateError } = await supabase
        .rpc('update_event_status', {
          p_event_id: event.id,
          p_status: newStatus,
          p_retry_count: newRetryCount,
          p_last_error: errorMessage.substring(0, 1000)
        })
      
      if (updateError) {
        console.error(`[POLLER] Error updating retry count for event ${event.id}:`, updateError)
      }
      
      failed++
    }
  }

  const duration = Date.now() - startTime
  console.log(`[POLLER] Cycle complete: ${processed} processed, ${failed} failed (${duration}ms)`)

  return new Response(
    JSON.stringify({ 
      processed, 
      failed, 
      duration_ms: duration,
      batch_size: events.length 
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  )
})

// ================================================================
// HELPER: Publish Event
// ================================================================

async function publishEvent(event: OutboxEvent): Promise<boolean> {
  const webhookUrl = Deno.env.get('EVENTS_WEBHOOK_URL')
  
  // In development/test, just log the event
  if (!webhookUrl || webhookUrl === 'none') {
    console.log('[POLLER] [DEV MODE] Would publish event:', {
      id: event.id,
      type: event.event_type,
      tenant: event.tenant_id,
      aggregate: `${event.aggregate_type}:${event.aggregate_id}`
    })
    return true
  }

  // Production: POST to webhook endpoint
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Event-Type': event.event_type,
        'X-Tenant-ID': event.tenant_id,
        'X-Event-ID': event.id, // For idempotency on receiver side
        'X-Aggregate-Type': event.aggregate_type,
        'X-Aggregate-ID': event.aggregate_id,
        'User-Agent': 'Summit-One-Inventory-Events-Poller/1.0'
      },
      body: JSON.stringify({
        id: event.id,
        event_type: event.event_type,
        aggregate_type: event.aggregate_type,
        aggregate_id: event.aggregate_id,
        tenant_id: event.tenant_id,
        scope: event.scope,
        payload: event.payload,
        metadata: event.metadata,
        created_at: event.created_at
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Webhook returned ${response.status}: ${errorText}`)
    }

    console.log(`[POLLER] Event ${event.id} published to ${webhookUrl}`)
    return true
  } catch (err) {
    console.error(`[POLLER] Failed to publish event ${event.id}:`, err)
    throw err
  }
}
