import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Client-side Supabase client factory
// Creates a new client instance with user session
// Note: Use API routes for inventory schema access (permission denied on direct queries)
export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

