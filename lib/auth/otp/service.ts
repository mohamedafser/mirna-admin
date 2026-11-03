import "server-only";
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { Locale } from "@/config/i18n";
import { isSmtpConfigured, sendEmail } from "@/lib/email/smtp";
import { describeError } from "@/lib/notifications/rules";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import {
  generateCode,
  generateResetToken,
  hashBinding,
  hashCode,
  hashIp,
  hashResetToken,
} from "./crypto";
import { renderOtpEmail, type OtpPurpose } from "./email";

/**
 * One-time codes for customer sign-up and password reset; the database rules
 * are in migration 046. To avoid revealing which emails have accounts, every
 * request does the same visible work: it records a code and answers. Looking up
 * the account, creating it and emailing the code all happen after the response
 * (`after`), so neither the answer nor its timing depends on the account. The
 * cost is that a mail failure can't be reported to the customer, who can resend;
 * it is logged. Logs never contain a code, a password or an email address.
 */

const LOG = "[auth-otp]";

export type OtpContext = { admin: AdminClient; secret: string };

/** Null unless everything needed is configured (never depends on the email). */
export function otpContext(): OtpContext | null {
  const secret = process.env.AUTH_OTP_SECRET;
  const admin = createAdminClient();
  if (!secret || !admin || !isSmtpConfigured()) return null;
  return { admin, secret };
}

interface Account {
  user_id: string;
  email_confirmed: boolean;
  role: string | null;
  is_active: boolean;
}

async function findAccount(admin: AdminClient, email: string): Promise<Account | null> {
  const { data, error } = await admin.rpc("auth_otp_find_account", { p_email: email });
  if (error) throw error;
  return (data as Account[])[0] ?? null;
}

/** Staff use mirna-admin; only active customers have storefront codes. */
const isActiveCustomer = (account: Account | null): account is Account =>
  account !== null && account.role === "CUSTOMER" && account.is_active;

async function storeName(admin: AdminClient): Promise<string> {
  const { data, error } = await admin.from("store_settings").select("store_name").maybeSingle();
  if (error) console.warn(`${LOG} store settings unavailable: ${describeError(error)}`);
  return data?.store_name || "Mirna";
}

export interface RequestInput {
  purpose: OtpPurpose;
  email: string;
  locale: Locale;
  binding: string;
  ip: string | null;
  /** "Resend" from the code page: only for the browser that made the latest request. */
  resend: boolean;
  /** Sign-up details. Absent on a resend, or when a known customer signs in unverified. */
  password: string | null;
  fullName: string | null;
}

export type RequestResult = { status: "sent" } | { status: "rate_limited"; retryAfter: number };

export async function requestOtp(ctx: OtpContext, input: RequestInput): Promise<RequestResult> {
  const { admin, secret } = ctx;
  const code = generateCode();
  const { data, error } = await admin.rpc("auth_otp_issue", {
    p_email: input.email,
    p_purpose: input.purpose,
    p_code_hash: hashCode(secret, input.purpose, input.email, code),
    p_binding_hash: hashBinding(secret, input.binding),
    p_ip_hash: input.ip ? hashIp(secret, input.ip) : null,
    p_resend: input.resend,
  });
  if (error) throw error;

  const result = data as { status: "issued" | "skipped" | "rate_limited"; retry_after?: number };
  if (result.status === "rate_limited") {
    return { status: "rate_limited", retryAfter: result.retry_after ?? 60 };
  }
  if (result.status === "issued") after(() => deliverOtp(admin, input, code));
  return { status: "sent" };
}

/** Prepares the account and emails the code; if there's nothing to do, the code goes nowhere. */
async function deliverOtp(admin: AdminClient, input: RequestInput, code: string): Promise<void> {
  try {
    const account = await findAccount(admin, input.email);
    const shouldSend =
      input.purpose === "signup"
        ? await prepareSignup(admin, input, account)
        : isActiveCustomer(account);
    if (!shouldSend) return;

    await sendEmail({
      ...renderOtpEmail({
        locale: input.locale,
        purpose: input.purpose,
        storeName: await storeName(admin),
        code,
      }),
      to: input.email,
      id: `auth-otp-${randomUUID()}`,
    });
    console.info(`${LOG} ${input.purpose} code sent`);
  } catch (error) {
    console.error(`${LOG} ${input.purpose} code not sent: ${describeError(error)}`);
  }
}

/**
 * Makes sure an unverified account holds the latest details. It can't be used
 * until verified. An already verified account is left alone, whatever was typed.
 */
async function prepareSignup(
  admin: AdminClient,
  { email, password, fullName }: RequestInput,
  account: Account | null,
): Promise<boolean> {
  if (!account) {
    if (!password) return false;
    const { error } = await admin.auth.admin.createUser({
      email,
      password,
      // The on_auth_user_created trigger makes the CUSTOMER profile, taking
      // only full_name from this metadata.
      user_metadata: { full_name: fullName },
      email_confirm: false,
    });
    if (error) throw error;
    return true;
  }

  if (account.email_confirmed || !isActiveCustomer(account)) return false;
  if (password) {
    const { error } = await admin.auth.admin.updateUserById(account.user_id, {
      password,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    const { error: nameError } = await admin.rpc("auth_otp_set_pending_name", {
      p_user_id: account.user_id,
      p_full_name: fullName ?? "",
    });
    if (nameError) throw nameError;
  }
  return true;
}

export type VerifyResult =
  | { status: "invalid" | "expired" | "locked" }
  /** Signup: signs the browser in, when a sign-in token could be made. */
  | { status: "ok"; purpose: "signup"; sessionTokenHash: string | null }
  | { status: "ok"; purpose: "recovery"; resetToken: string };

export async function verifyOtp(
  { admin, secret }: OtpContext,
  input: { purpose: OtpPurpose; email: string; code: string; binding: string },
): Promise<VerifyResult> {
  const resetToken = generateResetToken();
  const { data, error } = await admin.rpc("auth_otp_verify", {
    p_email: input.email,
    p_purpose: input.purpose,
    p_code_hash: hashCode(secret, input.purpose, input.email, input.code),
    p_binding_hash: hashBinding(secret, input.binding),
    p_reset_token_hash: hashResetToken(secret, resetToken),
  });
  if (error) throw error;

  const { status } = data as { status: "ok" | "invalid" | "expired" | "locked" };
  if (status !== "ok") return { status };

  // The account may have been deactivated since the code was sent.
  const account = await findAccount(admin, input.email);
  if (!isActiveCustomer(account)) return { status: "invalid" };

  if (input.purpose === "recovery") return { status: "ok", purpose: "recovery", resetToken };

  const { error: confirmError } = await admin.auth.admin.updateUserById(account.user_id, {
    email_confirm: true,
  });
  if (confirmError) throw confirmError;

  // Generating a link sends nothing: the storefront exchanges its hash for a
  // session on its own server. If that fails the customer just signs in.
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: input.email,
  });
  if (linkError) console.warn(`${LOG} sign-in token failed: ${describeError(linkError)}`);
  return {
    status: "ok",
    purpose: "signup",
    sessionTokenHash: link?.properties?.hashed_token ?? null,
  };
}

export type ResetResult = { status: "ok" | "expired" | "weak_password" };

export async function resetPassword(
  { admin, secret }: OtpContext,
  input: { resetToken: string; password: string },
): Promise<ResetResult> {
  const tokenHash = hashResetToken(secret, input.resetToken);
  const { data: email, error } = await admin.rpc("auth_otp_claim_reset", {
    p_token_hash: tokenHash,
  });
  if (error) throw error;
  if (!email) return { status: "expired" };

  const release = () => admin.rpc("auth_otp_release_reset", { p_token_hash: tokenHash });
  try {
    const account = await findAccount(admin, email);
    if (!isActiveCustomer(account)) return { status: "expired" };

    // Receiving the code has proved the mailbox, which also verifies the email.
    const { error: updateError } = await admin.auth.admin.updateUserById(account.user_id, {
      password: input.password,
      email_confirm: true,
    });
    if (updateError) {
      await release();
      if (updateError.code === "weak_password") return { status: "weak_password" };
      throw updateError;
    }

    const { data: signedOut, error: finishError } = await admin.rpc("auth_otp_finish_reset", {
      p_token_hash: tokenHash,
      p_user_id: account.user_id,
    });
    if (finishError) {
      console.error(`${LOG} couldn't finish reset: ${describeError(finishError)}`);
    } else if (!signedOut) {
      console.error(`${LOG} couldn't end the account's sessions after a reset`);
    }
    return { status: "ok" };
  } catch (cause) {
    await release();
    throw cause;
  }
}
