import "server-only";
import { cache } from "react";
import {
  categoryFilterIds,
  pageRange,
  searchPattern,
  toPage,
  type Page,
} from "@/lib/catalogue/queries";
import { isUuid } from "@/lib/catalogue/validation";
import type { Database, Tables } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import {
  ADJUSTMENT_REASONS,
  isAdjustmentType,
  isStockStatus,
  type AdjustmentReason,
  type AdjustmentType,
  type StockStatus,
} from "./rules";

/**
 * Inventory reads (admin only — the view and RLS return nothing to anyone
 * else). Lists come from the inventory_overview view, so search, filters,
 * derived stock status and pagination all run in PostgreSQL in one query.
 */

export const INVENTORY_PAGE_SIZE = 25;
export const HISTORY_PAGE_SIZE = 20;
/** Variants shown under a product in the list (the rest are on its variants page). */
export const VARIANT_PREVIEW_SIZE = 10;

export type InventoryRow = Database["public"]["Views"]["inventory_overview"]["Row"];
export type VariantStockRow = Pick<
  Database["public"]["Views"]["variant_inventory_overview"]["Row"],
  | "variant_id"
  | "product_id"
  | "sku"
  | "label"
  | "is_active"
  | "image_url"
  | "inventory_id"
  | "quantity"
  | "reserved_quantity"
  | "available_quantity"
  | "low_stock_threshold"
  | "stock_status"
  | "stock_updated_at"
>;
export type AdjustmentRow = Tables<"inventory_adjustments"> & {
  admin: { full_name: string | null } | null;
  /** Set for a sale or a cancellation (migration 043). */
  order: { order_number: number } | null;
  /** Set for a variant's adjustment. */
  variant: { sku: string } | null;
};

export interface InventoryParams {
  q: string;
  /** Stock status filter, "" = all. */
  stock: StockStatus | "";
  category: string;
  /** Product status: active (default), inactive or all. */
  product: "active" | "inactive" | "all";
  /** "attention" = only products with an active variant low on or out of stock. */
  variants: "attention" | "";
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
    variants: first(searchParams.variants) === "attention" ? "attention" : "",
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
  // Variant SKUs too: searching "DRS-1-M-RED" finds its product.
  if (pattern) {
    query = query.or(`name.ilike.${pattern},sku.ilike.${pattern},variant_skus.ilike.${pattern}`);
  }
  if (params.stock) query = query.eq("stock_status", params.stock);
  if (params.variants) query = query.gt("variant_alerts", 0);
  if (params.category) query = query.in("category_id", await categoryFilterIds(params.category));
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

export interface VariantStockSummary {
  /** Products with at least one active variant low on or out of stock. */
  productsWithAlerts: number;
  lowStock: number;
  outOfStock: number;
}

/** Variant alert totals (active variants only), in one database call. */
export async function getVariantStockSummary(
  includeInactive: boolean,
): Promise<VariantStockSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("inventory_variant_summary", { p_include_inactive: includeInactive })
    .single();
  if (error) fail("variant stock summary", error);
  return {
    productsWithAlerts: Number(data.products_with_alerts),
    lowStock: Number(data.low_stock_variants),
    outOfStock: Number(data.out_of_stock_variants),
  };
}

/**
 * The first VARIANT_PREVIEW_SIZE variants of each listed product, by product
 * id: active ones first, lowest available stock first (what needs attention
 * leads). One small query per product with variants, in parallel.
 */
export async function listVariantStock(
  productIds: string[],
): Promise<Map<string, VariantStockRow[]>> {
  const supabase = await createClient();
  const results = await Promise.all(
    productIds.map((productId) =>
      supabase
        .from("variant_inventory_overview")
        .select(
          `variant_id, product_id, sku, label, is_active, image_url, inventory_id, quantity,
           reserved_quantity, available_quantity, low_stock_threshold, stock_status,
           stock_updated_at`,
        )
        .eq("product_id", productId)
        .order("is_active", { ascending: false })
        .order("available_quantity", { ascending: true, nullsFirst: true })
        .order("sort_order", { ascending: true })
        .order("variant_id", { ascending: true })
        .limit(VARIANT_PREVIEW_SIZE),
    ),
  );
  const byProduct = new Map<string, VariantStockRow[]>();
  results.forEach(({ data, error }, index) => {
    if (error) fail("variant stock", error);
    byProduct.set(productIds[index], data);
  });
  return byProduct;
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

/**
 * Adjustment history for one product (product- and variant-level), newest
 * first, with the admin's name and the variant's SKU. `variantId` narrows it
 * to one variant.
 */
export async function listAdjustments(
  productId: string,
  page: number,
  variantId?: string,
): Promise<Page<AdjustmentRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("inventory_adjustments")
    .select(
      `*, admin:profiles!inventory_adjustments_created_by_fkey(full_name),
       variant:product_variants!inventory_adjustments_variant_id_fkey(sku),
       order:orders!inventory_adjustments_order_id_fkey(order_number)`,
      { count: "exact" },
    )
    .eq("product_id", productId);
  if (variantId) query = query.eq("variant_id", variantId);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(...pageRange(page, HISTORY_PAGE_SIZE));
  if (error) fail("inventory history", error);
  return toPage(data, count ?? 0, page, HISTORY_PAGE_SIZE);
}

// ---------------------------------------------------------------------------
// Stock movements (every adjustment, all products)
// ---------------------------------------------------------------------------

export const MOVEMENT_PAGE_SIZE = 30;
/** Reasons to filter by: the manual ones, plus sales and cancellations (043). */
export const MOVEMENT_REASONS = [...ADJUSTMENT_REASONS, "sold", "order_cancelled"] as const;
/** "Last N days" filter options. */
export const MOVEMENT_PERIODS = { "7": 7, "30": 30, "90": 90 } as const;
export type MovementPeriod = keyof typeof MOVEMENT_PERIODS;

export interface MovementParams {
  q: string;
  type: AdjustmentType | "";
  reason: AdjustmentReason | "";
  period: MovementPeriod | "";
  page: number;
}

export type MovementRow = AdjustmentRow & {
  product: { name: string; sku: string } | null;
};

export function parseMovementParams(
  searchParams: Record<string, string | string[] | undefined>,
): MovementParams {
  const type = first(searchParams.type);
  const reason = first(searchParams.reason);
  const period = first(searchParams.period);
  const page = Number.parseInt(first(searchParams.page), 10);
  return {
    q: first(searchParams.q).trim().slice(0, 100),
    type: isAdjustmentType(type) ? type : "",
    reason: (MOVEMENT_REASONS as readonly string[]).includes(reason)
      ? (reason as AdjustmentReason)
      : "",
    period: Object.hasOwn(MOVEMENT_PERIODS, period) ? (period as MovementPeriod) : "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/**
 * Every stock adjustment (manual, batch, product form, checkout once stock is
 * deducted there), newest first. Search matches the product name or SKU, or
 * the variant SKU.
 */
export async function listMovements(params: MovementParams): Promise<Page<MovementRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("inventory_adjustments")
    .select(
      `*, admin:profiles!inventory_adjustments_created_by_fkey(full_name),
       variant:product_variants!inventory_adjustments_variant_id_fkey(sku),
       product:products!inventory_adjustments_product_id_fkey(name, sku),
       order:orders!inventory_adjustments_order_id_fkey(order_number)`,
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  const pattern = searchPattern(params.q);
  if (pattern) {
    // Matching products and variants first (two small id lookups), then one filter.
    const [products, variants] = await Promise.all([
      supabase
        .from("products")
        .select("id")
        .or(`name.ilike.${pattern},sku.ilike.${pattern}`)
        .limit(200),
      supabase.from("product_variants").select("id").ilike("sku", pattern).limit(200),
    ]);
    const error = products.error ?? variants.error;
    if (error) fail("movement search", error);
    const productIds = products.data?.map((row) => row.id) ?? [];
    const variantIds = variants.data?.map((row) => row.id) ?? [];
    if (productIds.length === 0 && variantIds.length === 0) {
      return toPage([], 0, params.page, MOVEMENT_PAGE_SIZE);
    }
    query = query.or(
      [
        productIds.length > 0 && `product_id.in.(${productIds.join(",")})`,
        variantIds.length > 0 && `variant_id.in.(${variantIds.join(",")})`,
      ]
        .filter(Boolean)
        .join(","),
    );
  }
  if (params.type) query = query.eq("adjustment_type", params.type);
  if (params.reason) query = query.eq("reason", params.reason);
  if (params.period) {
    const days = MOVEMENT_PERIODS[params.period];
    query = query.gte("created_at", new Date(Date.now() - days * 86_400_000).toISOString());
  }

  const { data, error, count } = await query.range(...pageRange(params.page, MOVEMENT_PAGE_SIZE));
  if (error) fail("stock movements", error);
  return toPage(data as unknown as MovementRow[], count ?? 0, params.page, MOVEMENT_PAGE_SIZE);
}

// ---------------------------------------------------------------------------
// Update stock: items to add to a batch
// ---------------------------------------------------------------------------

/** A stock-keeping item: a product without variants, or one variant. */
export interface StockItem {
  /** variantId ?? productId (unique in a batch). */
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  /** Variant options ("M / Red"); null for a product without variants. */
  label: string | null;
  sku: string;
  imageUrl: string | null;
  quantity: number;
  reserved: number;
  threshold: number;
  stockStatus: StockStatus;
  productActive: boolean;
  /** > 0: a product with variants, i.e. its stock pool (migration 042). */
  variantCount: number;
  /** Stock pool: units its variants hold (it can't go below). */
  allocated?: number;
  /** Variant: units still unallocated in its product's pool (its headroom). */
  poolAvailable?: number;
}

const SEARCH_LIMIT = 20;

/**
 * Items matching a name or SKU (product or variant), for the Update stock
 * page. `attention`: instead, items low on or out of stock (what usually
 * needs restocking). A product with variants is listed as its stock pool
 * and as each variant; products without an inventory row are skipped.
 */
export async function searchStockItems(q: string, attention = false): Promise<StockItem[]> {
  const supabase = await createClient();
  const pattern = searchPattern(q);
  if (!pattern && !attention) return [];

  let products = supabase
    .from("inventory_overview")
    .select(
      "product_id, name, sku, image_url, quantity, reserved_quantity, low_stock_threshold, stock_status, product_active, variant_count, allocated_quantity",
    )
    .not("inventory_id", "is", null)
    .order("name", { ascending: true })
    .limit(SEARCH_LIMIT);
  let variants = supabase
    .from("variant_inventory_overview")
    .select(
      "variant_id, product_id, sku, label, image_url, quantity, reserved_quantity, low_stock_threshold, stock_status, product_active",
    )
    .not("inventory_id", "is", null)
    .order("sku", { ascending: true })
    .limit(SEARCH_LIMIT);

  if (attention) {
    products = products
      .in("stock_status", ["low_stock", "out_of_stock"])
      .eq("product_active", true);
    variants = variants
      .in("stock_status", ["low_stock", "out_of_stock"])
      .eq("product_active", true)
      .eq("is_active", true);
  } else if (pattern) {
    products = products.or(`name.ilike.${pattern},sku.ilike.${pattern}`);
    // Variants by their own SKU / options, or by their product's name.
    const { data: named, error } = await supabase
      .from("inventory_overview")
      .select("product_id")
      .gt("variant_count", 0)
      .ilike("name", pattern)
      .limit(SEARCH_LIMIT);
    if (error) fail("stock search", error);
    const ids = named.map((row) => row.product_id).filter((id): id is string => Boolean(id));
    variants = variants.or(
      [
        `sku.ilike.${pattern}`,
        `label.ilike.${pattern}`,
        ids.length > 0 && `product_id.in.(${ids.join(",")})`,
      ]
        .filter(Boolean)
        .join(","),
    );
  }

  const [productResult, variantResult] = await Promise.all([products, variants]);
  const error = productResult.error ?? variantResult.error;
  if (error) fail("stock search", error);
  const productRows = { data: productResult.data ?? [] };
  const variantRows = { data: variantResult.data ?? [] };

  // Variant rows carry no product name or pool: one lookup for their products.
  const variantProductIds = [...new Set(variantRows.data.map((row) => row.product_id))];
  const names = new Map<string, string>();
  const unallocated = new Map<string, number>();
  if (variantProductIds.length > 0) {
    const { data, error: nameError } = await supabase
      .from("inventory_overview")
      .select("product_id, name, unallocated_quantity")
      .in("product_id", variantProductIds);
    if (nameError) fail("stock search names", nameError);
    for (const row of data ?? []) {
      names.set(row.product_id, row.name);
      unallocated.set(row.product_id, row.unallocated_quantity ?? 0);
    }
  }

  const items: StockItem[] = [
    ...productRows.data.map((row) => ({
      key: row.product_id ?? "",
      productId: row.product_id ?? "",
      variantId: null,
      name: row.name ?? "",
      label: null,
      sku: row.sku ?? "",
      imageUrl: row.image_url,
      quantity: row.quantity ?? 0,
      reserved: row.reserved_quantity ?? 0,
      threshold: row.low_stock_threshold ?? 0,
      stockStatus: (row.stock_status ?? "unconfigured") as StockStatus,
      productActive: row.product_active ?? true,
      variantCount: row.variant_count,
      allocated: row.variant_count > 0 ? row.allocated_quantity : undefined,
    })),
    ...variantRows.data.map((row) => ({
      key: row.variant_id,
      productId: row.product_id,
      variantId: row.variant_id,
      name: names.get(row.product_id) ?? row.sku,
      label: row.label,
      sku: row.sku,
      imageUrl: row.image_url,
      quantity: row.quantity ?? 0,
      reserved: row.reserved_quantity ?? 0,
      threshold: row.low_stock_threshold ?? 0,
      stockStatus: row.stock_status,
      productActive: row.product_active,
      variantCount: 0,
      poolAvailable: unallocated.get(row.product_id) ?? 0,
    })),
  ];
  return items.filter((item) => item.productId).slice(0, SEARCH_LIMIT * 2);
}

// ---------------------------------------------------------------------------
// Sharing a product's stock pool out to its variants
// ---------------------------------------------------------------------------

export interface StockAllocation {
  productId: string;
  name: string;
  sku: string;
  /** The product's stock pool. */
  quantity: number;
  unallocated: number;
  variants: Array<{
    variantId: string;
    label: string;
    sku: string;
    quantity: number;
    isActive: boolean;
  }>;
}

/**
 * A product's pool and every variant's stock (active first, in their order),
 * or null when it has no variants or no inventory row.
 */
export async function getStockAllocation(productId: string): Promise<StockAllocation | null> {
  const supabase = await createClient();
  const [pool, variants] = await Promise.all([
    supabase
      .from("inventory_overview")
      .select("product_id, name, sku, quantity, unallocated_quantity, variant_count, inventory_id")
      .eq("product_id", productId)
      .maybeSingle(),
    supabase
      .from("variant_inventory_overview")
      .select("variant_id, sku, label, quantity, is_active")
      .eq("product_id", productId)
      .order("is_active", { ascending: false })
      .order("sort_order", { ascending: true })
      .limit(200),
  ]);
  const error = pool.error ?? variants.error;
  if (error) {
    // Before migration 042 the pool columns don't exist: nothing to share out.
    if (error.code === "42703") return null;
    fail("stock allocation", error);
  }
  const row = pool.data;
  if (!row?.inventory_id || row.variant_count === 0) return null;
  return {
    productId,
    name: row.name,
    sku: row.sku,
    quantity: row.quantity ?? 0,
    unallocated: row.unallocated_quantity ?? 0,
    variants: (variants.data ?? []).map((variant) => ({
      variantId: variant.variant_id,
      label: variant.label || variant.sku,
      sku: variant.sku,
      quantity: variant.quantity ?? 0,
      isActive: variant.is_active,
    })),
  };
}
