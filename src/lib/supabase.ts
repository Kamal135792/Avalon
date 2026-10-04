import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: { identity: string | undefined; client: SupabaseClient } | null = null;

export function createSupabaseClient(sessionId?: string): SupabaseClient {
  if (typeof window !== "undefined" && cached && cached.identity === sessionId) return cached.client;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";

  if (!supabaseUrl || !supabaseAnonKey) {
    // Avoid throwing on import; surface a readable error on first request.
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).",
    );
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: sessionId ? { "x-session-id": sessionId } : {},
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(15000),
        }),
    },
  });
  if (typeof window !== "undefined") cached = { identity: sessionId, client };
  return client;
}
