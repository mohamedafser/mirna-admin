"use server";

import type { PostgrestError } from "@supabase/supabase-js";
import { refresh } from "next/cache";
import { getAdminOrNull } from "@/lib/auth/dal";
import type { ActionResult, CatalogueFormError } from "@/lib/catalogue/actions";
import { isUuid } from "@/lib/catalogue/validation";
import { createClient } from "@/lib/supabase/server";
import {
  hasErrors,
  isChoiceType,
  readAttribute,
  readProductType,
  validateAttribute,
  validateProductType,
  type AttributeDataType,
  type AttributeFieldError,
  type AttributeFormErrors,
  type ProductTypeFieldErrors,
} from "./rules";

/**
 * Product type & attribute mutations. Same contract as the catalogue actions:
 * re-check the admin, validate with the form rules, write through the
 * caller's session (RLS + constraints + triggers are final), and map database
 * errors to safe codes (raw errors are only logged).
 */

export interface AttributeFormResult<Fields> {
  status: "idle" | "success" | "error";
  error?: CatalogueFormError;
  fieldErrors: Fields;
  /** Saved, but its attributes / values couldn't be: the admin is told. */
  warning?: "attributesNotSaved";
  id?: string;
  mode?: "created" | "updated";
  at: number;
}

export type ProductTypeFormResult = AttributeFormResult<ProductTypeFieldErrors>;
export type AttributeSaveResult = AttributeFormResult<AttributeFormErrors>;

export type DeleteResult = { ok: true } | { ok: false; error: CatalogueFormError | "inUse" };

function formError<F>(error: CatalogueFormError): AttributeFormResult<F> {
  return { status: "error", error, fieldErrors: {} as F, at: Date.now() };
}

function fieldFailure<F>(fieldErrors: F): AttributeFormResult<F> {
  return { status: "error", fieldErrors, at: Date.now() };
}

function log(scope: string, error: { code?: string; message?: string }) {
  console.error(`[attributes] ${scope}: code=${error.code || "-"} message=${error.message || "-"}`);
}

/** Maps a PostgREST/PostgreSQL error to a field error or a form error. */
function mapDbError(
  error: PostgrestError,
  scope: string,
): { field: string; code: AttributeFieldError } | { form: CatalogueFormError } {
  const detail = `${error.message} ${error.details ?? ""}`;
  switch (error.code) {
    case "23505": // unique_violation
      if (detail.includes("attribute_values")) return { field: "values", code: "valueDuplicate" };
      if (detail.includes("code")) return { field: "code", code: "codeTaken" };
      if (detail.includes("slug")) return { field: "slug", code: "slugTaken" };
      break;
    case "23503": // foreign_key_violation: a value still used by a product
      if (detail.includes("attribute_values")) return { field: "values", code: "valueInUse" };
      if (detail.includes("attribute")) return { field: "attributes", code: "attributesInvalid" };
      break;
    case "23514": // check_violation (constraints + migration 023 triggers)
      if (detail.includes("attribute:type_locked")) {
        return { field: "dataType", code: "dataTypeLocked" };
      }
      if (detail.includes("attribute:multiple_in_use")) {
        return { field: "allowsMultiple", code: "multipleInUse" };
      }
      if (detail.includes("attribute_value:")) return { field: "values", code: "valuesInvalid" };
      if (detail.includes("slug")) return { field: "slug", code: "slugInvalid" };
      if (detail.includes("code")) return { field: "code", code: "codeInvalid" };
      break;
    case "P0002":
      return { form: "notFound" };
    case "42501": // insufficient_privilege (RLS / grants)
      return { form: "forbidden" };
  }
  log(scope, error);
  return { form: error.code ? "unexpected" : "network" };
}

function dbFailure<F>(error: PostgrestError, scope: string): AttributeFormResult<F> {
  const mapped = mapDbError(error, scope);
  if ("form" in mapped) return formError<F>(mapped.form);
  return fieldFailure({ [mapped.field]: mapped.code } as F);
}

/**
 * Optimistic concurrency: reads the row's updated_at and refuses to save over
 * a version the admin didn't load.
 */
async function checkVersion(
  table: "product_types" | "attributes",
  id: string,
  version: string,
): Promise<{ ok: true } | { ok: false; error: CatalogueFormError; db?: PostgrestError }> {
  if (!isUuid(id)) return { ok: false, error: "notFound" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from(table)
    .select("updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: "unexpected", db: error };
  if (!data) return { ok: false, error: "notFound" };
  if (data.updated_at !== version) return { ok: false, error: "conflict" };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Product types
// ---------------------------------------------------------------------------

export async function saveProductType(
  _prev: ProductTypeFormResult,
  data: FormData,
): Promise<ProductTypeFormResult> {
  if (!(await getAdminOrNull())) return formError("forbidden");

  const id = String(data.get("id") ?? "");
  const version = String(data.get("updatedAt") ?? "");
  const input = readProductType(data);
  const fieldErrors = validateProductType(input);
  if (hasErrors(fieldErrors)) return fieldFailure(fieldErrors);

  const supabase = await createClient();
  const values = {
    name: input.name,
    slug: input.slug,
    description: input.description || null,
    is_active: input.isActive,
  };

  let typeId = id;
  if (id) {
    const current = await checkVersion("product_types", id, version);
    if (!current.ok) {
      return current.db ? dbFailure(current.db, "read product type") : formError(current.error);
    }
    const { data: updated, error } = await supabase
      .from("product_types")
      .update(values)
      .eq("id", id)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    if (error) return dbFailure(error, "update product type");
    if (!updated) return formError("conflict");
  } else {
    const { data: created, error } = await supabase
      .from("product_types")
      .insert(values)
      .select("id")
      .single();
    if (error) return dbFailure(error, "create product type");
    typeId = created.id;
  }

  // Default attributes are replaced in one transaction (order = position).
  const { error } = await supabase.rpc("set_product_type_attributes", {
    p_product_type_id: typeId,
    p_attributes: input.attributes.map((item) => ({
      attribute_id: item.attributeId,
      is_required: item.isRequired,
    })),
  });
  let warning: ProductTypeFormResult["warning"];
  if (error) {
    // The type itself was saved; on an edit the admin can retry right away.
    if (id) return dbFailure(error, "set type attributes");
    log("set type attributes", error);
    warning = "attributesNotSaved";
  }

  refresh();
  return {
    status: "success",
    fieldErrors: {},
    id: typeId,
    mode: id ? "updated" : "created",
    warning,
    at: Date.now(),
  };
}

export async function setProductTypeActive(id: string, active: boolean): Promise<ActionResult> {
  return setActive("product_types", id, active);
}

export async function deleteProductType(id: string): Promise<DeleteResult> {
  return remove("product_types", id);
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export async function saveAttribute(
  _prev: AttributeSaveResult,
  data: FormData,
): Promise<AttributeSaveResult> {
  if (!(await getAdminOrNull())) return formError("forbidden");

  const id = String(data.get("id") ?? "");
  const version = String(data.get("updatedAt") ?? "");
  const input = readAttribute(data);
  const fieldErrors = validateAttribute(input);
  if (hasErrors(fieldErrors)) return fieldFailure(fieldErrors);

  const type = input.dataType as AttributeDataType;
  const choice = isChoiceType(type);
  const supabase = await createClient();
  const values = {
    name: input.name,
    code: input.code,
    data_type: type,
    unit: type === "NUMBER" ? input.unit || null : null,
    allows_multiple: choice && input.allowsMultiple,
    creates_variants: !choice || input.createsVariants,
    description: input.description || null,
    is_active: input.isActive,
  };

  let attributeId = id;
  if (id) {
    const current = await checkVersion("attributes", id, version);
    if (!current.ok) {
      return current.db ? dbFailure(current.db, "read attribute") : formError(current.error);
    }
    // Becoming TEXT / NUMBER / BOOLEAN drops unused choice values (migration 023 trigger).
    const { data: updated, error } = await supabase
      .from("attributes")
      .update(values)
      .eq("id", id)
      .eq("updated_at", version)
      .select("id")
      .maybeSingle();
    if (error) return dbFailure(error, "update attribute");
    if (!updated) return formError("conflict");
  } else {
    const { data: created, error } = await supabase
      .from("attributes")
      .insert(values)
      .select("id")
      .single();
    if (error) return dbFailure(error, "create attribute");
    attributeId = created.id;
  }

  let warning: AttributeSaveResult["warning"];
  if (choice) {
    // Values are inserted / updated / deleted in one transaction (order = position).
    const { error } = await supabase.rpc("set_attribute_values", {
      p_attribute_id: attributeId,
      p_values: input.values.map((value) => ({
        id: value.id || null,
        value: value.value,
        color_hex: type === "COLOR" ? value.colorHex : null,
        is_active: value.isActive,
      })),
    });
    if (error) {
      if (id) return dbFailure(error, "set attribute values");
      log("set attribute values", error);
      warning = "attributesNotSaved";
    }
  }

  refresh();
  return {
    status: "success",
    fieldErrors: {},
    id: attributeId,
    mode: id ? "updated" : "created",
    warning,
    at: Date.now(),
  };
}

export async function setAttributeActive(id: string, active: boolean): Promise<ActionResult> {
  return setActive("attributes", id, active);
}

export async function deleteAttribute(id: string): Promise<DeleteResult> {
  return remove("attributes", id);
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

async function setActive(
  table: "product_types" | "attributes",
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

/**
 * Hard delete, only while nothing uses the row: the foreign keys refuse it
 * otherwise (23503), and the admin is told to deactivate instead.
 */
async function remove(table: "product_types" | "attributes", id: string): Promise<DeleteResult> {
  if (!(await getAdminOrNull())) return { ok: false, error: "forbidden" };
  if (!isUuid(id)) return { ok: false, error: "notFound" };

  const supabase = await createClient();
  const { data, error } = await supabase.from(table).delete().eq("id", id).select("id");
  if (error) {
    if (error.code === "23503") return { ok: false, error: "inUse" };
    const mapped = mapDbError(error, `delete ${table}`);
    return { ok: false, error: "form" in mapped ? mapped.form : "unexpected" };
  }
  if (data.length === 0) return { ok: false, error: "notFound" };
  refresh();
  return { ok: true };
}
