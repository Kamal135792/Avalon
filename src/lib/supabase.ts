import { createClient, SupabaseClient } from "@supabase/supabase-js";

export function createSupabaseClient(sessionId?: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";

  if (!supabaseUrl || !supabaseAnonKey) {
    // Avoid throwing on import; surface a readable error on first request.
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)."
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: sessionId ? { "x-session-id": sessionId } : {},
    },
  });
}
