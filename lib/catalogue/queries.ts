import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { nextProductSku } from "./sku";
import type { Category, Product, ProductImage, Tag } from "@/types/domain";

/**
 * Catalogue reads for the admin app. Everything goes through the signed-in
 * user's client, so RLS decides what is visible (admins see inactive rows too).
 * Lists filter, search and paginate in PostgreSQL — the browser never receives
 * the whole catalogue — and each list is a single query (no N+1).
 */

export const PRODUCT_PAGE_SIZE = 20;
export const TAG_PAGE_SIZE = 25;

export type StatusFilter = "all" | "active" | "inactive";

export interface ListParams {
  q: string;
  status: StatusFilter;
  page: number;
  /** Products only: category id or "". */
  category: string;
  /** Products only: tag id or "". */
  tag: string;
  /** Presentation only (not a query input). */
  view: "list" | "grid";
  /** Products only: list order ("" = recently updated first). */
  sort: ProductSort;
}

/** Product list orders (?sort=). "" is the default: recently updated first. */
export const PRODUCT_SORTS = {
  "": { column: "updated_at", ascending: false },
  "updated-asc": { column: "updated_at", ascending: true },
  "name-asc": { column: "name", ascending: true },
  "name-desc": { column: "name", ascending: false },
  // The product's own-currency price (products.price).
  "price-asc": { column: "price", ascending: true },
  "price-desc": { column: "price", ascending: false },
  "created-desc": { column: "created_at", ascending: false },
} as const;
export type ProductSort = keyof typeof PRODUCT_SORTS;

function isProductSort(value: string): value is ProductSort {
  return Object.hasOwn(PRODUCT_SORTS, value);
}

export interface Page<T> {
  rows: T[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

export type CategoryRow = Category & { productCount: number };

export type TagRow = Tag & { productCount: number };

export interface TagOption {
  id: string;
  name: string;
  isActive: boolean;
}

/** A product's categories (main included) and tags, by id. */
export interface ProductTaxonomy {
  categoryIds: string[];
  tagIds: string[];
}

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
  | "product_type_id"
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
    tag: first(searchParams.tag),
    view: first(searchParams.view) === "grid" ? "grid" : "list",
    sort: isProductSort(first(searchParams.sort)) ? (first(searchParams.sort) as ProductSort) : "",
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

/** Missing table / relation: migration 027 hasn't been applied yet. */
function isMissingSchema(error: { code?: string }) {
  return ["42P01", "42883", "PGRST200", "PGRST202", "PGRST205"].includes(error.code ?? "");
}

/**
 * Whether the multi-category / tag tables exist (migration 027). Until they
 * do, categories and products keep working on products.category_id alone.
 * Memoised per request.
 */
export const hasTaxonomy = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { error } = await supabase.from("tags").select("id").limit(1);
  if (!error) return true;
  if (isMissingSchema(error)) {
    console.warn("[catalogue] tag tables missing: apply migration 027 (tags disabled)");
    return false;
  }
  fail("tags", error);
});

const countOf = (value: unknown) => (value as { count: number }[] | null)?.[0]?.count ?? 0;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Every category with its product count, in display order, for the
 * drag-and-drop categories tree (categories are few: no pagination).
 */
export async function listCategoryTree(): Promise<CategoryRow[]> {
  const supabase = await createClient();
  const counted = (await hasTaxonomy())
    ? "*, assigned:product_categories(count)"
    : "*, assigned:products!products_category_id_fkey(count)";
  const { data, error } = await supabase
    .from("categories")
    .select(counted as "*, assigned:product_categories(count)")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) fail("category tree", error);
  return data.map(({ assigned, ...category }) => ({
    ...category,
    productCount: countOf(assigned),
  }));
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

const PRODUCT_LIST_COLUMNS = `id, name, sku, slug, price, compare_at_price, currency_code, is_active, updated_at, product_type_id,
       category:categories!products_category_id_fkey(id, name),
       images:product_images(public_url, alt_text),
       inventory(quantity, reserved_quantity, low_stock_threshold)`;

export async function listProducts(params: ListParams): Promise<Page<ProductListRow>> {
  const supabase = await createClient();
  const taxonomy = await hasTaxonomy();
  // Category / tag filters match through the assignment tables (inner joins,
  // so only matching products are counted and returned). A category filter
  // includes its subcategories, and products listed there as an extra category.
  const byCategory = Boolean(params.category) && taxonomy;
  const byTag = Boolean(params.tag) && taxonomy;
  const columns = [
    PRODUCT_LIST_COLUMNS,
    byCategory && "product_categories!inner(category_id)",
    byTag && "product_tags!inner(tag_id)",
  ]
    .filter(Boolean)
    .join(", ");
  let query = supabase
    .from("products")
    .select(columns as typeof PRODUCT_LIST_COLUMNS, { count: "exact" })
    // Only the primary image is embedded (thumbnail column).
    .eq("images.is_primary", true)
    .order(PRODUCT_SORTS[params.sort].column, { ascending: PRODUCT_SORTS[params.sort].ascending })
    .order("id", { ascending: true });

  const pattern = searchPattern(params.q);
  if (pattern) {
    query = query.or(`name.ilike.${pattern},sku.ilike.${pattern},slug.ilike.${pattern}`);
  }
  if (params.status !== "all") query = query.eq("is_active", params.status === "active");
  if (params.category) {
    const ids = await categoryFilterIds(params.category);
    query = byCategory
      ? query.in("product_categories.category_id" as "id", ids)
      : query.in("category_id", ids);
  }
  if (byTag) query = query.eq("product_tags.tag_id" as "id", params.tag);

  const { data, error, count } = await query.range(...pageRange(params.page, PRODUCT_PAGE_SIZE));
  if (error) fail("products", error);

  const rows = data.map(({ images, ...product }) => ({ ...product, image: images[0] ?? null }));
  return toPage(rows, count ?? 0, params.page, PRODUCT_PAGE_SIZE);
}

/** What the product list shows beyond the product row (one page of products). */
export interface ProductListExtras {
  /** Variants (all) and active ones; 0 for a simple product. */
  variantCount: number;
  activeVariantCount: number;
  /** product_prices rows (minor units); [] before migration 031. */
  prices: { variantId: string | null; currency: string; price: number; salePrice: number | null }[];
  /** Tag names, A–Z; [] before migration 027. */
  tags: string[];
  /** Categories besides the main one. */
  extraCategoryCount: number;
  productType: string | null;
}

/**
 * The list page's extra details for `ids` (one page): variant counts,
 * per-currency prices, tags, extra categories and product type. Small
 * parallel queries; any that fail (or whose tables don't exist yet) simply
 * leave their part empty, so the list always renders.
 */
export async function listProductExtras(
  rows: readonly Pick<ProductListRow, "id" | "category" | "product_type_id">[],
): Promise<Map<string, ProductListExtras>> {
  const ids = rows.map((row) => row.id);
  const result = new Map<string, ProductListExtras>(
    rows.map((row) => [
      row.id,
      {
        variantCount: 0,
        activeVariantCount: 0,
        prices: [],
        tags: [],
        extraCategoryCount: 0,
        productType: null,
      },
    ]),
  );
  if (ids.length === 0) return result;
  const supabase = await createClient();
  const taxonomy = await hasTaxonomy();
  const none = Promise.resolve({ data: null, error: null });
  const typeIds = [
    ...new Set(rows.flatMap((row) => (row.product_type_id ? [row.product_type_id] : []))),
  ];

  const [variants, prices, tags, categories, types] = await Promise.all([
    supabase.from("product_variants").select("product_id, is_active").in("product_id", ids),
    supabase
      .from("product_prices")
      .select("product_id, variant_id, currency_code, price, sale_price")
      .in("product_id", ids),
    taxonomy
      ? supabase.from("product_tags").select("product_id, tag:tags(name)").in("product_id", ids)
      : none,
    taxonomy
      ? supabase.from("product_categories").select("product_id, category_id").in("product_id", ids)
      : none,
    typeIds.length > 0 ? supabase.from("product_types").select("id, name").in("id", typeIds) : none,
  ]);
  const skip = (scope: string, error: { code?: string } | null) => {
    if (error) console.warn(`[catalogue] list ${scope} skipped: code=${error.code || "-"}`);
  };
  skip("variants", variants.error);
  skip("prices", prices.error);
  skip("tags", tags.error);
  skip("categories", categories.error);
  skip("types", types.error);

  for (const row of variants.data ?? []) {
    const item = result.get(row.product_id);
    if (!item) continue;
    item.variantCount += 1;
    if (row.is_active) item.activeVariantCount += 1;
  }
  for (const row of prices.data ?? []) {
    result.get(row.product_id)?.prices.push({
      variantId: row.variant_id,
      currency: row.currency_code,
      price: row.price,
      salePrice: row.sale_price,
    });
  }
  for (const row of (tags.data ?? []) as unknown as {
    product_id: string;
    tag: { name: string } | null;
  }[]) {
    if (row.tag) result.get(row.product_id)?.tags.push(row.tag.name);
  }
  const mainCategory = new Map(rows.map((row) => [row.id, row.category?.id ?? null]));
  for (const row of (categories.data ?? []) as { product_id: string; category_id: string }[]) {
    const item = result.get(row.product_id);
    if (item && row.category_id !== mainCategory.get(row.product_id)) item.extraCategoryCount += 1;
  }
  const typeName = new Map(
    ((types.data ?? []) as { id: string; name: string }[]).map((type) => [type.id, type.name]),
  );
  for (const row of rows) {
    const item = result.get(row.id)!;
    item.tags.sort((a, b) => a.localeCompare(b));
    item.productType = row.product_type_id ? (typeName.get(row.product_type_id) ?? null) : null;
  }
  return result;
}

/** One product with its category and images (ordered). Memoised per request. */
export const getProduct = cache(async (id: string): Promise<ProductDetail | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .select(
      "*, category:categories!products_category_id_fkey(id, name, is_active), images:product_images(*)",
    )
    .eq("id", id)
    .order("sort_order", { referencedTable: "product_images", ascending: true })
    .order("created_at", { referencedTable: "product_images", ascending: true })
    .maybeSingle();
  if (error) fail("product", error);
  return data;
});

/**
 * A product's category and tag ids. null when migration 027 isn't applied
 * (the form then hides those fields and saving skips them).
 */
export const getProductTaxonomy = cache(async (id: string): Promise<ProductTaxonomy | null> => {
  if (!(await hasTaxonomy())) return null;
  const supabase = await createClient();
  const [categories, tags] = await Promise.all([
    supabase.from("product_categories").select("category_id").eq("product_id", id),
    supabase.from("product_tags").select("tag_id").eq("product_id", id),
  ]);
  const error = categories.error ?? tags.error;
  if (error) fail("product categories and tags", error);
  return {
    categoryIds: categories.data!.map((row) => row.category_id),
    tagIds: tags.data!.map((row) => row.tag_id),
  };
});

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Admin tag list with search, status filter, pagination and product counts. */
export async function listTags(params: ListParams): Promise<Page<TagRow> | null> {
  if (!(await hasTaxonomy())) return null;
  const supabase = await createClient();
  let query = supabase
    .from("tags")
    .select("*, product_tags(count)", { count: "exact" })
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  const pattern = searchPattern(params.q);
  if (pattern) query = query.or(`name.ilike.${pattern},slug.ilike.${pattern}`);
  if (params.status !== "all") query = query.eq("is_active", params.status === "active");

  const { data, error, count } = await query.range(...pageRange(params.page, TAG_PAGE_SIZE));
  if (error) fail("tags", error);

  const rows = data.map(({ product_tags, ...tag }) => ({
    ...tag,
    productCount: countOf(product_tags),
  }));
  return toPage(rows, count ?? 0, params.page, TAG_PAGE_SIZE);
}

/**
 * Every tag as {id, name, isActive} (product form, filters). null when
 * migration 027 isn't applied. Memoised per request.
 */
export const listTagOptions = cache(async (): Promise<TagOption[] | null> => {
  if (!(await hasTaxonomy())) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("tags")
    .select("id, name, is_active")
    .order("name", { ascending: true });
  if (error) fail("tag options", error);
  return data.map(({ id, name, is_active }) => ({ id, name, isActive: is_active }));
});

/** The SKU a new product gets by default (see lib/catalogue/sku.ts); null if unreadable. */
export async function getSuggestedProductSku(): Promise<string | null> {
  try {
    return await nextProductSku(await createClient());
  } catch {
    return null;
  }
}
