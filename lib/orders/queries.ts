import "server-only";
import { cache } from "react";
import { pageRange, searchPattern, toPage, type Page } from "@/lib/catalogue/queries";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/types/domain";
import { isOrderPeriod, isOrderStatus, ORDER_PERIODS, type OrderPeriod } from "./rules";

/**
 * Order reads for the admin app, through the signed-in admin's client: RLS
 * (orders_select_own_or_admin, order_items_select_own_or_admin) returns every
 * order only to an active ADMIN. Everything shown is the stored order:
 * amounts, item names/SKUs/prices and the address/customer snapshot taken at
 * checkout. Nothing is re-priced from current products. Money columns are
 * selected as text so NUMERIC values never pass through floats.
 */

export const ORDER_PAGE_SIZE = 25;

export interface OrderListParams {
  q: string;
  status: OrderStatus | "";
  period: OrderPeriod | "";
  page: number;
}

export interface OrderListRow {
  id: string;
  order_number: number;
  status: OrderStatus;
  total: string;
  currency_code: string;
  created_at: string;
  customer_name: string | null;
  customer_email: string | null;
  recipient: string | null;
  items: { count: number }[];
}

/** The snapshot place_order() stores in orders.shipping_address_snapshot. */
export interface AddressSnapshot {
  full_name?: string;
  phone?: string;
  country_code?: string;
  state_region?: string | null;
  city?: string;
  area?: string | null;
  street?: string | null;
  building?: string | null;
  apartment?: string | null;
  postal_code?: string | null;
  additional_instructions?: string | null;
  customer?: {
    user_id?: string;
    email?: string | null;
    full_name?: string | null;
    phone?: string | null;
  };
}

export interface OrderDetail {
  id: string;
  order_number: number;
  status: OrderStatus;
  subtotal: string;
  discount: string;
  shipping: string;
  tax: string;
  total: string;
  currency_code: string;
  created_at: string;
  updated_at: string;
  user_id: string | null;
  shipping_address_snapshot: AddressSnapshot;
  billing_address_snapshot: AddressSnapshot | null;
  /** The account as it is now (null if it was deleted). */
  account: { full_name: string | null; phone: string | null; is_active: boolean } | null;
  items: {
    id: string;
    product_id: string | null;
    product_name: string;
    sku: string;
    quantity: number;
    unit_price: string;
    total_price: string;
  }[];
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Reads list state from the URL (?q=&status=&period=&page=), clamped to safe values. */
export function parseOrderParams(
  searchParams: Record<string, string | string[] | undefined>,
): OrderListParams {
  const status = first(searchParams.status);
  const period = first(searchParams.period);
  const page = Number.parseInt(first(searchParams.page), 10);
  return {
    q: first(searchParams.q).trim().slice(0, 100),
    status: isOrderStatus(status) ? status : "",
    period: isOrderPeriod(period) ? period : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Midnight today in the market's timezone, as an ISO instant. */
function startOfToday(timeZone: string): string {
  const now = new Date();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((part) => [part.type, part.value]),
  );
  const elapsed =
    (Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second)) * 1000 +
    now.getMilliseconds();
  return new Date(now.getTime() - elapsed).toISOString();
}

function periodStart(period: OrderPeriod, timeZone: string): string {
  const days = ORDER_PERIODS[period];
  return days === 0
    ? startOfToday(timeZone)
    : new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function fail(scope: string, error: { code?: string; message?: string }): never {
  console.error(
    `[orders] ${scope} failed: code=${error.code || "-"} message=${error.message || "-"}`,
  );
  throw new Error(`Unable to load ${scope}`);
}

/** `timeZone`: the store's (Settings), so "Today" starts at the store's midnight. */
export async function listOrders(
  params: OrderListParams,
  timeZone: string,
): Promise<Page<OrderListRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("orders")
    .select(
      `id, order_number, status, total::text, currency_code, created_at,
       customer_name:shipping_address_snapshot->customer->>full_name,
       customer_email:shipping_address_snapshot->customer->>email,
       recipient:shipping_address_snapshot->>full_name,
       items:order_items(count)`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: true });

  // "#123" or "123": order number. Anything else: customer name/email,
  // recipient name or phone, all from the stored snapshot.
  const number = /^#?(\d{1,15})$/.exec(params.q)?.[1];
  if (number) {
    query = query.eq("order_number", Number(number));
  } else {
    const pattern = searchPattern(params.q);
    if (pattern) {
      query = query.or(
        [
          `shipping_address_snapshot->customer->>email.ilike.${pattern}`,
          `shipping_address_snapshot->customer->>full_name.ilike.${pattern}`,
          `shipping_address_snapshot->>full_name.ilike.${pattern}`,
          `shipping_address_snapshot->>phone.ilike.${pattern}`,
        ].join(","),
      );
    }
  }
  if (params.status) query = query.eq("status", params.status);
  if (params.period) query = query.gte("created_at", periodStart(params.period, timeZone));

  const { data, error, count } = await query.range(...pageRange(params.page, ORDER_PAGE_SIZE));
  if (error) fail("orders", error);
  return toPage(data as unknown as OrderListRow[], count ?? 0, params.page, ORDER_PAGE_SIZE);
}

/** One order with its items and account. Memoised per request. */
export const getOrder = cache(async (id: string): Promise<OrderDetail | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, subtotal::text, discount::text, shipping::text, tax::text,
       total::text, currency_code, created_at, updated_at, user_id,
       shipping_address_snapshot, billing_address_snapshot,
       account:profiles(full_name, phone, is_active),
       items:order_items(id, product_id, product_name, sku, quantity, unit_price::text, total_price::text, created_at)`,
    )
    .eq("id", id)
    .order("created_at", { referencedTable: "order_items", ascending: true })
    .maybeSingle();
  if (error) fail("order", error);
  return data as unknown as OrderDetail | null;
});
