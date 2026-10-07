import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import type { Locale } from "@/config/i18n";
import { createClient } from "@/lib/supabase/server";
import type { CurrentUser } from "@/types/domain";

/**
 * Data Access Layer: the server-side authorization boundary for the app.
 * proxy.ts only does an optimistic "is there a session?" redirect; every
 * admin page, Server Action and Route Handler must call requireAdmin().
 *
 * The role always comes from the `profiles` table (read under RLS), never from
 * the client, user metadata or the email address. getCurrentUser() is
 * memoised per request, so the shell, user menu and page share one
 * auth check + one profile query.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  // Session checks compare token expiry with the current time, so they must
  // always run at request time (never during prerendering).
  await connection();
  const supabase = await createClient();

  // Verifies the JWT signature (not just decodes the cookie).
  const { data: auth, error: authError } = await supabase.auth.getClaims();
  if (authError || !auth?.claims.sub) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("full_name, role, is_active")
    .eq("id", auth.claims.sub)
    .maybeSingle();

  if (error) {
    // Supabase unreachable or misconfigured: fail closed and let the error
    // boundary show a generic retry screen (details are logged, not shown).
    console.error("[auth] failed to load profile", { code: error.code });
    throw new Error("Unable to verify account permissions");
  }

  return {
    id: auth.claims.sub,
    email: typeof auth.claims.email === "string" ? auth.claims.email : null,
    fullName: profile?.full_name ?? null,
    // A missing profile is treated as an inactive customer (denied).
    role: profile?.role ?? "CUSTOMER",
    isActive: profile?.is_active ?? false,
  };
});

export type AdminAccess = "granted" | "inactive" | "notAdmin";

export function getAdminAccess(user: CurrentUser): AdminAccess {
  if (!user.isActive) return "inactive";
  return user.role === "ADMIN" ? "granted" : "notAdmin";
}

export function isAdmin(user: CurrentUser | null): boolean {
  return user !== null && getAdminAccess(user) === "granted";
}

/** Signed-in user or redirect to the login page. */
export async function requireUser(locale: Locale): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  return user;
}

/** Active ADMIN or redirect (login if signed out, access-denied otherwise). */
export async function requireAdmin(locale: Locale): Promise<CurrentUser> {
  const user = await requireUser(locale);
  if (!isAdmin(user)) redirect(`/${locale}/access-denied`);
  return user;
}

/**
 * For Server Actions that return a result instead of redirecting: the active
 * admin, or null. RLS still re-checks every write in the database.
 */
export async function getAdminOrNull(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  return isAdmin(user) ? user : null;
}
