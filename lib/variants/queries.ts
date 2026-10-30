import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import { pageRange, searchPattern, toPage, type Page } from "@/lib/catalogue/queries";
import { isStockStatus, type StockStatus } from "@/lib/inventory/rules";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import type { VariantAxis } from "./rules";

/**
 * Variant reads (admin only: RLS and the views' is_admin() filter return
 * nothing to anyone else). Filtering runs in PostgreSQL.
 */

type Supabase = SupabaseClient<Database>;

/** Variants per page of the list (filtered and paginated in PostgreSQL). */
export const VARIANT_PAGE_SIZE = 25;

export type VariantRow = Database["public"]["Views"]["variant_inventory_overview"]["Row"];

export interface VariantListParams {
  q: string;
  stock: StockStatus | "";
  status: "all" | "active" | "inactive";
  page: number;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export function parseVariantParams(
  searchParams: Record<string, string | string[] | undefined>,
): VariantListParams {
  const stock = first(searchParams.stock);
  const status = first(searchParams.status);
  const page = Number.parseInt(first(searchParams.page), 10);
  return {
    q: first(searchParams.q).trim().slice(0, 100),
    stock: isStockStatus(stock) ? stock : "",
    status: status === "active" || status === "inactive" ? status : "all",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

function fail(scope: string, error: { code?: string; message?: string }): never {
  console.error(
    `[variants] ${scope} failed: code=${error.code || "-"} message=${error.message || "-"}`,
  );
  throw new Error(`Unable to load ${scope}`);
}

/** Missing table / view / column: migration 024 hasn't been applied yet. */
export function isMissingSchema(error: { code?: string }) {
  return ["42P01", "42703", "PGRST200", "PGRST204", "PGRST205"].includes(error.code ?? "");
}

export interface VariantProduct {
  id: string;
  name: string;
  sku: string;
  price: number;
  compare_at_price: number | null;
  currency_code: string;
  is_active: boolean;
  updated_at: string;
  images: Array<{
    id: string;
    public_url: string | null;
    alt_text: string | null;
    is_primary: boolean;
  }>;
  /** Product-level stock (moved onto a variant when the first ones are created). */
  stock: { quantity: number; reserved: number } | null;
}

export const getVariantProduct = cache(async (id: string): Promise<VariantProduct | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      `id, name, sku, price, compare_at_price, currency_code, is_active, updated_at,
       images:product_images(id, public_url, alt_text, is_primary, sort_order),
       inventory(quantity, reserved_quantity)`,
    )
    .eq("id", id)
    .order("sort_order", { referencedTable: "images", ascending: true })
    .maybeSingle();
  if (error) fail("variant product", error);
  if (!data) return null;
  const { images, inventory, ...product } = data;
  const stock = Array.isArray(inventory) ? inventory[0] : inventory;
  return {
    ...product,
    images: images.map(({ id, public_url, alt_text, is_primary }) => ({
      id,
      public_url,
      alt_text,
      is_primary,
    })),
    stock: stock ? { quantity: stock.quantity, reserved: stock.reserved_quantity } : null,
  };
});

/**
 * The product's variant options: its multi-value SELECT / COLOR attributes
 * with the values selected on the product. Ordered like the product type's
 * attributes, then by name; values in their reusable order.
 */
export async function loadVariantAxes(supabase: Supabase, productId: string) {
  const [product, rows] = await Promise.all([
    supabase.from("products").select("product_type_id").eq("id", productId).maybeSingle(),
    supabase
      .from("product_attributes")
      .select(
        `attribute_value_id,
         attribute:attributes!product_attributes_attribute_id_fkey(id, name, data_type, allows_multiple, creates_variants),
         value:attribute_values!product_attributes_value_fkey(id, value, color_hex, sort_order)`,
      )
      .eq("product_id", productId)
      .not("attribute_value_id", "is", null),
  ]);
  const error = product.error ?? rows.error;
  if (error) fail("variant options", error);

  let typeOrder = new Map<string, number>();
  if (product.data?.product_type_id) {
    const { data, error: typeError } = await supabase
      .from("product_type_attributes")
      .select("attribute_id, sort_order")
      .eq("product_type_id", product.data.product_type_id);
    if (typeError) fail("variant option order", typeError);
    typeOrder = new Map(data.map((item) => [item.attribute_id, item.sort_order]));
  }

  const axes = new Map<string, VariantAxis & { order: number[] }>();
  for (const row of rows.data!) {
    const attribute = row.attribute;
    const value = row.value;
    // Same rule as generate_product_variants() (migration 036).
    if (!attribute || !value || !attribute.allows_multiple || !attribute.creates_variants) continue;
    if (attribute.data_type !== "SELECT" && attribute.data_type !== "COLOR") continue;
    const axis = axes.get(attribute.id) ?? {
      attributeId: attribute.id,
      name: attribute.name,
      values: [],
      order: [],
    };
    axis.values.push({ id: value.id, value: value.value, colorHex: value.color_hex });
    axis.order.push(value.sort_order);
    axes.set(attribute.id, axis);
  }
  const rank = (id: string) => typeOrder.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...axes.values()]
    .sort((a, b) => rank(a.attributeId) - rank(b.attributeId) || a.name.localeCompare(b.name))
    .map(({ attributeId, name, values, order }) => ({
      attributeId,
      name,
      // Reusable value order (attribute_values.sort_order), then name.
      values: values
        .map((value, index) => ({ value, sort: order[index] }))
        .sort((a, b) => a.sort - b.sort || a.value.value.localeCompare(b.value.value))
        .map((item) => item.value),
    }));
}

export const getVariantAxes = cache(async (productId: string) =>
  loadVariantAxes(await createClient(), productId),
);

/** Every variant's combination key and SKU (for the generator and SKU suggestions). */
export const getVariantKeys = cache(async (productId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id, combination_key, sku, is_active")
    .eq("product_id", productId);
  if (error) fail("variant keys", error);
  return data;
});

/** One page of a product's variants: search, filters and paging run in PostgreSQL. */
export async function listVariants(
  productId: string,
  params: VariantListParams,
): Promise<Page<VariantRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("variant_inventory_overview")
    .select("*", { count: "exact" })
    .eq("product_id", productId)
    .order("sort_order", { ascending: true })
    .order("sku", { ascending: true })
    // Tie-break so pages never overlap or skip rows.
    .order("variant_id", { ascending: true });

  const pattern = searchPattern(params.q);
  if (pattern) query = query.or(`sku.ilike.${pattern},label.ilike.${pattern}`);
  if (params.stock) query = query.eq("stock_status", params.stock);
  if (params.status !== "all") query = query.eq("is_active", params.status === "active");

  const { data, error, count } = await query.range(...pageRange(params.page, VARIANT_PAGE_SIZE));
  if (error) fail("variants", error);
  return toPage(data, count ?? 0, params.page, VARIANT_PAGE_SIZE);
}

/**
 * Number of variants per product (0 = simple product). Returns 0 when the
 * variant tables don't exist yet, so product pages keep working before 024.
 */
export const getVariantCount = cache(async (productId: string): Promise<number> => {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("product_variants")
    .select("id", { count: "exact", head: true })
    .eq("product_id", productId);
  if (error) {
    if (isMissingSchema(error)) return 0;
    fail("variant count", error);
  }
  return count ?? 0;
});

/**
 * Each variant's own shipping weight in grams (null: uses the product's), by
 * variant id. null before migration 038 (the editor then hides the field).
 */
export async function getVariantWeights(
  productId: string,
): Promise<Map<string, number | null> | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_variants")
    .select("id, weight_grams")
    .eq("product_id", productId);
  if (error) {
    if (isMissingSchema(error)) return null;
    fail("variant weights", error);
  }
  return new Map(data.map((row) => [row.id, row.weight_grams]));
}
