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
  /** Display label: "Women › Abaya" for a subcategory. */
  name: string;
  /** The category's own name ("Abaya"). */
  shortName: string;
  isActive: boolean;
  /** null = top-level category. */
  parentId: string | null;
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
  /** null when the product has no inventory row yet ("Not configured"). */
  inventory: { quantity: number; reserved_quantity: number; low_stock_threshold: number } | null;
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
    .select("id, name, is_active, parent_id")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) fail("category options", error);
  const options = data.map(({ id, name, is_active, parent_id }) => ({
    id,
    name,
    shortName: name,
    isActive: is_active,
    parentId: parent_id,
  }));
  // Tree order: each top-level category, then its subcategories ("Women › Abaya").
  const byId = new Map(options.map((option) => [option.id, option]));
  const label = (option: CategoryOption) => {
    const parent = option.parentId ? byId.get(option.parentId) : undefined;
    return parent ? `${parent.name} › ${option.name}` : option.name;
  };
  const roots = options.filter((option) => !option.parentId || !byId.has(option.parentId));
  return roots.flatMap((root) => [
    { ...root, name: label(root) },
    ...options
      .filter((option) => option.parentId === root.id)
      .map((child) => ({ ...child, name: label(child) })),
  ]);
});

/**
 * Ids a category filter matches: the category plus its subcategories, so
 * filtering by "Women" also lists products filed under Women › Winter.
 */
export async function categoryFilterIds(id: string): Promise<string[]> {
  const options = await listCategoryOptions();
  return [id, ...options.filter((option) => option.parentId === id).map((option) => option.id)];
}

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
       images:product_images(public_url, alt_text),
       inventory(quantity, reserved_quantity, low_stock_threshold)`,
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
  if (params.category) query = query.in("category_id", await categoryFilterIds(params.category));

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
