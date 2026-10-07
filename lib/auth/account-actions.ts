"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { defaultLocale, isLocale, type Locale } from "@/config/i18n";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createAdminAccount, hasAnyAdmin, type CreateAdminError } from "./admins";
import { requireAdmin } from "./dal";
import {
  readNewAccount,
  validateNewAccount,
  type NewAccountFieldErrors,
  type NewAccountInput,
} from "./validation";

export type AccountFormError = CreateAdminError | "setupClosed" | "notConfigured";

export interface AccountFormState {
  error: AccountFormError | null;
  fieldErrors: NewAccountFieldErrors;
  /** Echoed back so the form keeps them after a failed submit (never passwords). */
  values: { fullName: string; email: string };
  /** Set after "Add administrator" succeeds. */
  createdEmail: string | null;
  /** Technical cause of `error`; only sent in development. */
  detail?: string;
}

const devDetail = (detail: string) => (process.env.NODE_ENV === "development" ? detail : undefined);

function localeFrom(formData: FormData): Locale {
  // Server Actions can't read root params, so the locale is posted and re-validated.
  const value = formData.get("locale");
  return isLocale(value) ? value : defaultLocale;
}

function stateFor(input: NewAccountInput, patch: Partial<AccountFormState> = {}): AccountFormState {
  return {
    error: null,
    fieldErrors: {},
    values: { fullName: input.fullName, email: input.email },
    createdEmail: null,
    ...patch,
  };
}

/** Constant-time comparison (hashing first makes the lengths equal). */
function tokenMatches(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * One-time setup: creates the first administrator, then signs them in.
 * Requires ADMIN_SETUP_TOKEN and refuses once any admin exists.
 */
export async function setupFirstAdmin(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const locale = localeFrom(formData);
  const input = readNewAccount(formData);
  // Always treat this form as having a setup token, even if the field was stripped.
  input.setupToken ??= "";

  const fieldErrors = validateNewAccount(input);
  if (Object.keys(fieldErrors).length > 0) return stateFor(input, { fieldErrors });

  const expectedToken = process.env.ADMIN_SETUP_TOKEN;
  const admin = createAdminClient();
  if (!expectedToken || !admin) return stateFor(input, { error: "notConfigured" });

  if (!tokenMatches(input.setupToken, expectedToken)) {
    return stateFor(input, { fieldErrors: { setupToken: "setupTokenInvalid" } });
  }

  try {
    if (await hasAnyAdmin(admin)) return stateFor(input, { error: "setupClosed" });
  } catch (error) {
    return stateFor(input, { error: "unexpected", detail: devDetail(String(error)) });
  }

  const result = await createAdminAccount(admin, admin, input);
  if (!result.ok) {
    return stateFor(input, { error: result.error, detail: devDetail(result.detail) });
  }

  // Sign the new admin straight in; fall back to the login page if that fails.
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });
  if (error) {
    console.error("[setup] auto sign-in failed", { code: error.code, status: error.status });
    redirect(`/${locale}/login`);
  }
  redirect(`/${locale}/admin`);
}

/** Signed-in admins create another administrator account. */
export async function addAdmin(
  _prev: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const locale = localeFrom(formData);
  await requireAdmin(locale);

  const input = readNewAccount(formData);
  input.setupToken = undefined;

  const fieldErrors = validateNewAccount(input);
  if (Object.keys(fieldErrors).length > 0) return stateFor(input, { fieldErrors });

  const admin = createAdminClient();
  if (!admin) return stateFor(input, { error: "notConfigured" });

  // Promote through the caller's own session so the database re-checks that
  // they really are an active admin.
  const supabase = await createClient();
  const result = await createAdminAccount(admin, supabase, input);
  if (!result.ok) {
    return stateFor(input, { error: result.error, detail: devDetail(result.detail) });
  }

  refresh();
  return {
    error: null,
    fieldErrors: {},
    values: { fullName: "", email: "" },
    createdEmail: input.email,
  };
}
