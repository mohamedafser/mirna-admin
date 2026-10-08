"use server";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import { parseWholeNumber } from "@/lib/inventory/rules";
import { parseMoney } from "@/lib/money";
import type { Database } from "@/lib/supabase/database.types";
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
import {
  hasFieldErrors,
  isUuid,
  parseSortOrder,
  readCategory,
  readProduct,
  validateCategory,
  validateProduct,
  type CatalogueFieldError,
  type CategoryFieldErrors,
  type ProductFieldErrors,
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
  "imageUploadFailed" | "imageCleanupFailed" | "stockNotSaved" | "stockConflict";

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
export type ProductFormResult = FormResult<ProductFieldErrors>;

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
      if (detail.includes("sku")) return { field: "sku", code: "skuTaken" };
      if (detail.includes("slug")) return { field: "slug", code: "slugTaken" };
      break;
    case "23503": // foreign_key_violation
      return { field: "categoryId", code: "categoryInvalid" };
    case "23514": // check_violation
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

export async function setCategoryActive(id: string, active: boolean): Promise<ActionResult> {
  return setActive("categories", id, active);
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

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
    const warning = await saveProductInventory(supabase, id, input, expected, "updated");
    refresh();
    return { status: "success", fieldErrors: {}, id, mode: "updated", warning, at: Date.now() };
  }

  const { data: created, error } = await supabase
    .from("products")
    .insert({ ...values, is_active: input.isActive })
    .select("id")
    .single();
  if (error) return dbFailure(error, "create product");
  // The insert trigger already created the inventory row with 0 units.
  const warning = await saveProductInventory(supabase, created.id, input, 0, "created");
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

export async function setProductActive(id: string, active: boolean): Promise<ActionResult> {
  return setActive("products", id, active);
}

async function setActive(
  table: "categories" | "products",
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
