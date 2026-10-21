import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { InventoryRow } from "@/lib/inventory/queries";
import { startOfToday } from "@/lib/orders/queries";
import type { OrderStatus } from "@/types/domain";

/**
 * Dashboard reads, through the signed-in admin's client (RLS: admin only).
 * Sales figures come from admin_dashboard_summary() (migration 033), which
 * aggregates in PostgreSQL; money arrives as text and is never summed here.
 */

/** Dashboard period presets (?period=), counted back from now. */
export const DASHBOARD_PERIODS = { "7d": 7, "30d": 30, "90d": 90 } as const;
export type DashboardPeriod = keyof typeof DASHBOARD_PERIODS;
export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = "30d";

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseDashboardPeriod(value: string | string[] | undefined): DashboardPeriod {
  const period = Array.isArray(value) ? value[0] : value;
  return period && Object.hasOwn(DASHBOARD_PERIODS, period)
    ? (period as DashboardPeriod)
    : DEFAULT_DASHBOARD_PERIOD;
}

export interface CurrencySales {
  currency_code: string;
  orders: number;
  revenue: string;
  previous_orders: number;
  previous_revenue: string;
  today_orders: number;
  today_revenue: string;
}

export interface DailySales {
  /** Store-local calendar day, YYYY-MM-DD. */
  day: string;
  currency_code: string;
  orders: number;
  revenue: string;
}

export interface TopProduct {
  product_id: string | null;
  product_name: string;
  units: number;
  orders: number;
}

export interface DashboardSummary {
  /** Highest-revenue currency first. */
  sales: CurrencySales[];
  daily: DailySales[];
  statusCounts: Partial<Record<OrderStatus, number>>;
  topProducts: TopProduct[];
  customers: { total: number; new: number; previous_new: number };
}

export interface RecentOrder {
  id: string;
  order_number: number;
  status: OrderStatus;
  total: string;
  currency_code: string;
  created_at: string;
  customer_name: string | null;
  recipient: string | null;
}

export type StockAlert = Pick<
  InventoryRow,
  "product_id" | "name" | "sku" | "available_quantity" | "low_stock_threshold" | "stock_status"
>;

function fail(scope: string, error: { code?: string; message?: string }): never {
  console.error(
    `[dashboard] ${scope} failed: code=${error.code || "-"} message=${error.message || "-"}`,
  );
  throw new Error(`Unable to load ${scope}`);
}

/** Missing function: migration 033 hasn't been applied yet. */
function isMissingFunction(error: { code?: string }) {
  return ["42883", "PGRST202"].includes(error.code ?? "");
}

/**
 * Sales, fulfilment queue, best sellers and customer growth for a period.
 * Returns null until migration 033 is applied (the dashboard says so).
 */
export async function getDashboardSummary(
  period: DashboardPeriod,
  timeZone: string,
): Promise<DashboardSummary | null> {
  const days = DASHBOARD_PERIODS[period];
  // Whole store-local days: the period ends today and starts `days - 1`
  // midnights earlier, so the chart has exactly `days` bars.
  const today = startOfToday(timeZone);
  const from = new Date(Date.parse(today) - (days - 1) * DAY_MS).toISOString();
  const previousFrom = new Date(Date.parse(from) - days * DAY_MS).toISOString();

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_dashboard_summary", {
    p_from: from,
    p_previous_from: previousFrom,
    p_today: today,
    p_time_zone: timeZone,
  });
  if (error) {
    if (isMissingFunction(error)) {
      console.warn("[dashboard] admin_dashboard_summary missing: apply migration 033");
      return null;
    }
    fail("dashboard summary", error);
  }
  const result = data as unknown as {
    sales: CurrencySales[];
    daily: DailySales[];
    status_counts: Partial<Record<OrderStatus, number>>;
    top_products: TopProduct[];
    customers: DashboardSummary["customers"];
  };
  return {
    sales: result.sales,
    daily: result.daily,
    statusCounts: result.status_counts,
    topProducts: result.top_products,
    customers: result.customers,
  };
}

/** The latest orders, newest first. */
export async function listRecentOrders(limit = 6): Promise<RecentOrder[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("orders")
    .select(
      `id, order_number, status, total::text, currency_code, created_at,
       customer_name:shipping_address_snapshot->customer->>full_name,
       recipient:shipping_address_snapshot->>full_name`,
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .limit(limit);
  if (error) fail("recent orders", error);
  return data as unknown as RecentOrder[];
}

/** Active products out of or low on stock, least available first. */
export async function listStockAlerts(limit = 5): Promise<StockAlert[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_overview")
    .select("product_id, name, sku, available_quantity, low_stock_threshold, stock_status")
    .eq("product_active", true)
    .in("stock_status", ["out_of_stock", "low_stock"])
    .order("available_quantity", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true })
    .limit(limit);
  if (error) fail("stock alerts", error);
  return data;
}
