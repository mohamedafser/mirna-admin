import "server-only";
import { after } from "next/server";
import { isLocale, type Locale } from "@/config/i18n";
import type { CurrencyCode } from "@/config/region";
import { isSmtpConfigured, sendEmail } from "@/lib/email/smtp";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { AddressSnapshot, ShippingSnapshot } from "@/lib/orders/queries";
import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import type { OrderStatus } from "@/types/domain";
import { renderOrderEmail, type OrderEmailData } from "./order-email";
import { afterFailure, describeError, isStale, MAX_ATTEMPTS } from "./rules";

/**
 * Sends what's waiting in order_notifications (migration 045, whose triggers
 * record every order status change). Runs on the server only, after the order
 * has already been saved, so a mail problem can't affect the order: failures
 * are logged and retried with a backoff, and this function never throws.
 *
 * It runs right after a status change in this app (scheduleOrderEmails()) and
 * every minute from a scheduler (app/api/orders/notifications/route.ts), which
 * picks up orders placed on the storefront and retries. Both can overlap:
 * claim_order_notifications() never hands the same row to two workers.
 */

const BATCH_SIZE = 5;
/** Stop claiming after this long, leaving the rest for the next run. */
const TIME_BUDGET_MS = 25_000;
const LOG = "[order-emails]";

export interface DeliverySummary {
  configured: boolean;
  sent: number;
  skipped: number;
  retrying: number;
  failed: number;
}

interface Claimed {
  id: string;
  order_id: string;
  status: OrderStatus;
  attempts: number;
  created_at: string;
}

interface OrderForEmail {
  order_number: number;
  user_id: string | null;
  payment_status: string | null;
  subtotal: string;
  discount: string;
  shipping: string;
  tax: string;
  total: string;
  currency_code: string;
  created_at: string;
  shipping_address_snapshot: AddressSnapshot | null;
  shipping_snapshot: ShippingSnapshot | null;
  account: { full_name: string | null } | null;
  items: {
    product_name: string;
    sku: string;
    quantity: number;
    unit_price: string;
    total_price: string;
  }[];
}

interface StoreForEmail {
  storeName: string;
  locale: Locale;
  timeZone: string | undefined;
  contactEmail: string | null;
  contactPhone: string | null;
}

/** Stops a row from being sent, and says why (no account, no email, …). */
class SkipEmail extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

async function loadStore(admin: AdminClient): Promise<StoreForEmail> {
  const { data, error } = await admin
    .from("store_settings")
    .select("store_name, default_locale, timezone, contact_email, contact_phone, contact_published")
    .maybeSingle();
  // The email still goes out, with the defaults.
  if (error) console.warn(`${LOG} store settings unavailable: ${describeError(error)}`);
  const published = data?.contact_published === true;
  return {
    storeName: data?.store_name || "Mirna",
    locale: data && isLocale(data.default_locale) ? data.default_locale : "en",
    timeZone: data?.timezone,
    // Only what the store has chosen to show customers.
    contactEmail: published ? (data?.contact_email ?? null) : null,
    contactPhone: published ? (data?.contact_phone ?? null) : null,
  };
}

async function loadOrder(admin: AdminClient, orderId: string): Promise<OrderForEmail> {
  const { data, error } = await admin
    .from("orders")
    .select(
      `order_number, user_id, payment_status, subtotal::text, discount::text, shipping::text,
       tax::text, total::text, currency_code, created_at, shipping_address_snapshot,
       shipping_snapshot, account:profiles(full_name),
       items:order_items(product_name, sku, quantity, unit_price::text, total_price::text, created_at)`,
    )
    .eq("id", orderId)
    .order("created_at", { referencedTable: "order_items", ascending: true })
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new SkipEmail("order_not_found");
  return data as unknown as OrderForEmail;
}

/** The email of the customer account that owns the order, from Supabase Auth. */
async function customerEmail(admin: AdminClient, userId: string | null): Promise<string> {
  // The account was deleted (orders.user_id is SET NULL).
  if (!userId) throw new SkipEmail("no_account");
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    if (error.status === 404) throw new SkipEmail("no_account");
    throw error;
  }
  const email = data.user?.email?.trim();
  if (!email) throw new SkipEmail("no_email");
  return email;
}

function isPositive(amount: string): boolean {
  return Number(amount) > 0;
}

function storefrontOrderUrl(orderId: string, locale: Locale): string | null {
  const base = process.env.STOREFRONT_URL?.trim();
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return new URL(`/${locale}/account/orders/${orderId}`, url.origin).toString();
  } catch {
    return null;
  }
}

function addressLines(address: AddressSnapshot | null): string[] {
  if (!address) return [];
  const clean = (parts: (string | null | undefined)[], separator: string) =>
    parts
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(separator);
  return [
    address.full_name?.trim(),
    clean([address.apartment, address.building, address.street], ", "),
    clean([address.area, address.city, address.state_region, address.postal_code], ", "),
    address.country_code,
  ].filter((line): line is string => Boolean(line));
}

function deliveryDays(locale: Locale, shipping: ShippingSnapshot | null): string | null {
  const min = shipping?.min_delivery_days;
  const max = shipping?.max_delivery_days;
  if (typeof min !== "number" || typeof max !== "number") return null;
  const number = (value: number) => value.toLocaleString(locale);
  return min === max ? number(min) : `${number(min)}–${number(max)}`;
}

function buildEmailData(
  orderId: string,
  status: OrderStatus,
  order: OrderForEmail,
  store: StoreForEmail,
): OrderEmailData {
  const { locale } = store;
  const money = (amount: string) =>
    formatCurrency(amount, order.currency_code as CurrencyCode, locale);
  const address = order.shipping_address_snapshot;
  // A delivery estimate means nothing once the order has ended.
  const stillOnItsWay = status !== "DELIVERED" && status !== "CANCELLED" && status !== "REFUNDED";
  return {
    locale,
    status,
    storeName: store.storeName,
    customerName: order.account?.full_name?.trim() || address?.full_name?.trim() || null,
    orderNumber: order.order_number,
    placedAt: formatDateTime(order.created_at, locale, { dateStyle: "long" }, store.timeZone),
    awaitingPayment: order.payment_status === "PENDING" || order.payment_status === "FAILED",
    items: order.items.map((item) => ({
      name: item.product_name,
      sku: item.sku,
      quantity: item.quantity.toLocaleString(locale),
      unitPrice: money(item.unit_price),
      total: money(item.total_price),
    })),
    subtotal: money(order.subtotal),
    discount: isPositive(order.discount) ? money(order.discount) : null,
    tax: isPositive(order.tax) ? money(order.tax) : null,
    shipping: money(order.shipping),
    total: money(order.total),
    shippingMethod: order.shipping_snapshot?.method_code ?? null,
    deliveryDays: stillOnItsWay ? deliveryDays(locale, order.shipping_snapshot) : null,
    addressLines: addressLines(address),
    orderUrl: storefrontOrderUrl(orderId, locale),
    contactEmail: store.contactEmail,
    contactPhone: store.contactPhone,
  };
}

async function finish(
  admin: AdminClient,
  id: string,
  fields: {
    state: "PENDING" | "SENT" | "FAILED" | "SKIPPED";
    last_error?: string | null;
    next_attempt_at?: string;
    sent_at?: string;
  },
): Promise<void> {
  const update = () =>
    admin
      .from("order_notifications")
      .update({ locked_at: null, ...fields })
      .eq("id", id)
      .eq("state", "SENDING");
  // Worth a second try: if a sent email can't be marked SENT, it's sent again.
  const { error } = await update();
  if (!error) return;
  const retry = await update();
  if (retry.error) {
    console.error(
      `${LOG} couldn't record ${fields.state} for ${id}: ${describeError(retry.error)}`,
    );
  }
}

async function deliverOne(
  admin: AdminClient,
  row: Claimed,
  store: StoreForEmail,
  summary: DeliverySummary,
): Promise<void> {
  let orderNumber: number | string = row.order_id;
  try {
    if (isStale(row.created_at)) throw new SkipEmail("stale");
    const order = await loadOrder(admin, row.order_id);
    orderNumber = order.order_number;
    const to = await customerEmail(admin, order.user_id);
    const email = renderOrderEmail(buildEmailData(row.order_id, row.status, order, store));
    await sendEmail({ ...email, to, id: `order-status-${row.id}` });

    await finish(admin, row.id, {
      state: "SENT",
      sent_at: new Date().toISOString(),
      last_error: null,
    });
    summary.sent += 1;
    console.info(`${LOG} order #${orderNumber} ${row.status}: sent`);
  } catch (error) {
    if (error instanceof SkipEmail) {
      await finish(admin, row.id, { state: "SKIPPED", last_error: error.reason });
      summary.skipped += 1;
      console.warn(`${LOG} order #${orderNumber} ${row.status}: skipped (${error.reason})`);
      return;
    }
    const reason = describeError(error);
    const decision = afterFailure(row.attempts);
    if (decision.state === "FAILED") {
      await finish(admin, row.id, { state: "FAILED", last_error: reason });
      summary.failed += 1;
    } else {
      await finish(admin, row.id, {
        state: "PENDING",
        next_attempt_at: decision.nextAttemptAt,
        last_error: reason,
      });
      summary.retrying += 1;
    }
    console.error(
      `${LOG} order #${orderNumber} ${row.status}: failed, attempt ${row.attempts}/${MAX_ATTEMPTS}, ${decision.state === "FAILED" ? "giving up" : "will retry"} (${reason})`,
    );
  }
}

let warnedNotConfigured = false;

export async function deliverOrderEmails(): Promise<DeliverySummary> {
  const summary: DeliverySummary = {
    configured: false,
    sent: 0,
    skipped: 0,
    retrying: 0,
    failed: 0,
  };
  try {
    const admin = createAdminClient();
    if (!admin || !isSmtpConfigured()) {
      // Rows stay queued, without using up attempts, until SMTP is set.
      if (!warnedNotConfigured) {
        warnedNotConfigured = true;
        console.warn(`${LOG} not sending: SMTP_* or SUPABASE_SERVICE_ROLE_KEY is not configured`);
      }
      return summary;
    }
    summary.configured = true;

    const startedAt = Date.now();
    let store: StoreForEmail | null = null;
    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data, error } = await admin.rpc("claim_order_notifications", {
        p_limit: BATCH_SIZE,
      });
      if (error) throw error;
      const rows = data as Claimed[];
      if (rows.length === 0) break;
      store ??= await loadStore(admin);
      for (const row of rows) await deliverOne(admin, row, store, summary);
    }
  } catch (error) {
    console.error(`${LOG} delivery run failed: ${describeError(error)}`);
  }
  return summary;
}

/**
 * Sends waiting emails after the current response has gone out, so the admin
 * or Stripe never waits for the mail server. Call it after a status change in
 * a Server Action or Route Handler.
 */
export function scheduleOrderEmails(): void {
  after(deliverOrderEmails);
}
