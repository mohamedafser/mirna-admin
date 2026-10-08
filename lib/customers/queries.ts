import "server-only";
import { cache } from "react";
import { pageRange, toPage, type Page } from "@/lib/catalogue/queries";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/types/domain";

/**
 * Customer reads for the admin app, through the signed-in admin's client.
 * The list and the profile come from admin_list_customers() /
 * admin_get_customer() (migration 019): they refuse anyone but an active
 * admin and add the sign-in email from auth.users, returning display fields
 * only. A customer's orders are read from `orders` under RLS
 * (orders_select_own_or_admin).
 */

export const CUSTOMER_PAGE_SIZE = 25;
export const CUSTOMER_ORDERS_PAGE_SIZE = 10;

export interface CustomerListParams {
  q: string;
  status: "active" | "inactive" | "";
  page: number;
}

export interface CustomerRow {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  order_count: number;
  last_order_at: string | null;
}

export interface CustomerDetail extends CustomerRow {
  updated_at: string;
  last_sign_in_at: string | null;
}

export interface CustomerOrderRow {
  id: string;
  order_number: number;
  status: OrderStatus;
  total: string;
  currency_code: string;
  created_at: string;
  items: { count: number }[];
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Reads list state from the URL (?q=&status=&page=), clamped to safe values. */
export function parseCustomerParams(
  searchParams: Record<string, string | string[] | undefined>,
): CustomerListParams {
  const status = first(searchParams.status);
  const page = Number.parseInt(first(searchParams.page), 10);
  return {
    q: first(searchParams.q).trim().slice(0, 100),
    status: status === "active" || status === "inactive" ? status : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** ?page= for the customer's order history. */
export function parseOrdersPage(searchParams: Record<string, string | string[] | undefined>) {
  const page = Number.parseInt(first(searchParams.page), 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function fail(scope: string, error: { code?: string; message?: string }): never {
  console.error(
    `[customers] ${scope} failed: code=${error.code || "-"} message=${error.message || "-"}`,
  );
  throw new Error(`Unable to load ${scope}`);
}

export async function listCustomers(params: CustomerListParams): Promise<Page<CustomerRow>> {
  const supabase = await createClient();
  const [from] = pageRange(params.page, CUSTOMER_PAGE_SIZE);
  const { data, error } = await supabase.rpc("admin_list_customers", {
    // Passed as a function argument (not a filter string); the function
    // escapes LIKE wildcards itself.
    p_search: params.q || null,
    p_status: params.status || null,
    p_limit: CUSTOMER_PAGE_SIZE,
    p_offset: from,
  });
  if (error) fail("customers", error);
  const result = data as unknown as { total: number; rows: CustomerRow[] };
  return toPage(result.rows, result.total, params.page, CUSTOMER_PAGE_SIZE);
}

/** One customer (null if missing or not a customer). Memoised per request. */
export const getCustomer = cache(async (id: string): Promise<CustomerDetail | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_get_customer", { p_id: id });
  if (error) fail("customer", error);
  return data as unknown as CustomerDetail | null;
});

/** The customer's orders, newest first (stored amounts only). */
export async function listCustomerOrders(
  userId: string,
  page: number,
): Promise<Page<CustomerOrderRow>> {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("orders")
    .select(
      "id, order_number, status, total::text, currency_code, created_at, items:order_items(count)",
      {
        count: "exact",
      },
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(...pageRange(page, CUSTOMER_ORDERS_PAGE_SIZE));
  if (error) fail("customer orders", error);
  return toPage(data as unknown as CustomerOrderRow[], count ?? 0, page, CUSTOMER_ORDERS_PAGE_SIZE);
}
