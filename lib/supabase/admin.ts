import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getSupabaseEnv } from "./env";

/**
 * Service-role Supabase client: BYPASSES RLS. Server-only, used solely for
 * Auth admin operations (creating users) and the first-admin setup check.
 * Everything else must go through the user's session client (server.ts).
 *
 * The key is read from SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix, so
 * it is never inlined into client bundles). Returns null when not configured.
 */
export function createAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) return null;

  const { url } = getSupabaseEnv();
  return createClient<Database>(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

export type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;
