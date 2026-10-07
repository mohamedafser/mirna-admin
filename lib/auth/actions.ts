"use server";

import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { defaultLocale, isLocale, type Locale } from "@/config/i18n";
import { createClient } from "@/lib/supabase/server";
import { REDIRECT_PARAM, safeAdminRedirect } from "./redirect";
import { hasErrors, normalizeEmail, validateLogin, type LoginFieldErrors } from "./validation";

export type SignInError =
  | "invalidCredentials"
  | "emailNotConfirmed"
  | "accountInactive"
  | "notAdmin"
  | "tooManyAttempts"
  | "network"
  | "unexpected";

export interface SignInState {
  error: SignInError | null;
  fieldErrors: LoginFieldErrors;
  email: string;
}

function localeFrom(formData: FormData): Locale {
  // Server Actions can't read root params, so the locale is posted and re-validated.
  const value = formData.get("locale");
  return isLocale(value) ? value : defaultLocale;
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const locale = localeFrom(formData);
  const email = normalizeEmail(formData.get("email"));
  const password = String(formData.get("password") ?? "");

  const fieldErrors = validateLogin(email, password);
  if (hasErrors(fieldErrors) || password.length > 256) {
    return { error: null, fieldErrors, email };
  }

  const fail = (error: SignInError): SignInState => ({ error, fieldErrors: {}, email });
  const supabase = await createClient();

  // 1. Authenticate. Errors are mapped to safe, user-facing codes; "wrong
  //    password" and "no such user" share one message (no user enumeration).
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (isAuthRetryableFetchError(error)) return fail("network");
    switch (error.code) {
      case "invalid_credentials":
        return fail("invalidCredentials");
      // Only returned after the password was verified, so it reveals nothing
      // to someone who doesn't already know the credentials.
      case "email_not_confirmed":
        return fail("emailNotConfirmed");
      case "user_banned":
        return fail("accountInactive");
      case "over_request_rate_limit":
        return fail("tooManyAttempts");
    }
    if (error.status === 429) return fail("tooManyAttempts");
    console.error("[auth] sign-in failed", { code: error.code, status: error.status });
    return fail("unexpected");
  }

  // 2. Authorize before letting the session stand: only active admins may keep
  //    an admin-app session. Anyone else is signed straight back out.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  const denial: SignInError | null = profileError
    ? "unexpected"
    : !profile?.is_active
      ? "accountInactive"
      : profile.role !== "ADMIN"
        ? "notAdmin"
        : null;

  if (denial) {
    if (profileError) console.error("[auth] profile lookup failed", { code: profileError.code });
    await supabase.auth.signOut();
    return fail(denial);
  }

  redirect(safeAdminRedirect(formData.get(REDIRECT_PARAM), locale));
}

export async function signOut(formData: FormData): Promise<void> {
  const locale = localeFrom(formData);

  const supabase = await createClient();
  // scope "local": ends this device's session and clears its auth cookies.
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) console.error("[auth] sign-out failed", { code: error.code, status: error.status });

  redirect(`/${locale}/login`);
}
