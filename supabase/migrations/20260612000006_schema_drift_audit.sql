-- Schema-drift tripwire: lint every plpgsql function/trigger against the
-- LIVE schema and flag known-dangerous source patterns.
--
-- Motivation: receiving was broken by seven stacked bugs (missing columns,
-- wrong JWT claim path, constraint-violating values) that all hid behind a
-- swallowed error. plpgsql_check catches the schema-reference class
-- statically; the regex checks catch the two recurring source patterns
-- (positional emit_event calls, root-only JWT tenant reads).
--
-- Requires: CREATE EXTENSION plpgsql_check (installed in extensions schema).
-- Called by /api/system/cron/schema-drift-audit nightly.

CREATE OR REPLACE FUNCTION public.rpc_schema_drift_audit()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_lint jsonb;
  v_patterns jsonb;
BEGIN
  -- 1. plpgsql_check over plain functions and triggers (per attached table).
  --    Errors only — warnings are too noisy to page on.
  WITH plain AS (
    SELECT p.oid::regprocedure::text AS fn, cf.message
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    CROSS JOIN LATERAL extensions.plpgsql_check_function_tb(p.oid) cf
    WHERE n.nspname IN ('inventory','supply_chain','public')
      AND l.lanname = 'plpgsql' AND p.prokind = 'f'
      AND p.prorettype <> 'trigger'::regtype
      AND p.proname NOT LIKE 'plpgsql_check%'
      AND p.proname <> 'rpc_schema_drift_audit'
      AND cf.level = 'error'
  ), trig AS (
    SELECT DISTINCT p.oid::regprocedure::text || ' [on ' || t.tgrelid::regclass::text || ']' AS fn, cf.message
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL extensions.plpgsql_check_function_tb(p.oid, t.tgrelid) cf
    WHERE NOT t.tgisinternal
      AND n.nspname IN ('inventory','supply_chain','public')
      AND cf.level = 'error'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('fn', fn, 'message', message) ORDER BY fn), '[]'::jsonb)
  INTO v_lint
  FROM (SELECT * FROM plain UNION ALL SELECT * FROM trig) findings;

  -- 2. Dangerous source patterns plpgsql_check can't see.
  WITH src AS (
    SELECT p.oid::regprocedure::text AS fn, p.prosrc
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname IN ('inventory','supply_chain','public')
      AND l.lanname = 'plpgsql' AND p.prokind = 'f'
      AND p.proname <> 'rpc_schema_drift_audit'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('fn', fn, 'pattern', pattern) ORDER BY fn), '[]'::jsonb)
  INTO v_patterns
  FROM (
    -- Positional emit_event call: ambiguous between the two overloads.
    SELECT fn, 'positional emit_event call (ambiguous overloads — use p_type := named args)' AS pattern
    FROM src WHERE prosrc ~* 'emit_event\s*\(\s*'''
    UNION ALL
    -- Root-only JWT tenant read: app JWTs carry tenant_id in app_metadata.
    SELECT fn, 'reads auth.jwt()->>''tenant_id'' without app_metadata fallback' AS pattern
    FROM src
    WHERE prosrc LIKE '%auth.jwt() ->> ''tenant_id''%'
      AND prosrc NOT LIKE '%app_metadata%'
  ) p;

  RETURN jsonb_build_object(
    'checked_at', now(),
    'lint_error_count', jsonb_array_length(v_lint),
    'pattern_finding_count', jsonb_array_length(v_patterns),
    'lint_errors', v_lint,
    'pattern_findings', v_patterns
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_schema_drift_audit() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_schema_drift_audit() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_schema_drift_audit() TO service_role;
