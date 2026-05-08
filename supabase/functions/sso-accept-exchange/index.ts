// @deno-types="https://deno.land/std@0.168.0/http/server.ts"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @deno-types="https://esm.sh/@supabase/supabase-js@2"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as jose from "https://deno.land/x/jose@v4.11.2/index.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const JWT_SECRET = Deno.env.get("SUPABASE_JWT_SECRET")!;

const CORE_URL = Deno.env.get("CORE_SUPABASE_URL")!;
const CORE_ANON = Deno.env.get("CORE_SUPABASE_ANON_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    }});
  }

  try {
    const { exchange_token } = await req.json();

    if (!exchange_token) {
      return new Response(
        JSON.stringify({ error: "Missing exchange_token" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 1) Verify the exchange token with Core
    const core = createClient(CORE_URL, CORE_ANON);
    const { data: validation, error: valErr } = await core.functions.invoke(
      "sso-validate-exchange",
      { body: { exchange_token, target_service: "inventory" } }
    );

    if (valErr || !validation?.valid) {
      console.error("Exchange validation failed:", valErr);
      return new Response(
        JSON.stringify({ error: "Invalid exchange token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    const { user_id, tenant_id, email, user_metadata } = validation;

    // 2) Check if user exists in YOUR database
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const { data: existingUser } = await supabase.auth.admin.getUserById(user_id);

    if (!existingUser?.user) {
      // Create user in YOUR Supabase project
      const { error: createErr } = await supabase.auth.admin.createUser({
        id: user_id,
        email,
        email_confirm: true,
        user_metadata: {
          ...user_metadata,
          tenant_id,
        },
      });

      if (createErr) {
        console.error("Failed to create user:", createErr);
        return new Response(
          JSON.stringify({ error: "Failed to create user" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    // 3) Generate JWT for YOUR app
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: user_id,
      email,
      tenant_id, // ✅ Critical for RLS
      aud: "authenticated",
      role: "authenticated",
      iat: now,
      exp: now + 60 * 60 * 24 * 7, // 7 days
    };

    const secret = new TextEncoder().encode(JWT_SECRET);
    const access_token = await new jose.SignJWT(payload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .sign(secret);

    // Generate a distinct refresh token with longer expiry
    const refreshPayload = {
      sub: user_id,
      email,
      tenant_id,
      aud: "authenticated",
      role: "authenticated",
      type: "refresh",
      session_id: crypto.randomUUID(),
      iat: now,
      exp: now + 60 * 60 * 24 * 30, // 30 days
    };
    const refresh_token = await new jose.SignJWT(refreshPayload)
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .sign(secret);

    return new Response(
      JSON.stringify({
        access_token,
        refresh_token,
        user: {
          id: user_id,
          email,
          tenant_id,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("sso-accept-exchange error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
