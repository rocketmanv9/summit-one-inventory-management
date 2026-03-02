-- ============================================================
-- Migration: Schedule Events Poller Cron Job
-- Purpose: Set up automatic polling of events_outbox table
-- ============================================================

-- NOTE: This migration provides a pg_cron fallback for environments
-- where Edge Function cron scheduling is not available.
--
-- For Supabase hosted platform, Edge Function cron is configured
-- in supabase/config.toml [[edge_runtime.crons]] section.
--
-- This pg_cron job is a backup mechanism for self-hosted or
-- environments where you prefer database-level scheduling.

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA cron TO postgres;

-- Unschedule any existing job with this name (idempotent)
SELECT cron.unschedule('poll-inventory-events')
WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'poll-inventory-events'
);

-- Schedule the events poller to run every minute
-- This calls the Edge Function via HTTP POST
-- NOTE: Replace the URL with your actual Supabase project URL
-- NOTE: Replace the Authorization header with your service role key
--
-- For production, use environment variables or Vault:
-- SELECT cron.schedule(
--     'poll-inventory-events',
--     '* * * * *',
--     $$SELECT net.http_post(
--         url := current_setting('app.supabase_url') || '/functions/v1/events-poller',
--         headers := jsonb_build_object(
--             'Authorization', 'Bearer ' || current_setting('app.service_role_key')
--         )
--     )$$
-- );

-- ALTERNATIVE: Direct database function call (if you prefer not to use Edge Functions)
-- This directly processes events without going through the Edge Function.
-- Uncomment this approach if you want pure database-level processing:

/*
SELECT cron.schedule(
    'poll-inventory-events-db',
    '* * * * *',
    $$
    DO $$
    DECLARE
        v_event RECORD;
        v_processed INT := 0;
        v_failed INT := 0;
    BEGIN
        -- Process up to 100 pending events
        FOR v_event IN
            SELECT * FROM public.poll_inventory_events(100, 5)
        LOOP
            BEGIN
                -- Here you would implement your event publishing logic
                -- For now, we'll just mark events as published
                -- In production, you'd send to webhook, message queue, etc.

                -- Example: Mark as published (replace with actual webhook call)
                PERFORM public.update_event_status(
                    p_event_id := v_event.id,
                    p_status := 'published',
                    p_published_at := now()
                );

                v_processed := v_processed + 1;

            EXCEPTION WHEN OTHERS THEN
                -- Log error and mark for retry
                PERFORM public.update_event_status(
                    p_event_id := v_event.id,
                    p_status := 'pending',
                    p_retry_count := v_event.retry_count + 1,
                    p_last_error := SQLERRM
                );

                v_failed := v_failed + 1;
            END;
        END LOOP;

        -- Log results
        RAISE NOTICE 'Events poller: processed %, failed %', v_processed, v_failed;
    END $$;
    $$
);
*/

-- ============================================================
-- Documentation
-- ============================================================

COMMENT ON EXTENSION pg_cron IS
    'pg_cron: Job scheduler for PostgreSQL. Used to schedule the events-poller job.

     IMPORTANT: This is a FALLBACK mechanism. The primary scheduling method is
     Supabase Edge Function cron (configured in config.toml).

     To view scheduled jobs:
         SELECT * FROM cron.job;

     To view job run history:
         SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;

     To manually trigger the poller (for testing):
         CALL cron.schedule(''test-poll'', ''now'', $$SELECT public.poll_inventory_events(10, 5)$$);

     To unschedule:
         SELECT cron.unschedule(''poll-inventory-events'');';

-- ============================================================
-- Verification Query
-- ============================================================

-- Run this to verify the cron job is scheduled:
-- SELECT * FROM cron.job WHERE jobname = 'poll-inventory-events';

-- ============================================================
-- DEPLOYMENT INSTRUCTIONS
-- ============================================================

-- For Supabase Hosted (Recommended):
-- 1. The [[edge_runtime.crons]] config in config.toml handles scheduling
-- 2. No manual cron job creation needed
-- 3. This migration is skipped/no-op on Supabase platform
--
-- For Self-Hosted or Local Dev:
-- 1. Ensure EVENTS_WEBHOOK_URL environment variable is set in Edge Function
-- 2. Uncomment the appropriate SELECT cron.schedule() block above
-- 3. Replace placeholders with actual URLs and credentials
-- 4. Consider using Vault for secrets instead of hardcoding
