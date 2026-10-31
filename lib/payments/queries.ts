import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { PaymentStatus, RefundStatus } from "./rules";
import { getStripe, getStripeMode, isStripeError } from "./stripe";

/**
 * Payment reads for the admin app. Stored payments, refunds and webhook
 * events are read with the signed-in admin's session (RLS: admins only, all
 * read-only for API roles). The Stripe account check on the Payments page
 * calls Stripe with the server's secret key; the key never leaves the server.
 */

export interface OrderPayment {
  id: string;
  stripe_payment_intent_id: string;
  status: PaymentStatus;
  amount: string;
  amount_minor: number;
  amount_received_minor: number;
  amount_refunded_minor: number;
  currency_code: string;
  stripe_status: string | null;
  stripe_charge_id: string | null;
  payment_method_type: string | null;
  wallet: string | null;
  card_brand: string | null;
  card_last4: string | null;
  failure_code: string | null;
  failure_message: string | null;
  livemode: boolean;
  paid_at: string | null;
  failed_at: string | null;
  canceled_at: string | null;
  created_at: string;
  refunds: OrderRefund[];
}

export interface OrderRefund {
  id: string;
  stripe_refund_id: string;
  status: RefundStatus;
  amount: string;
  amount_minor: number;
  reason: string | null;
  note: string | null;
  failure_reason: string | null;
  created_at: string;
  requested_by_profile: { full_name: string | null } | null;
}

export interface PaymentEvent {
  stripe_event_id: string;
  event_type: string;
  outcome: string | null;
  detail: string | null;
  stripe_created_at: string;
}

export interface OrderPayments {
  payments: OrderPayment[];
  events: PaymentEvent[];
  /** The order currency's decimals (for refund amounts). */
  decimals: number;
}

function fail(scope: string, error: { code?: string; message?: string }): never {
  console.error(
    `[payments] ${scope} failed: code=${error.code || "-"} message=${error.message || "-"}`,
  );
  throw new Error(`Unable to load ${scope}`);
}

/** Missing table: migration 044 hasn't been applied yet. */
function isMissingSchema(error: { code?: string }) {
  return ["42P01", "PGRST200", "PGRST205"].includes(error.code ?? "");
}

/** An order's payments (newest first) with their refunds, and its webhook history. */
export const getOrderPayments = cache(
  async (orderId: string, currencyCode: string): Promise<OrderPayments | null> => {
    const supabase = await createClient();
    const [payments, events, currency] = await Promise.all([
      supabase
        .from("payments")
        .select(
          `id, stripe_payment_intent_id, status, amount::text, amount_minor, amount_received_minor,
           amount_refunded_minor, currency_code, stripe_status, stripe_charge_id,
           payment_method_type, wallet, card_brand, card_last4, failure_code, failure_message,
           livemode, paid_at, failed_at, canceled_at, created_at,
           refunds(id, stripe_refund_id, status, amount::text, amount_minor, reason, note,
                   failure_reason, created_at, requested_by_profile:profiles(full_name))`,
        )
        .eq("order_id", orderId)
        .order("created_at", { ascending: false })
        .order("created_at", { referencedTable: "refunds", ascending: false }),
      supabase
        .from("payment_events")
        .select("stripe_event_id, event_type, outcome, detail, stripe_created_at")
        .eq("order_id", orderId)
        .order("stripe_created_at", { ascending: false })
        .limit(50),
      supabase.from("currencies").select("decimals").eq("code", currencyCode).maybeSingle(),
    ]);
    if (payments.error) {
      if (isMissingSchema(payments.error)) return null;
      fail("payments", payments.error);
    }
    if (events.error) fail("payment events", events.error);
    return {
      payments: payments.data as unknown as OrderPayment[],
      events: events.data,
      decimals: currency.data?.decimals ?? 2,
    };
  },
);

export interface PaymentSettings {
  stripe_enabled: boolean;
  enabled_currencies: string[];
  payment_window_minutes: number;
  stripe_account_id: string | null;
  stripe_account_country: string | null;
  stripe_livemode: boolean | null;
  stripe_charges_enabled: boolean;
  stripe_supported_currencies: string[];
  stripe_verified_at: string | null;
  updated_at: string;
}

/** The payment_settings row, or null before migration 044. */
export async function getPaymentSettings(): Promise<PaymentSettings | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payment_settings")
    .select(
      `stripe_enabled, enabled_currencies, payment_window_minutes, stripe_account_id,
       stripe_account_country, stripe_livemode, stripe_charges_enabled,
       stripe_supported_currencies, stripe_verified_at, updated_at`,
    )
    .maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return null;
    fail("payment settings", error);
  }
  return data;
}

export interface PaymentDomain {
  id: string;
  domain: string;
  enabled: boolean;
  applePay: "active" | "inactive" | string;
  applePayError: string | null;
  livemode: boolean;
}

export interface StripeOverview {
  mode: "live" | "test" | null;
  /** Each env var only as "set / not set", never its value. */
  secretKey: boolean;
  webhookSecret: boolean;
  cronSecret: boolean;
  /** The storefront domain from STOREFRONT_URL, suggested for Apple Pay. */
  storefrontDomain: string | null;
  domains: PaymentDomain[] | null;
  /** Stripe couldn't be reached or rejected the key. */
  error: string | null;
}

/** Live checks against Stripe for the Payments page (each call is cheap and read-only). */
export async function getStripeOverview(): Promise<StripeOverview> {
  const stripe = getStripe();
  let storefrontDomain: string | null = null;
  try {
    storefrontDomain = process.env.STOREFRONT_URL
      ? new URL(process.env.STOREFRONT_URL).hostname
      : null;
  } catch {
    storefrontDomain = null;
  }
  const overview: StripeOverview = {
    mode: getStripeMode(),
    secretKey: stripe !== null,
    webhookSecret: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    cronSecret: Boolean(process.env.CRON_SECRET),
    storefrontDomain,
    domains: null,
    error: null,
  };
  if (!stripe) return overview;

  try {
    const domains = await stripe.paymentMethodDomains.list({ limit: 100 });
    overview.domains = domains.data.map((domain) => ({
      id: domain.id,
      domain: domain.domain_name,
      enabled: domain.enabled,
      applePay: domain.apple_pay.status,
      applePayError: domain.apple_pay.status_details?.error_message ?? null,
      livemode: domain.livemode,
    }));
  } catch (error) {
    overview.error = isStripeError(error) ? error.message : "Stripe could not be reached.";
    console.error(`[payments] Stripe overview failed: ${overview.error}`);
  }
  return overview;
}
