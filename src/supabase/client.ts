import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Client-side Supabase client factory
// Creates a new client instance with user session
export function createClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
