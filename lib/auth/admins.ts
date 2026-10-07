import "server-only";
import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import type { AdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Administrator accounts: listing and provisioning.
 *
 * Creating a user needs the service-role client (Auth admin API). Promoting
 * the new profile to ADMIN uses whichever client the caller passes:
 *   - "Add administrator": the signed-in admin's session client, so the
 *     database itself (RLS + profiles_guard_update) verifies the caller.
 *   - First-admin setup: the service-role client (no admin exists yet to
 *     vouch for it; the setup token is checked before we get here).
 */

export interface AdminAccount {
  id: string;
  fullName: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: string;
}

export type CreateAdminError = "emailTaken" | "passwordWeak" | "network" | "unexpected";

export async function hasAnyAdmin(admin: AdminClient): Promise<boolean> {
  // A one-row select (not a HEAD count), so failures carry PostgREST's error body.
  const { data, error, status } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "ADMIN")
    .limit(1);

  if (error) {
    // Details are inlined as text: the dev overlay doesn't always show objects.
    console.error(
      `[admins] admin check failed: status=${status} code=${error.code || "-"} message=${error.message || "-"} hint=${error.hint || "-"}`,
    );
    throw new Error("Unable to check for existing administrators");
  }
  return data.length > 0;
}

/** All ADMIN profiles (oldest first) with their sign-in email. */
export async function listAdmins(admin: AdminClient): Promise<AdminAccount[]> {
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("id, full_name, is_active, created_at")
    .eq("role", "ADMIN")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[admins] list failed", { code: error.code, message: error.message });
    throw new Error("Unable to load administrators");
  }

  // Emails live in auth.users. Admins are few, so one lookup each is fine.
  const users = await Promise.all(profiles.map(({ id }) => admin.auth.admin.getUserById(id)));

  return profiles.map((profile, index) => ({
    id: profile.id,
    fullName: profile.full_name,
    email: users[index].data.user?.email ?? null,
    isActive: profile.is_active,
    createdAt: profile.created_at,
  }));
}

/**
 * Creates a confirmed auth user (they can sign in immediately) and promotes
 * its auto-created CUSTOMER profile to ADMIN. If promotion fails the user is
 * deleted again, so no half-created account is left behind.
 */
export async function createAdminAccount(
  admin: AdminClient,
  promoteWith: SupabaseClient<Database>,
  account: { email: string; password: string; fullName: string },
): Promise<
  | { ok: true; userId: string }
  /** `detail` is technical (status/code/message): for logs and dev-only display. */
  | { ok: false; error: CreateAdminError; detail: string }
> {
  const { data, error } = await admin.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    // Copied to profiles.full_name by the on_auth_user_created trigger.
    user_metadata: { full_name: account.fullName },
  });

  if (error) {
    const detail = `create user: status=${error.status} code=${error.code || "-"} message=${error.message || "-"}`;
    // Inlined as text: the dev overlay doesn't always show logged objects.
    console.error(`[admins] ${detail}`);
    // auth-js also reports HTTP 5xx as "retryable"; only status 0 means the
    // request never reached Supabase.
    if (isAuthRetryableFetchError(error) && !error.status) {
      return { ok: false, error: "network", detail };
    }
    switch (error.code) {
      case "email_exists":
      case "user_already_exists":
        return { ok: false, error: "emailTaken", detail };
      case "weak_password":
        return { ok: false, error: "passwordWeak", detail };
    }
    return { ok: false, error: "unexpected", detail };
  }

  const userId = data.user.id;
  const { error: promoteError } = await promoteWith
    .from("profiles")
    .update({ role: "ADMIN" })
    .eq("id", userId)
    // .single() turns "no row updated" (e.g. blocked by RLS) into an error.
    .select("id")
    .single();

  if (promoteError) {
    const detail = `promote to ADMIN: code=${promoteError.code || "-"} message=${promoteError.message || "-"}`;
    console.error(`[admins] ${detail}; rolling back user`);
    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) {
      console.error(`[admins] rollback failed: user=${userId} code=${deleteError.code || "-"}`);
    }
    return { ok: false, error: "unexpected", detail };
  }

  return { ok: true, userId };
}
