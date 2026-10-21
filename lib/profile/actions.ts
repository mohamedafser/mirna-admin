"use server";

import {
  createClient as createStatelessClient,
  isAuthRetryableFetchError,
} from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import { getSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import {
  readPassword,
  readProfile,
  validatePassword,
  validateProfile,
  type PasswordFieldErrors,
  type ProfileFieldErrors,
  type ProfileInput,
} from "./rules";

export type ProfileFormError = "forbidden" | "tooManyAttempts" | "network" | "unexpected";

export interface ProfileFormState {
  status: "idle" | "success" | "error";
  error?: ProfileFormError;
  fieldErrors: ProfileFieldErrors;
  /** Echoed back so the form keeps the admin's input after a failed submit. */
  values?: ProfileInput;
  /** Changes on every submit, so the client can react to each result. */
  at: number;
}

export interface PasswordFormState {
  status: "idle" | "success" | "error";
  error?: ProfileFormError;
  fieldErrors: PasswordFieldErrors;
  at: number;
}

/**
 * Saves the admin's own name and phone with their own session: RLS
 * (profiles_update_own_or_admin), the column grant and the CHECK constraints
 * decide too. Role and active status are not touched (and the guard trigger
 * refuses self-changes anyway).
 */
export async function updateProfile(
  _prev: ProfileFormState,
  data: FormData,
): Promise<ProfileFormState> {
  const at = Date.now();
  const user = await getAdminOrNull();
  if (!user) return { status: "error", error: "forbidden", fieldErrors: {}, at };

  const values = readProfile(data);
  const fieldErrors = validateProfile(values);
  if (Object.keys(fieldErrors).length > 0) return { status: "error", fieldErrors, values, at };

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: values.fullName, phone: values.phone || null })
    .eq("id", user.id);
  if (error) {
    console.error("[profile] update failed", { code: error.code });
    return { status: "error", error: "unexpected", fieldErrors: {}, values, at };
  }

  // The header avatar and user menu show the name too.
  refresh();
  return { status: "success", fieldErrors: {}, values, at };
}

/**
 * Changes the admin's password. The current password is checked first with
 * a throwaway client that keeps no session (so the admin's cookies are never
 * replaced), then the new one is set on the admin's own session.
 */
export async function changePassword(
  _prev: PasswordFormState,
  data: FormData,
): Promise<PasswordFormState> {
  const at = Date.now();
  const fail = (patch: Partial<PasswordFormState>): PasswordFormState => ({
    status: "error",
    fieldErrors: {},
    ...patch,
    at,
  });

  const user = await getAdminOrNull();
  if (!user?.email) return fail({ error: "forbidden" });

  const input = readPassword(data);
  const fieldErrors = validatePassword(input);
  if (input.currentPassword.length > 256) fieldErrors.currentPassword = "currentWrong";
  if (Object.keys(fieldErrors).length > 0) return fail({ fieldErrors });

  const { url, publishableKey } = getSupabaseEnv();
  const verifier = createStatelessClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: verified, error: verifyError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: input.currentPassword,
  });
  if (verifyError) {
    if (isAuthRetryableFetchError(verifyError)) return fail({ error: "network" });
    if (verifyError.code === "invalid_credentials") {
      return fail({ fieldErrors: { currentPassword: "currentWrong" } });
    }
    if (verifyError.status === 429) return fail({ error: "tooManyAttempts" });
    console.error("[profile] password check failed", { code: verifyError.code });
    return fail({ error: "unexpected" });
  }
  // The check opened a second session on the Auth server; close it (only
  // that session, the admin's own stays signed in).
  await verifier.auth.signOut({ scope: "local" });
  if (verified.user.id !== user.id) return fail({ error: "forbidden" });

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: input.password });
  if (error) {
    if (isAuthRetryableFetchError(error)) return fail({ error: "network" });
    switch (error.code) {
      case "same_password":
        return fail({ fieldErrors: { password: "passwordSame" } });
      case "weak_password":
        return fail({ fieldErrors: { password: "passwordWeak" } });
      case "over_request_rate_limit":
        return fail({ error: "tooManyAttempts" });
    }
    console.error("[profile] password update failed", { code: error.code, status: error.status });
    return fail({ error: "unexpected" });
  }

  return { status: "success", fieldErrors: {}, at };
}
