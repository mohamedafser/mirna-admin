import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Category, Product, ProductImage } from "@/types/domain";

/**
 * Catalogue reads for the admin app. Everything goes through the signed-in
 * user's client, so RLS decides what is visible (admins see inactive rows too).
 * Lists filter, search and paginate in PostgreSQL — the browser never receives
 * the whole catalogue — and each list is a single query (no N+1).
 */

export const CATEGORY_PAGE_SIZE = 25;
export const PRODUCT_PAGE_SIZE = 20;

export type StatusFilter = "all" | "active" | "inactive";

export interface ListParams {
  q: string;
  status: StatusFilter;
  page: number;
  /** Products only: category id or "". */
  category: string;
  /** Presentation only (not a query input). */
  view: "list" | "grid";
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export type CategoryRow = Category & { productCount: number };

export interface CategoryOption {
  id: string;
  name: string;
  isActive: boolean;
}

export type ProductListRow = Pick<
  Product,
  | "id"
  | "name"
  | "sku"
  | "slug"
  | "price"
  | "compare_at_price"
  | "currency_code"
  | "is_active"
  | "updated_at"
> & {
  category: { id: string; name: string } | null;
  image: Pick<ProductImage, "public_url" | "alt_text"> | null;
};

export type ProductDetail = Product & {
  category: { id: string; name: string; is_active: boolean } | null;
  images: ProductImage[];
};

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/** Reads list state from the URL (?q=&status=&category=&page=), clamped to safe values. */
export function parseListParams(searchParams: Record<string, string | string[] | undefined>) {
  const status = first(searchParams.status);
  const page = Number.parseInt(first(searchParams.page), 10);
  return {
    q: first(searchParams.q).trim().slice(0, 100),
    status: status === "active" || status === "inactive" ? status : "all",
    page: Number.isFinite(page) && page > 0 ? page : 1,
    category: first(searchParams.category),
    view: first(searchParams.view) === "grid" ? "grid" : "list",
  } satisfies ListParams;
}

/**
 * ILIKE pattern for PostgREST `or=(…)`. Characters with meaning in that syntax
 * (, ( ) " \ :) and the * / % wildcards are stripped, so user input can't
 * change the filter structure.
 */
export function searchPattern(q: string): string | null {
  const cleaned = q
    .replace(/[%*,()"\\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `%${cleaned}%` : null;
}

export function pageRange(page: number, pageSize: number): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}

export function toPage<T>(rows: T[], total: number, page: number, pageSize: number): Page<T> {
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

function fail(scope: string, error: { code?: string; message?: string }): never {
  console.error(
    `[catalogue] ${scope} failed: code=${error.code || "-"} message=${error.message || "-"}`,
  );
  throw new Error(`Unable to load ${scope}`);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(params: ListParams): Promise<Page<CategoryRow>> {
  const supabase = await createClient();
  // products(count): PostgREST aggregates the count in the same query.
  let query = supabase
    .from("categories")
    .select("*, products(count)", { count: "exact" })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const pattern = searchPattern(params.q);
  if (pattern) query = query.or(`name.ilike.${pattern},slug.ilike.${pattern}`);
  if (params.status !== "all") query = query.eq("is_active", params.status === "active");

  const { data, error, count } = await query.range(...pageRange(params.page, CATEGORY_PAGE_SIZE));
  if (error) fail("categories", error);

  const rows = data.map(({ products, ...category }) => ({
    ...category,
    productCount: (products as unknown as { count: number }[])[0]?.count ?? 0,
  }));
  return toPage(rows, count ?? 0, params.page, CATEGORY_PAGE_SIZE);
}

/**
 * Every category as {id, name, isActive}, for filters and the product form.
 * Memoised per request so several components share one query.
 */
export const listCategoryOptions = cache(async (): Promise<CategoryOption[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, name, is_active")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) fail("category options", error);
  return data.map(({ id, name, is_active }) => ({ id, name, isActive: is_active }));
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export async function listProducts(params: ListParams): Promise<Page<ProductListRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select(
      `id, name, sku, slug, price, compare_at_price, currency_code, is_active, updated_at,
       category:categories(id, name),
       images:product_images(public_url, alt_text)`,
      { count: "exact" },
    )
    // Only the primary image is embedded (thumbnail column).
    .eq("images.is_primary", true)
    .order("updated_at", { ascending: false })
    .order("id", { ascending: true });

  const pattern = searchPattern(params.q);
  if (pattern) {
    query = query.or(`name.ilike.${pattern},sku.ilike.${pattern},slug.ilike.${pattern}`);
  }
  if (params.status !== "all") query = query.eq("is_active", params.status === "active");
  if (params.category) query = query.eq("category_id", params.category);

  const { data, error, count } = await query.range(...pageRange(params.page, PRODUCT_PAGE_SIZE));
  if (error) fail("products", error);

  const rows = data.map(({ images, ...product }) => ({ ...product, image: images[0] ?? null }));
  return toPage(rows, count ?? 0, params.page, PRODUCT_PAGE_SIZE);
}

/** One product with its category and images (ordered). Memoised per request. */
export const getProduct = cache(async (id: string): Promise<ProductDetail | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select("*, category:categories(id, name, is_active), images:product_images(*)")
    .eq("id", id)
    .order("sort_order", { referencedTable: "product_images", ascending: true })
    .order("created_at", { referencedTable: "product_images", ascending: true })
    .maybeSingle();
  if (error) fail("product", error);
  return data;
});
