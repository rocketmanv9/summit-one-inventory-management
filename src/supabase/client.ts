import { createClient as createSupabaseClient, SupabaseClient } from "@supabase/supabase-js";

// Singleton instance
let client: SupabaseClient | null = null;

// Client-side Supabase client factory
// Returns singleton instance to avoid multiple GoTrueClient warnings
// Note: Use API routes for inventory schema access (permission denied on direct queries)
export function createClient() {
  if (!client) {
    client = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return client;
}

