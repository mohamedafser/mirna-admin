import "server-only";
import { cache } from "react";
import { pageRange, searchPattern, toPage, type Page } from "@/lib/catalogue/queries";
import { isUuid } from "@/lib/catalogue/validation";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import { isStockStatus, type StockStatus } from "./rules";

/**
 * Inventory reads (admin only — the view and RLS return nothing to anyone
 * else). Lists come from the inventory_overview view, so search, filters,
 * derived stock status and pagination all run in PostgreSQL in one query.
 */

export const INVENTORY_PAGE_SIZE = 25;
export const HISTORY_PAGE_SIZE = 20;

export type InventoryRow = Database["public"]["Views"]["inventory_overview"]["Row"];
export type AdjustmentRow = Tables<"inventory_adjustments"> & {
  admin: { full_name: string | null } | null;
};

export interface InventoryParams {
  q: string;
  /** Stock status filter, "" = all. */
  stock: StockStatus | "";
  category: string;
  /** Product status: active (default), inactive or all. */
  product: "active" | "inactive" | "all";
  page: number;
  /** Presentation only (not a query input). */
  view: "list" | "grid";
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseInventoryParams(
  searchParams: Record<string, string | string[] | undefined>,
): InventoryParams {
  const stock = first(searchParams.stock);
  const product = first(searchParams.product);
  const category = first(searchParams.category);
  const page = Number.parseInt(first(searchParams.page), 10);
  return {
    q: first(searchParams.q).trim().slice(0, 100),
    stock: isStockStatus(stock) ? stock : "",
    category: isUuid(category) ? category : "",
    product: product === "inactive" || product === "all" ? product : "active",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    view: first(searchParams.view) === "grid" ? "grid" : "list",
  };
}

function fail(scope: string, error: { code?: string; message?: string }): never {
  console.error(
    `[inventory] ${scope} failed: code=${error.code || "-"} message=${error.message || "-"}`,
  );
  throw new Error(`Unable to load ${scope}`);
}

export async function listInventory(params: InventoryParams): Promise<Page<InventoryRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("inventory_overview")
    .select("*", { count: "exact" })
    .order("name", { ascending: true })
    .order("product_id", { ascending: true });

  const pattern = searchPattern(params.q);
  if (pattern) query = query.or(`name.ilike.${pattern},sku.ilike.${pattern}`);
  if (params.stock) query = query.eq("stock_status", params.stock);
  if (params.category) query = query.eq("category_id", params.category);
  if (params.product !== "all") query = query.eq("product_active", params.product === "active");

  const { data, error, count } = await query.range(...pageRange(params.page, INVENTORY_PAGE_SIZE));
  if (error) fail("inventory", error);
  return toPage(data, count ?? 0, params.page, INVENTORY_PAGE_SIZE);
}

export interface InventorySummary {
  totalProducts: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
  unconfigured: number;
  totalUnits: number;
  reservedUnits: number;
}

/** All summary counts in one database call. */
export async function getInventorySummary(includeInactive: boolean): Promise<InventorySummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("inventory_summary", { p_include_inactive: includeInactive })
    .single();
  if (error) fail("inventory summary", error);
  return {
    totalProducts: Number(data.total_products),
    inStock: Number(data.in_stock),
    lowStock: Number(data.low_stock),
    outOfStock: Number(data.out_of_stock),
    unconfigured: Number(data.unconfigured),
    totalUnits: Number(data.total_units),
    reservedUnits: Number(data.reserved_units),
  };
}

/** One product's inventory (memoised per request). */
export const getInventoryItem = cache(async (productId: string): Promise<InventoryRow | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inventory_overview")
    .select("*")
    .eq("product_id", productId)
    .maybeSingle();
  if (error) fail("inventory item", error);
  return data;
});

/** Adjustment history for one product, newest first, with the admin's name. */
export async function listAdjustments(
  productId: string,
  page: number,
): Promise<Page<AdjustmentRow>> {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("inventory_adjustments")
    .select("*, admin:profiles!inventory_adjustments_created_by_fkey(full_name)", {
      count: "exact",
    })
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(...pageRange(page, HISTORY_PAGE_SIZE));
  if (error) fail("inventory history", error);
  return toPage(data, count ?? 0, page, HISTORY_PAGE_SIZE);
}
