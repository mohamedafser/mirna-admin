"use server";

import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import { isUuid } from "@/lib/catalogue/validation";
import { parseMinor } from "@/lib/currency/money";
import { createClient } from "@/lib/supabase/server";
import {
  decimalsMatchStripe,
  isCaptured,
  isRefundReason,
  normalizeDomain,
  parsePaymentWindow,
  refundableMinor,
  type RefundStatus,
} from "./rules";
import { getStripe, getStripeMode, isStripeError } from "./stripe";
import { PaymentsNotConfiguredError, syncPaymentIntent } from "./sync";

/**
 * Admin payment actions. Each re-checks the admin session first (RLS checks
 * every database read and write again). Calls to Stripe use the server's
 * secret key; results reach the database only through syncPaymentIntent(),
 * which re-reads Stripe's state, so the order page always matches Stripe.
 */

export type PaymentActionError =
  | "forbidden"
  | "notFound"
  | "notConfigured"
  | "notRefundable"
  | "amountInvalid"
  | "amountTooLarge"
  | "reasonInvalid"
  | "domainInvalid"
  | "conflict"
  | "stripe"
  | "unexpected";

export type PaymentActionResult =
  | { ok: true }
  | {
      ok: false;
      error: PaymentActionError;
      /** Stripe's own message, admins only. */ detail?: string;
    };

function stripeFailure(scope: string, error: unknown): PaymentActionResult {
  if (error instanceof PaymentsNotConfiguredError) return { ok: false, error: "notConfigured" };
  if (isStripeError(error)) {
    console.error(`[payments] ${scope}: ${error.type} ${error.code ?? "-"} ${error.message}`);
    return { ok: false, error: "stripe", detail: error.message };
  }
  console.error(`[payments] ${scope}: ${error instanceof Error ? error.message : error}`);
  return { ok: false, error: "unexpected" };
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/**
 * Refunds all or part of a captured payment through Stripe's API. The amount
 * is checked against what's still refundable (pending refunds included);
 * Stripe checks it again. `requestKey` comes from the dialog (one per
 * opening), so a double submit or a retry after a timeout creates one
 * refund, not two.
 */
export async function refundPayment(input: {
  paymentId: unknown;
  amount: unknown;
  reason: unknown;
  note: unknown;
  requestKey: unknown;
}): Promise<PaymentActionResult> {
  const admin = await getAdminOrNull();
  if (!admin) return { ok: false, error: "forbidden" };
  if (!isUuid(input.paymentId) || !isUuid(input.requestKey))
    return { ok: false, error: "notFound" };
  if (!isRefundReason(input.reason)) return { ok: false, error: "reasonInvalid" };
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";

  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "notConfigured" };

  const supabase = await createClient();
  const { data: payment, error } = await supabase
    .from("payments")
    .select(
      "id, order_id, stripe_payment_intent_id, status, amount_received_minor, currency_code, refunds(amount_minor, status)",
    )
    .eq("id", input.paymentId)
    .maybeSingle();
  if (error) {
    console.error(`[payments] refund lookup failed: ${error.code} ${error.message}`);
    return { ok: false, error: "unexpected" };
  }
  if (!payment) return { ok: false, error: "notFound" };
  if (!isCaptured(payment.status) || payment.status === "REFUNDED") {
    return { ok: false, error: "notRefundable" };
  }

  const { data: currency } = await supabase
    .from("currencies")
    .select("decimals")
    .eq("code", payment.currency_code)
    .maybeSingle();
  const decimals = currency?.decimals ?? 2;
  if (!decimalsMatchStripe(payment.currency_code, decimals)) {
    return { ok: false, error: "amountInvalid" };
  }
  const parsed = parseMinor(typeof input.amount === "string" ? input.amount : "", decimals);
  if (!parsed.ok) return { ok: false, error: "amountInvalid" };

  const refunds = (payment.refunds as { amount_minor: number; status: RefundStatus }[]).map(
    (refund) => ({ amountMinor: BigInt(refund.amount_minor), status: refund.status }),
  );
  const available = refundableMinor(BigInt(payment.amount_received_minor), refunds);
  if (parsed.minor > available) return { ok: false, error: "amountTooLarge" };

  try {
    await stripe.refunds.create(
      {
        payment_intent: payment.stripe_payment_intent_id,
        amount: Number(parsed.minor),
        reason: input.reason,
        metadata: { order_id: payment.order_id, requested_by: admin.id, note },
      },
      { idempotencyKey: `mirna-refund-${input.requestKey}` },
    );
    await syncPaymentIntent(payment.stripe_payment_intent_id);
  } catch (refundError) {
    return stripeFailure("refund", refundError);
  }

  refresh();
  return { ok: true };
}

/** Re-reads a payment from Stripe (e.g. after a webhook outage). */
export async function refreshPayment(paymentId: unknown): Promise<PaymentActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(paymentId)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { data: payment } = await supabase
    .from("payments")
    .select("stripe_payment_intent_id")
    .eq("id", paymentId)
    .maybeSingle();
  if (!payment) return { ok: false, error: "notFound" };

  try {
    await syncPaymentIntent(payment.stripe_payment_intent_id);
  } catch (syncError) {
    return stripeFailure("refresh", syncError);
  }
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * Reads the Stripe account behind STRIPE_SECRET_KEY: can it take charges, in
 * which country, and which currencies Stripe supports there (country_specs).
 * Stored on payment_settings; currencies the account no longer supports are
 * switched off, and so is Stripe if the account can't take charges.
 */
export async function verifyStripeAccount(): Promise<PaymentActionResult> {
  const admin = await getAdminOrNull();
  if (!admin) return { ok: false, error: "forbidden" };
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "notConfigured" };

  let account;
  let supported: string[];
  try {
    account = await stripe.accounts.retrieveCurrent();
    if (!account.country) return { ok: false, error: "stripe", detail: "Account has no country." };
    const spec = await stripe.countrySpecs.retrieve(account.country);
    supported = spec.supported_payment_currencies.map((code) => code.toUpperCase()).sort();
  } catch (error) {
    return stripeFailure("verify account", error);
  }

  const supabase = await createClient();
  const { data: current, error: readError } = await supabase
    .from("payment_settings")
    .select("stripe_enabled, enabled_currencies")
    .maybeSingle();
  if (readError || !current) return { ok: false, error: readError ? "unexpected" : "notFound" };

  const enabled = current.enabled_currencies.filter((code) => supported.includes(code));
  // charges_enabled describes LIVE payments. Test-mode payments work on any
  // account (even one not activated yet), so a test key can always charge.
  const livemode = getStripeMode() === "live";
  const canCharge = livemode ? account.charges_enabled : true;
  const { error } = await supabase
    .from("payment_settings")
    .update({
      stripe_account_id: account.id,
      stripe_account_country: account.country.toUpperCase(),
      stripe_livemode: livemode,
      stripe_charges_enabled: canCharge,
      stripe_supported_currencies: supported,
      stripe_verified_at: new Date().toISOString(),
      enabled_currencies: enabled,
      stripe_enabled: current.stripe_enabled && canCharge && enabled.length > 0,
      updated_by: admin.id,
    })
    .eq("id", true);
  if (error) {
    console.error(`[payments] save verification failed: ${error.code} ${error.message}`);
    return { ok: false, error: error.code === "42501" ? "forbidden" : "unexpected" };
  }
  refresh();
  return { ok: true };
}

export type PaymentSettingsField = "currencies" | "window" | "enable";
export type PaymentSettingsFieldError =
  | "currencyUnsupported"
  | "currencyInactive"
  | "currencyDecimals"
  | "currenciesRequired"
  | "windowInvalid"
  | "notVerified"
  | "chargesDisabled"
  | "webhookMissing";

export interface PaymentSettingsResult {
  status: "idle" | "success" | "error";
  error?: PaymentActionError;
  fieldErrors: Partial<Record<PaymentSettingsField, PaymentSettingsFieldError>>;
  /** Currency codes behind a currency error. */
  codes?: string[];
  at: number;
}

function settingsResult(
  status: PaymentSettingsResult["status"],
  extra: Partial<PaymentSettingsResult> = {},
): PaymentSettingsResult {
  return { status, fieldErrors: {}, ...extra, at: Date.now() };
}

/**
 * Saves Stripe on/off, the currencies customers may pay in and the payment
 * window. A currency is accepted only if the store sells in it, Stripe
 * supports it for this account, and its decimals match Stripe's (otherwise
 * amounts would be off by a factor of ten). Stripe can only be switched on
 * once the account is verified, can take charges, and the webhook secret is
 * configured (without webhooks no payment would ever be confirmed).
 * Optimistic concurrency: only the version the admin loaded is updated.
 */
export async function savePaymentSettings(
  _prev: PaymentSettingsResult,
  data: FormData,
): Promise<PaymentSettingsResult> {
  const admin = await getAdminOrNull();
  if (!admin) return settingsResult("error", { error: "forbidden" });

  const version = String(data.get("updatedAt") ?? "");
  const enable = data.get("stripeEnabled") === "on";
  const codes = [...new Set(data.getAll("currencies").map(String))].filter((code) =>
    /^[A-Z]{3}$/.test(code),
  );
  const window = parsePaymentWindow(String(data.get("paymentWindow") ?? ""));

  const supabase = await createClient();
  const [{ data: current, error: readError }, { data: currencies, error: currencyError }] =
    await Promise.all([
      supabase
        .from("payment_settings")
        .select(
          "updated_at, stripe_charges_enabled, stripe_supported_currencies, stripe_verified_at",
        )
        .maybeSingle(),
      supabase.from("currencies").select("code, decimals, is_active"),
    ]);
  if (readError || currencyError) return settingsResult("error", { error: "unexpected" });
  if (!current) return settingsResult("error", { error: "notFound" });
  if (current.updated_at !== version) return settingsResult("error", { error: "conflict" });

  const fieldErrors: PaymentSettingsResult["fieldErrors"] = {};
  let badCodes: string[] = [];
  const store = new Map((currencies ?? []).map((c) => [c.code, c]));
  const unsupported = codes.filter((code) => !current.stripe_supported_currencies.includes(code));
  const inactive = codes.filter((code) => !store.get(code)?.is_active);
  const wrongDecimals = codes.filter((code) => {
    const currency = store.get(code);
    return currency && !decimalsMatchStripe(code, currency.decimals);
  });
  if (unsupported.length) {
    fieldErrors.currencies = "currencyUnsupported";
    badCodes = unsupported;
  } else if (inactive.length) {
    fieldErrors.currencies = "currencyInactive";
    badCodes = inactive;
  } else if (wrongDecimals.length) {
    fieldErrors.currencies = "currencyDecimals";
    badCodes = wrongDecimals;
  } else if (enable && codes.length === 0) {
    fieldErrors.currencies = "currenciesRequired";
  }
  if (window === null) fieldErrors.window = "windowInvalid";
  if (enable) {
    if (!current.stripe_verified_at) fieldErrors.enable = "notVerified";
    else if (!current.stripe_charges_enabled) fieldErrors.enable = "chargesDisabled";
    else if (!process.env.STRIPE_WEBHOOK_SECRET) fieldErrors.enable = "webhookMissing";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return settingsResult("error", { fieldErrors, codes: badCodes });
  }

  const { data: updated, error } = await supabase
    .from("payment_settings")
    .update({
      stripe_enabled: enable,
      enabled_currencies: codes.sort(),
      payment_window_minutes: window ?? 60,
      updated_by: admin.id,
    })
    .eq("id", true)
    .eq("updated_at", version)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error(`[payments] save settings failed: ${error.code} ${error.message}`);
    return settingsResult("error", { error: error.code === "42501" ? "forbidden" : "unexpected" });
  }
  if (!updated) return settingsResult("error", { error: "conflict" });

  refresh();
  return settingsResult("success");
}

// ---------------------------------------------------------------------------
// Apple Pay (payment method domains)
// ---------------------------------------------------------------------------

/**
 * Registers the storefront's domain with Stripe, which is what Apple Pay in
 * the Payment Element needs (Stripe handles Apple's merchant validation; no
 * file has to be hosted). Registering a domain that already exists just
 * re-validates it.
 */
export async function registerPaymentDomain(rawDomain: unknown): Promise<PaymentActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  const domain = typeof rawDomain === "string" ? normalizeDomain(rawDomain) : null;
  if (!domain) return { ok: false, error: "domainInvalid" };
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "notConfigured" };

  try {
    const existing = (await stripe.paymentMethodDomains.list({ domain_name: domain, limit: 1 }))
      .data[0];
    if (existing) {
      if (!existing.enabled)
        await stripe.paymentMethodDomains.update(existing.id, { enabled: true });
      await stripe.paymentMethodDomains.validate(existing.id);
    } else {
      await stripe.paymentMethodDomains.create({ domain_name: domain, enabled: true });
    }
  } catch (error) {
    return stripeFailure("register domain", error);
  }
  refresh();
  return { ok: true };
}

/** Asks Stripe to check a registered domain again (e.g. after a DNS / HTTPS fix). */
export async function validatePaymentDomain(id: unknown): Promise<PaymentActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (typeof id !== "string" || !/^pmd_[A-Za-z0-9]+$/.test(id)) {
    return { ok: false, error: "notFound" };
  }
  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "notConfigured" };
  try {
    await stripe.paymentMethodDomains.validate(id);
  } catch (error) {
    return stripeFailure("validate domain", error);
  }
  refresh();
  return { ok: true };
}
