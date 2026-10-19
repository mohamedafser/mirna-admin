"use server";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { loadAttributeCatalog, loadProductAttributes } from "@/lib/attributes/queries";
import {
  readProductAttributes,
  validateProductAttributes,
  type ProductAttributeError,
  type ProductAttributeRow,
} from "@/lib/attributes/rules";
import { getAdminOrNull } from "@/lib/auth/dal";
import { listCurrencies } from "@/lib/currencies/queries";
import {
  CURRENCY_PRICES_FIELD,
  readCurrencyPrices,
  type PriceRowErrors,
} from "@/lib/currency/product-prices";
import { parseWholeNumber } from "@/lib/inventory/rules";
import { parseMoney } from "@/lib/money";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import {
  ALT_TEXT_MAX_LENGTH,
  CATEGORY_IMAGES_BUCKET,
  extensionFor,
  PRODUCT_IMAGES_BUCKET,
  sniffImageType,
  validateImageFile,
  type ImageFileError,
} from "./images";
import { hasTaxonomy } from "./queries";
import { slugify } from "./slug";
import {
  hasFieldErrors,
  isUuid,
  parseSortOrder,
  readCategory,
  readProduct,
  readTag,
  validateCategory,
  validateProduct,
  validateTag,
  type CatalogueFieldError,
  type CategoryFieldErrors,
  type ProductFieldErrors,
  type ProductInput,
  type TagFieldErrors,
} from "./validation";

/**
 * Catalogue mutations. Every action:
 *  1. re-checks that the caller is an active admin (never trusts the client),
 *  2. validates input with the same rules as the forms,
 *  3. writes through the caller's own Supabase session, so RLS and the
 *     database constraints are the final word,
 *  4. maps database errors to safe codes (raw errors are only logged).
 */

type Supabase = SupabaseClient<Database>;

export type CatalogueFormError = "forbidden" | "notFound" | "conflict" | "network" | "unexpected";

export type CatalogueWarning =
  | "imageUploadFailed"
  | "imageCleanupFailed"
  | "stockNotSaved"
  | "stockConflict"
  | "attributesNotSaved"
  | "categoriesNotSaved"
  | "tagsNotSaved"
  | "pricesNotSaved";

export interface FormResult<Fields> {
  status: "idle" | "success" | "error";
  error?: CatalogueFormError;
  fieldErrors: Fields;
  warning?: CatalogueWarning;
  /** Id of the saved record (create → navigate to it). */
  id?: string;
  mode?: "created" | "updated";
  /** Changes on every submit, so the client can react to each result. */
  at: number;
}

export type CategoryFormResult = FormResult<CategoryFieldErrors>;
export type TagFormResult = FormResult<TagFieldErrors>;
export type ProductFormResult = FormResult<ProductFieldErrors> & {
  /** Attribute value errors, by attribute id. */
  attributeErrors?: Record<string, ProductAttributeError>;
  /** "Prices by currency" errors, by currency code. */
  priceErrors?: PriceRowErrors;
};

export type ActionResult =
  | { ok: true; warning?: CatalogueWarning }
  | { ok: false; error: CatalogueFormError | ImageFileError | "altTooLong" };

export type UploadResult =
  | { ok: true; imageId: string }
  | { ok: false; error: CatalogueFormError | ImageFileError | "altTooLong" };

function formError<F>(error: CatalogueFormError): FormResult<F> {
  return { status: "error", error, fieldErrors: {} as F, at: Date.now() };
}

function fieldFailure<F>(fieldErrors: F): FormResult<F> {
  return { status: "error", fieldErrors, at: Date.now() };
}

function log(scope: string, error: { code?: string; message?: string }) {
  console.error(`[catalogue] ${scope}: code=${error.code || "-"} message=${error.message || "-"}`);
}

/** Maps a PostgREST/PostgreSQL error to a field error or a form error. */
function mapDbError(
  error: PostgrestError,
  scope: string,
): { field?: string; code: CatalogueFieldError } | { form: CatalogueFormError } {
  const detail = `${error.message} ${error.details ?? ""}`;
  switch (error.code) {
    case "23505": // unique_violation
      if (detail.includes("tags_name_key")) return { field: "name", code: "tagNameTaken" };
      if (detail.includes("sku")) return { field: "sku", code: "skuTaken" };
      if (detail.includes("slug")) return { field: "slug", code: "slugTaken" };
      break;
    case "23503": // foreign_key_violation
      if (detail.includes("parent_id")) return { field: "parentId", code: "parentInvalid" };
      if (detail.includes("product_category:")) {
        return { field: "categoryIds", code: "categoriesInvalid" };
      }
      if (detail.includes("product_tag:")) return { field: "tagIds", code: "tagsInvalid" };
      return { field: "categoryId", code: "categoryInvalid" };
    case "23514": // check_violation
      // Subcategory rules (migration 022: trigger + categories_parent_not_self).
      if (detail.includes("category:has_subcategories")) {
        return { field: "parentId", code: "parentHasChildren" };
      }
      if (
        detail.includes("category:parent_is_subcategory") ||
        detail.includes("category:parent_cycle") ||
        detail.includes("parent_not_self")
      ) {
        return { field: "parentId", code: "parentInvalid" };
      }
      if (detail.includes("product_category:inactive")) {
        return { field: "categoryIds", code: "categoriesInactive" };
      }
      if (detail.includes("product_tag:inactive")) return { field: "tagIds", code: "tagsInactive" };
      if (detail.includes("compare_at_price")) {
        return { field: "compareAtPrice", code: "compareAtNotHigher" };
      }
      if (detail.includes("sku")) return { field: "sku", code: "skuInvalid" };
      if (detail.includes("slug")) return { field: "slug", code: "slugInvalid" };
      break;
    case "42501": // insufficient_privilege (RLS / grants)
      return { form: "forbidden" };
  }
  log(scope, error);
  // Fetch failures surface with an empty code.
  return { form: error.code ? "unexpected" : "network" };
}

function dbFailure<F>(error: PostgrestError, scope: string): FormResult<F> {
  const mapped = mapDbError(error, scope);
  if ("form" in mapped) return formError<F>(mapped.form);
  return fieldFailure({ [mapped.field!]: mapped.code } as F);
}

/** Validates an uploaded file by its real bytes; returns its type and extension. */
async function inspectImage(
  file: File,
): Promise<{ ok: true; contentType: string; ext: string } | { ok: false; error: ImageFileError }> {
  const declared = validateImageFile(file);
  if (declared) return { ok: false, error: declared };
  const detected = sniffImageType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!detected) return { ok: false, error: "imageType" };
  return { ok: true, contentType: detected, ext: extensionFor[detected] };
}

async function removeObject(supabase: Supabase, bucket: string, path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  if (error) console.error(`[catalogue] storage cleanup failed: bucket=${bucket} path=${path}`);
  return !error;
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function saveCategory(
  _prev: CategoryFormResult,
  data: FormData,
): Promise<CategoryFormResult> {
  if (!(await getAdminOrNull())) return formError("forbidden");

  const id = String(data.get("id") ?? "");
  const version = String(data.get("updatedAt") ?? "");
  const input = readCategory(data);
  const fieldErrors = validateCategory(input);
  if (id && input.parentId === id) fieldErrors.parentId = "parentInvalid";

  const file = data.get("image");
  const upload = file instanceof File && file.size > 0 ? file : null;
  const removeImage = data.get("removeImage") === "on";
  let image: { contentType: string; ext: string } | null = null;
  if (upload) {
    const inspected = await inspectImage(upload);
    if (inspected.ok) image = inspected;
    else fieldErrors.image = inspected.error;
  }
  if (hasFieldErrors(fieldErrors)) return fieldFailure(fieldErrors);

  const supabase = await createClient();
  const values = {
    name: input.name,
    slug: input.slug,
    description: input.description || null,
    sort_order: parseSortOrder(input.sortOrder) ?? 0,
    is_active: input.isActive,
    parent_id: input.parentId || null,
  };

  let categoryId: string;
  let previousImagePath: string | null = null;

  if (id) {
    if (!isUuid(id)) return formError("notFound");
    // Optimistic concurrency: only update the version the admin loaded.
    const { data: current, error: readError } = await supabase
      .from("categories")
      .select("updated_at, image_path")
      .eq("id", id)
      .maybeSingle();
    if (readError) return dbFailure(readError, "read category");
    if (!current) return formError("notFound");
    if (current.updated_at !== version) return formError("conflict");

    const { data: updated, error } = await supabase
      .from("categories")
      .update(values)
      .eq("id", id)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    if (error) return dbFailure(error, "update category");
    if (!updated) return formError("conflict");
    categoryId = id;
    previousImagePath = current.image_path;
  } else {
    const { data: created, error } = await supabase
      .from("categories")
      .insert(values)
      .select("id")
      .single();
    if (error) return dbFailure(error, "create category");
    categoryId = created.id;
  }

  // Image: upload the new file first, then point the row at it, then delete
  // the old file — so the category never references a missing object.
  let warning: CatalogueWarning | undefined;
  if (upload && image) {
    const path = `categories/${categoryId}/${randomUUID()}.${image.ext}`;
    const bucket = supabase.storage.from(CATEGORY_IMAGES_BUCKET);
    const { error: uploadError } = await bucket.upload(path, upload, {
      contentType: image.contentType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (uploadError) {
      console.error(`[catalogue] category image upload failed: ${uploadError.message}`);
      warning = "imageUploadFailed";
    } else {
      const imageUrl = bucket.getPublicUrl(path).data.publicUrl;
      const { error } = await supabase
        .from("categories")
        .update({ image_url: imageUrl, image_path: path })
        .eq("id", categoryId);
      if (error) {
        log("link category image", error);
        await removeObject(supabase, CATEGORY_IMAGES_BUCKET, path);
        warning = "imageUploadFailed";
      } else if (previousImagePath) {
        if (!(await removeObject(supabase, CATEGORY_IMAGES_BUCKET, previousImagePath))) {
          warning = "imageCleanupFailed";
        }
      }
    }
  } else if (removeImage && previousImagePath !== null) {
    const { error } = await supabase
      .from("categories")
      .update({ image_url: null, image_path: null })
      .eq("id", categoryId);
    if (error) return dbFailure(error, "remove category image");
    if (!(await removeObject(supabase, CATEGORY_IMAGES_BUCKET, previousImagePath))) {
      warning = "imageCleanupFailed";
    }
  }

  refresh();
  return {
    status: "success",
    fieldErrors: {},
    id: categoryId,
    mode: id ? "updated" : "created",
    warning,
    at: Date.now(),
  };
}

export type CreateSubcategoryResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: CatalogueFormError | CatalogueFieldError };

/**
 * Creates an active subcategory under a top-level category from the product
 * form ("+ New subcategory"). The slug comes from the name; when it's taken,
 * the parent's slug is appended ("winter-kids"), then a number.
 */
export async function createSubcategory(
  parentId: string,
  rawName: string,
  /** Position among its siblings (the structure view appends at the end). */
  sortOrder = 0,
): Promise<CreateSubcategoryResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  const name = rawName.trim();
  const nameError = validateCategory({
    name,
    slug: slugify(name) || "x",
    description: "",
    sortOrder: String(sortOrder),
    isActive: true,
    parentId,
  });
  if (nameError.name) return { ok: false, error: nameError.name };
  if (nameError.sortOrder) return { ok: false, error: nameError.sortOrder };
  if (nameError.parentId || !isUuid(parentId)) return { ok: false, error: "parentInvalid" };

  const supabase = await createClient();
  const { data: parent, error: parentError } = await supabase
    .from("categories")
    .select("slug, parent_id")
    .eq("id", parentId)
    .maybeSingle();
  if (parentError) {
    log("read parent category", parentError);
    return { ok: false, error: parentError.code ? "unexpected" : "network" };
  }
  if (!parent || parent.parent_id) return { ok: false, error: "parentInvalid" };

  const base = slugify(name);
  if (!base) return { ok: false, error: "slugInvalid" };
  const candidates = [base, `${base}-${parent.slug}`, ...[2, 3, 4].map((n) => `${base}-${n}`)];
  for (const slug of candidates) {
    const { data: created, error } = await supabase
      .from("categories")
      .insert({ name, slug, parent_id: parentId, is_active: true, sort_order: sortOrder })
      .select("id, name")
      .single();
    if (!error) {
      refresh();
      return { ok: true, id: created.id, name: created.name };
    }
    if (error.code === "23505") continue; // slug taken: try the next one
    const mapped = mapDbError(error, "create subcategory");
    return { ok: false, error: "form" in mapped ? mapped.form : mapped.code };
  }
  return { ok: false, error: "slugTaken" };
}

/** One category's new place in the structure view. */
export interface CategoryPlacement {
  id: string;
  sortOrder: number;
  /** Only when the parent changes: the new parent id, or null for top-level. */
  parentId?: string | null;
}

export type ArrangeResult =
  { ok: true } | { ok: false; error: CatalogueFormError | "parentInvalid" | "parentHasChildren" };

const MAX_PLACEMENTS = 500;

/**
 * Saves a drag-and-drop change: new sort orders and, for a moved category, its
 * new parent. Parent changes go first, so the hierarchy trigger (two levels,
 * no cycles) rejects an invalid move before any order is touched.
 */
export async function arrangeCategories(placements: CategoryPlacement[]): Promise<ArrangeResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (
    !Array.isArray(placements) ||
    placements.length === 0 ||
    placements.length > MAX_PLACEMENTS ||
    new Set(placements.map((placement) => placement?.id)).size !== placements.length ||
    !placements.every(
      (placement) =>
        isUuid(placement?.id) &&
        parseSortOrder(String(placement.sortOrder)) !== null &&
        (placement.parentId === undefined ||
          placement.parentId === null ||
          (isUuid(placement.parentId) && placement.parentId !== placement.id)),
    )
  ) {
    return { ok: false, error: "unexpected" };
  }

  const supabase = await createClient();
  const failure = (error: PostgrestError): ArrangeResult => {
    const mapped = mapDbError(error, "arrange categories");
    if ("form" in mapped) return { ok: false, error: mapped.form };
    return {
      ok: false,
      error: mapped.code === "parentHasChildren" ? "parentHasChildren" : "parentInvalid",
    };
  };

  // Moves one at a time (each is checked against the hierarchy so far).
  for (const { id, sortOrder, parentId } of placements) {
    if (parentId === undefined) continue;
    const { data, error } = await supabase
      .from("categories")
      .update({ parent_id: parentId, sort_order: sortOrder })
      .eq("id", id)
      .select("id")
      .maybeSingle();
    if (error) return failure(error);
    if (!data) return { ok: false, error: "notFound" };
  }

  // Order-only updates don't touch parent_id, so they skip the hierarchy lock.
  const results = await Promise.all(
    placements
      .filter((placement) => placement.parentId === undefined)
      .map(({ id, sortOrder }) =>
        supabase.from("categories").update({ sort_order: sortOrder }).eq("id", id),
      ),
  );
  const failed = results.find((result) => result.error);
  refresh();
  if (failed?.error) return failure(failed.error);
  return { ok: true };
}

export async function setCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  return setActive("categories", id, active);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export type BulkStatusResult =
  | { ok: true; updated: number }
  | { ok: false; error: CatalogueFormError };

/** Products per bulk change: one list page at most (plus headroom). */
const MAX_BULK = 100;

/**
 * Activates or deactivates several products at once (the product list's
 * bulk actions). Only products whose status actually changes are updated;
 * `updated` is how many did.
 */
export async function setProductsActive(
  ids: string[],
  active: boolean,
): Promise<BulkStatusResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > MAX_BULK ||
    !ids.every(isUuid) ||
    typeof active !== "boolean"
  ) {
    return { ok: false, error: "unexpected" };
  }
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products")
    .update({ is_active: active })
    .in("id", [...new Set(ids)])
    .neq("is_active", active)
    .select("id");
  if (error) {
    const mapped = mapDbError(error, "set products status");
    return { ok: false, error: "form" in mapped ? mapped.form : "unexpected" };
  }
  refresh();
  return { ok: true, updated: data.length };
}

export async function saveProduct(
  _prev: ProductFormResult,
  data: FormData,
): Promise<ProductFormResult> {
  if (!(await getAdminOrNull())) return formError("forbidden");

  const id = String(data.get("id") ?? "");
  const version = String(data.get("updatedAt") ?? "");
  const input = readProduct(data);
  // Reserved units are re-checked by adjust_inventory(); here only the input.
  const fieldErrors = validateProduct(input);
  if (hasFieldErrors(fieldErrors)) return fieldFailure(fieldErrors);

  const supabase = await createClient();

  // Product type + attribute values, checked against a fresh copy of the
  // attribute catalog (null until migration 023 is applied: skipped).
  const attributeInput = readProductAttributes(data);
  const catalog = await loadAttributeCatalog(supabase);
  let attributeRows: ProductAttributeRow[] | null = null;
  if (catalog) {
    const saved = id && isUuid(id) ? await loadProductAttributes(supabase, id) : null;
    const checked = validateProductAttributes(
      attributeInput.productTypeId,
      attributeInput.entries,
      catalog,
      saved,
    );
    if (checked.typeError || hasFieldErrors(checked.errors)) {
      return {
        ...fieldFailure<ProductFieldErrors>(
          checked.typeError ? { productTypeId: checked.typeError } : {},
        ),
        attributeErrors: checked.errors,
      };
    }
    attributeRows = checked.rows;
  }
  const productTypeId = attributeInput.productTypeId || null;

  // Prices in other currencies (migration 031; absent before it: skipped).
  // The product's own currency is its price above.
  let otherPrices: { currency: string; price: bigint; salePrice: bigint | null }[] | null = null;
  if (data.has(CURRENCY_PRICES_FIELD)) {
    const currencies = await listCurrencies();
    if (currencies) {
      const { rows, errors } = readCurrencyPrices(
        String(data.get(CURRENCY_PRICES_FIELD)),
        currencies,
      );
      if (Object.keys(errors).length > 0) {
        return { ...fieldFailure<ProductFieldErrors>({}), priceErrors: errors };
      }
      otherPrices = rows.filter((row) => row.currency !== input.currencyCode);
    }
  }

  // Category must exist; a new or changed category must also be active.
  const { data: category, error: categoryError } = await supabase
    .from("categories")
    .select("id, is_active")
    .eq("id", input.categoryId)
    .maybeSingle();
  if (categoryError) return dbFailure(categoryError, "read category");
  if (!category) return fieldFailure({ categoryId: "categoryInvalid" });

  let current: { updated_at: string; category_id: string | null } | null = null;
  if (id) {
    if (!isUuid(id)) return formError("notFound");
    const { data: row, error } = await supabase
      .from("products")
      .select("updated_at, category_id")
      .eq("id", id)
      .maybeSingle();
    if (error) return dbFailure(error, "read product");
    if (!row) return formError("notFound");
    if (row.updated_at !== version) return formError("conflict");
    current = row;
  }
  if (!category.is_active && current?.category_id !== category.id) {
    return fieldFailure({ categoryId: "categoryInactive" });
  }

  // Extra categories and tags (skipped until migration 027 is applied).
  const taxonomy = await hasTaxonomy();
  if (taxonomy) {
    const assignmentErrors = await checkAssignments(supabase, id || null, input);
    if (assignmentErrors) return fieldFailure(assignmentErrors);
  }

  // Validated above; NUMERIC values are sent as exact decimal strings (never floats).
  const price = parseMoney(input.price, input.currencyCode);
  const compareAt = input.compareAtPrice
    ? parseMoney(input.compareAtPrice, input.currencyCode)
    : null;
  const values = {
    name: input.name,
    slug: input.slug,
    sku: input.sku,
    category_id: input.categoryId,
    short_description: input.shortDescription || null,
    description: input.description || null,
    price: (price.ok ? price.value : "0") as unknown as number,
    compare_at_price: (compareAt?.ok ? compareAt.value : null) as unknown as number | null,
    currency_code: input.currencyCode,
  };

  if (id) {
    // Status is changed with the Activate/Deactivate action, not this form,
    // so saving edits never flips it back.
    const { data: updated, error } = await supabase
      .from("products")
      .update(values)
      .eq("id", id)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    if (error) return dbFailure(error, "update product");
    if (!updated) return formError("conflict");
    const expected = parseWholeNumber(String(data.get("expectedStock") ?? ""));
    // Each part is saved even if an earlier one failed; the first problem is reported.
    const warnings = [
      await saveProductInventory(supabase, id, input, expected, "updated"),
      await saveProductAttributes(supabase, id, productTypeId, attributeRows),
      taxonomy ? await saveProductAssignments(supabase, id, input) : undefined,
      await saveProductPrices(supabase, id, otherPrices),
    ];
    const warning = warnings.find(Boolean);
    refresh();
    return { status: "success", fieldErrors: {}, id, mode: "updated", warning, at: Date.now() };
  }

  const { data: created, error } = await supabase
    .from("products")
    .insert({ ...values, is_active: input.isActive })
    .select("id")
    .single();
  if (error) return dbFailure(error, "create product");
  // The insert triggers already created the inventory row with 0 units and
  // the main category's assignment.
  const warnings = [
    await saveProductInventory(supabase, created.id, input, 0, "created"),
    await saveProductAttributes(supabase, created.id, productTypeId, attributeRows),
    taxonomy ? await saveProductAssignments(supabase, created.id, input) : undefined,
    await saveProductPrices(supabase, created.id, otherPrices),
  ];
  const warning = warnings.find(Boolean);
  return {
    status: "success",
    fieldErrors: {},
    id: created.id,
    mode: "created",
    warning,
    at: Date.now(),
  };
}

/**
 * Applies the form's stock and low-stock threshold after the product itself
 * was saved. Stock goes through adjust_inventory() ("set", with the quantity
 * the admin loaded), so it is locked, validated and written to the stock
 * history — and never overwrites a change someone else made meanwhile. A
 * failure here doesn't undo the product save; it is reported as a warning.
 */
async function saveProductInventory(
  supabase: Supabase,
  productId: string,
  input: { stock: string; lowStockThreshold: string },
  expected: number | null,
  mode: "created" | "updated",
): Promise<CatalogueWarning | undefined> {
  // Products with variants: stock is managed per variant (migration 024), and
  // the product row is their derived total, so the form's values are ignored.
  if (mode === "updated") {
    const { count, error } = await supabase
      .from("product_variants")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId);
    if (!error && (count ?? 0) > 0) return undefined;
  }

  const stock = parseWholeNumber(input.stock) ?? 0;
  const threshold = parseWholeNumber(input.lowStockThreshold) ?? 0;

  const { data: row, error: readError } = await supabase
    .from("inventory")
    .select("quantity, low_stock_threshold")
    .eq("product_id", productId)
    .maybeSingle();
  if (readError) {
    log("read inventory", readError);
    return "stockNotSaved";
  }
  let current = row;
  if (!current) {
    // Products created before the inventory trigger may have no row yet.
    const { error } = await supabase.rpc("initialize_inventory", { p_product_id: productId });
    if (error) {
      log("initialize inventory", error);
      return "stockNotSaved";
    }
    current = { quantity: 0, low_stock_threshold: 0 };
  }

  if (threshold !== current.low_stock_threshold) {
    const { error } = await supabase
      .from("inventory")
      .update({ low_stock_threshold: threshold })
      .eq("product_id", productId);
    if (error) {
      log("update threshold", error);
      return "stockNotSaved";
    }
  }

  // Unchanged from what the admin loaded → leave stock alone.
  if (stock === (expected ?? current.quantity)) return undefined;
  const { error } = await supabase.rpc("adjust_inventory", {
    p_product_id: productId,
    p_type: "set",
    p_quantity: stock,
    p_reason: mode === "created" ? "stock_received" : "manual_correction",
    p_notes: null,
    p_expected_quantity: expected ?? current.quantity,
  });
  if (!error) return undefined;
  if (error.message === "inventory:conflict" || error.code === "40001") return "stockConflict";
  log("set stock", error);
  return "stockNotSaved";
}

/**
 * Replaces the product's prices in its other currencies in one transaction
 * (set_product_prices; its own currency was saved with the product and is
 * mirrored by a trigger). Amounts are minor units, sent as strings so they
 * stay exact. A failure is reported as a warning.
 */
async function saveProductPrices(
  supabase: Supabase,
  productId: string,
  rows: { currency: string; price: bigint; salePrice: bigint | null }[] | null,
): Promise<CatalogueWarning | undefined> {
  if (rows === null) return undefined;
  const { error } = await supabase.rpc("set_product_prices", {
    p_product_id: productId,
    p_prices: rows.map((row) => ({
      currency_code: row.currency,
      price: row.price.toString(),
      sale_price: row.salePrice?.toString() ?? null,
    })) as unknown as Json,
  });
  if (!error) return undefined;
  log("set product prices", error);
  return "pricesNotSaved";
}

/**
 * Sets the product's type and replaces its attribute values in one database
 * transaction (set_product_attributes re-checks required attributes). Runs
 * after the product itself was saved; a failure is reported as a warning.
 */
async function saveProductAttributes(
  supabase: Supabase,
  productId: string,
  productTypeId: string | null,
  rows: ProductAttributeRow[] | null,
): Promise<CatalogueWarning | undefined> {
  if (rows === null) return undefined;
  const { error } = await supabase.rpc("set_product_attributes", {
    p_product_id: productId,
    p_product_type_id: productTypeId,
    p_values: rows as unknown as Json,
  });
  if (!error) return undefined;
  log("set product attributes", error);
  return "attributesNotSaved";
}

/**
 * Extra categories and tags must exist; newly added ones must be active
 * (ones the product already has may stay after being deactivated). The
 * database re-checks this in set_product_categories / set_product_tags.
 */
async function checkAssignments(
  supabase: Supabase,
  productId: string | null,
  input: Pick<ProductInput, "categoryIds" | "tagIds">,
): Promise<ProductFieldErrors | null> {
  const none = Promise.resolve({ data: [] as { id: string; is_active: boolean }[], error: null });
  const noneSaved = Promise.resolve({ data: [] as { id: string }[], error: null });
  const [categories, tags, savedCategories, savedTags] = await Promise.all([
    input.categoryIds.length
      ? supabase.from("categories").select("id, is_active").in("id", input.categoryIds)
      : none,
    input.tagIds.length
      ? supabase.from("tags").select("id, is_active").in("id", input.tagIds)
      : none,
    productId
      ? supabase.from("product_categories").select("id:category_id").eq("product_id", productId)
      : noneSaved,
    productId
      ? supabase.from("product_tags").select("id:tag_id").eq("product_id", productId)
      : noneSaved,
  ]);
  const error = categories.error ?? tags.error ?? savedCategories.error ?? savedTags.error;
  if (error) {
    log("check assignments", error);
    return null; // the RPCs still enforce the rules; a failure becomes a warning
  }
  const errors: ProductFieldErrors = {};
  const check = (
    rows: { id: string; is_active: boolean }[],
    wanted: string[],
    saved: { id: string }[],
  ) => {
    const savedIds = new Set(saved.map((row) => row.id));
    if (rows.length !== wanted.length) return "invalid";
    if (rows.some((row) => !row.is_active && !savedIds.has(row.id))) return "inactive";
  };
  const categoryIssue = check(categories.data!, input.categoryIds, savedCategories.data!);
  if (categoryIssue === "invalid") errors.categoryIds = "categoriesInvalid";
  if (categoryIssue === "inactive") errors.categoryIds = "categoriesInactive";
  const tagIssue = check(tags.data!, input.tagIds, savedTags.data!);
  if (tagIssue === "invalid") errors.tagIds = "tagsInvalid";
  if (tagIssue === "inactive") errors.tagIds = "tagsInactive";
  return hasFieldErrors(errors) ? errors : null;
}

/**
 * Replaces the product's extra categories and tags, each in one database
 * transaction (the main category is always kept). Runs after the product
 * itself was saved; a failure is reported as a warning.
 */
async function saveProductAssignments(
  supabase: Supabase,
  productId: string,
  input: Pick<ProductInput, "categoryIds" | "tagIds">,
): Promise<CatalogueWarning | undefined> {
  const [categories, tags] = await Promise.all([
    supabase.rpc("set_product_categories", {
      p_product_id: productId,
      p_category_ids: input.categoryIds,
    }),
    supabase.rpc("set_product_tags", { p_product_id: productId, p_tag_ids: input.tagIds }),
  ]);
  if (categories.error) log("set product categories", categories.error);
  if (tags.error) log("set product tags", tags.error);
  if (categories.error) return "categoriesNotSaved";
  if (tags.error) return "tagsNotSaved";
}

export async function setProductActive(id: string, active: boolean): Promise<ActionResult> {
  return setActive("products", id, active);
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export async function saveTag(_prev: TagFormResult, data: FormData): Promise<TagFormResult> {
  if (!(await getAdminOrNull())) return formError("forbidden");

  const id = String(data.get("id") ?? "");
  const version = String(data.get("updatedAt") ?? "");
  const input = readTag(data);
  const fieldErrors = validateTag(input);
  if (hasFieldErrors(fieldErrors)) return fieldFailure(fieldErrors);

  const supabase = await createClient();
  const values = { name: input.name, slug: input.slug, is_active: input.isActive };

  if (id) {
    if (!isUuid(id)) return formError("notFound");
    // Optimistic concurrency: only update the version the admin loaded.
    const { data: updated, error } = await supabase
      .from("tags")
      .update(values)
      .eq("id", id)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    if (error) return dbFailure(error, "update tag");
    if (!updated) {
      const { data: exists } = await supabase.from("tags").select("id").eq("id", id).maybeSingle();
      return formError(exists ? "conflict" : "notFound");
    }
    refresh();
    return { status: "success", fieldErrors: {}, id, mode: "updated", at: Date.now() };
  }

  const { data: created, error } = await supabase.from("tags").insert(values).select("id").single();
  if (error) return dbFailure(error, "create tag");
  refresh();
  return { status: "success", fieldErrors: {}, id: created.id, mode: "created", at: Date.now() };
}

export type CreateTagResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: CatalogueFormError | CatalogueFieldError };

/**
 * Creates an active tag from the product form ("Create tag …"). The slug
 * comes from the name (a numbered one when taken); names without Latin
 * letters (e.g. Arabic) get a generated slug the admin can edit later.
 */
export async function createTag(rawName: string): Promise<CreateTagResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  const name = rawName.trim();
  const base = slugify(name).slice(0, 90).replace(/-+$/, "") || `tag-${randomUUID().slice(0, 8)}`;
  const nameError = validateTag({ name, slug: base, isActive: true }).name;
  if (nameError) return { ok: false, error: nameError };

  const supabase = await createClient();
  for (const slug of [base, ...[2, 3, 4, 5].map((n) => `${base}-${n}`)]) {
    const { data: created, error } = await supabase
      .from("tags")
      .insert({ name, slug, is_active: true })
      .select("id, name")
      .single();
    if (!error) {
      refresh();
      return { ok: true, id: created.id, name: created.name };
    }
    const mapped = mapDbError(error, "create tag");
    if ("field" in mapped && mapped.code === "slugTaken") continue; // try the next slug
    return { ok: false, error: "form" in mapped ? mapped.form : mapped.code };
  }
  return { ok: false, error: "slugTaken" };
}

export async function setTagActive(id: string, active: boolean): Promise<ActionResult> {
  return setActive("tags", id, active);
}

async function setActive(
  table: "categories" | "products" | "tags",
  id: string,
  active: boolean,
): Promise<ActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(id)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .update({ is_active: active })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) {
    const mapped = mapDbError(error, `set ${table} status`);
    return { ok: false, error: "form" in mapped ? mapped.form : "unexpected" };
  }
  if (!data) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Product images
// ---------------------------------------------------------------------------

/**
 * Uploads one image (one file per call keeps requests small and retryable).
 * Optional `alt` in the form data sets its alt text in the same insert.
 */
export async function uploadProductImage(productId: string, data: FormData): Promise<UploadResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(productId)) return { ok: false, error: "notFound" };

  const file = data.get("file");
  if (!(file instanceof File)) return { ok: false, error: "imageEmpty" };
  const alt = String(data.get("alt") ?? "").trim();
  if (alt.length > ALT_TEXT_MAX_LENGTH) return { ok: false, error: "altTooLong" };
  const image = await inspectImage(file);
  if (!image.ok) return { ok: false, error: image.error };

  const supabase = await createClient();
  const { data: product, error: productError } = await supabase
    .from("products")
    .select("id, images:product_images(is_primary, sort_order)")
    .eq("id", productId)
    .maybeSingle();
  if (productError) return { ok: false, error: "unexpected" };
  if (!product) return { ok: false, error: "notFound" };

  const path = `products/${productId}/${randomUUID()}.${image.ext}`;
  const bucket = supabase.storage.from(PRODUCT_IMAGES_BUCKET);
  const { error: uploadError } = await bucket.upload(path, file, {
    contentType: image.contentType,
    cacheControl: "31536000",
    upsert: false,
  });
  if (uploadError) {
    console.error(`[catalogue] product image upload failed: ${uploadError.message}`);
    return { ok: false, error: "unexpected" };
  }

  const sortOrder = Math.max(-1, ...product.images.map((image) => image.sort_order)) + 1;
  const { data: inserted, error } = await supabase
    .from("product_images")
    .insert({
      product_id: productId,
      storage_path: path,
      public_url: bucket.getPublicUrl(path).data.publicUrl,
      alt_text: alt || null,
      sort_order: sortOrder,
      // The first image becomes the primary image automatically.
      is_primary: !product.images.some((image) => image.is_primary),
    })
    .select("id")
    .single();
  if (error) {
    log("save product image", error);
    // Don't leave an orphaned file behind.
    await removeObject(supabase, PRODUCT_IMAGES_BUCKET, path);
    return { ok: false, error: error.code === "42501" ? "forbidden" : "unexpected" };
  }

  refresh();
  return { ok: true, imageId: inserted.id };
}

export async function updateProductImageAlt(
  imageId: string,
  altText: string,
): Promise<ActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(imageId)) return { ok: false, error: "notFound" };
  const alt = altText.trim();
  if (alt.length > ALT_TEXT_MAX_LENGTH) return { ok: false, error: "altTooLong" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_images")
    .update({ alt_text: alt || null })
    .eq("id", imageId)
    .select("id")
    .maybeSingle();
  if (error) return imageDbFailure(error, "update image alt");
  if (!data) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}

export async function setPrimaryProductImage(imageId: string): Promise<ActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(imageId)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_primary_product_image", { p_image_id: imageId });
  if (error) return imageDbFailure(error, "set primary image");
  refresh();
  return { ok: true };
}

export async function reorderProductImages(
  productId: string,
  imageIds: string[],
): Promise<ActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(productId) || !imageIds.every(isUuid)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_product_images", {
    p_product_id: productId,
    p_image_ids: imageIds,
  });
  if (error) return imageDbFailure(error, "reorder images");
  refresh();
  return { ok: true };
}

/**
 * Deletes the image row (promoting the next primary in the same transaction),
 * then its Storage file. If the file can't be removed the row is still gone,
 * and the result says so instead of claiming a full delete.
 */
export async function deleteProductImage(imageId: string): Promise<ActionResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(imageId)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { data: path, error } = await supabase.rpc("delete_product_image", { p_image_id: imageId });
  if (error) return imageDbFailure(error, "delete image");

  refresh();
  const removed = await removeObject(supabase, PRODUCT_IMAGES_BUCKET, path);
  return removed ? { ok: true } : { ok: true, warning: "imageCleanupFailed" };
}

function imageDbFailure(error: PostgrestError, scope: string): ActionResult {
  if (error.code === "P0002") return { ok: false, error: "notFound" };
  const mapped = mapDbError(error, scope);
  return { ok: false, error: "form" in mapped ? mapped.form : "unexpected" };
}
