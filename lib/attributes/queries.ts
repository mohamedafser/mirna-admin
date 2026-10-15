import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cache } from "react";
import {
  pageRange,
  searchPattern,
  toPage,
  type ListParams,
  type Page,
} from "@/lib/catalogue/queries";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import {
  isAttributeDataType,
  isChoiceType,
  type AttributeCatalog,
  type AttributeDataType,
  type AttributeEntry,
  type SavedProductAttributes,
} from "./rules";

/**
 * Product type & attribute reads (admin only: RLS hides these tables from
 * everyone else). Lists filter and paginate in PostgreSQL; usage counts are
 * embedded aggregates in the same query (no N+1).
 */

export const PRODUCT_TYPE_PAGE_SIZE = 25;
export const ATTRIBUTE_PAGE_SIZE = 25;

type Supabase = SupabaseClient<Database>;

function fail(scope: string, error: { code?: string; message?: string }): never {
  console.error(
    `[attributes] ${scope} failed: code=${error.code || "-"} message=${error.message || "-"}`,
  );
  throw new Error(`Unable to load ${scope}`);
}

const countOf = (value: unknown) => (value as { count: number }[] | null)?.[0]?.count ?? 0;

/** The data_type CHECK constraint guarantees this; the fallback only satisfies TS. */
const dataType = (value: string): AttributeDataType =>
  isAttributeDataType(value) ? value : "TEXT";

// ---------------------------------------------------------------------------
// Product types
// ---------------------------------------------------------------------------

export interface ProductTypeRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  updated_at: string;
  attributeCount: number;
  productCount: number;
}

export async function listProductTypes(params: ListParams): Promise<Page<ProductTypeRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("product_types")
    .select(
      "id, name, slug, description, is_active, updated_at, product_type_attributes(count), products(count)",
      { count: "exact" },
    )
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  const pattern = searchPattern(params.q);
  if (pattern) query = query.or(`name.ilike.${pattern},slug.ilike.${pattern}`);
  if (params.status !== "all") query = query.eq("is_active", params.status === "active");

  const { data, error, count } = await query.range(
    ...pageRange(params.page, PRODUCT_TYPE_PAGE_SIZE),
  );
  if (error) fail("product types", error);

  const rows = data.map(({ product_type_attributes, products, ...type }) => ({
    ...type,
    attributeCount: countOf(product_type_attributes),
    productCount: countOf(products),
  }));
  return toPage(rows, count ?? 0, params.page, PRODUCT_TYPE_PAGE_SIZE);
}

export interface ProductTypeDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  is_active: boolean;
  updated_at: string;
  productCount: number;
  /** Default attributes in display order. */
  attributes: Array<{ attributeId: string; isRequired: boolean }>;
}

export const getProductType = cache(async (id: string): Promise<ProductTypeDetail | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_types")
    .select(
      "id, name, slug, description, is_active, updated_at, products(count), product_type_attributes(attribute_id, is_required, sort_order)",
    )
    .eq("id", id)
    .order("sort_order", { referencedTable: "product_type_attributes", ascending: true })
    .maybeSingle();
  if (error) fail("product type", error);
  if (!data) return null;
  const { products, product_type_attributes, ...type } = data;
  return {
    ...type,
    productCount: countOf(products),
    attributes: product_type_attributes.map((item) => ({
      attributeId: item.attribute_id,
      isRequired: item.is_required,
    })),
  };
});

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

export interface AttributeRow {
  id: string;
  name: string;
  code: string;
  data_type: AttributeDataType;
  unit: string | null;
  allows_multiple: boolean;
  is_active: boolean;
  updated_at: string;
  valueCount: number;
  typeCount: number;
  /** Product value rows using this attribute (0 = unused, safe to delete). */
  usageCount: number;
}

/** Reads ?type= (an attribute data type) for the attribute list filter. */
export function parseDataTypeFilter(
  searchParams: Record<string, string | string[] | undefined>,
): AttributeDataType | "" {
  const value = Array.isArray(searchParams.type) ? searchParams.type[0] : searchParams.type;
  return isAttributeDataType(value) ? value : "";
}

export async function listAttributes(
  params: ListParams,
  type: AttributeDataType | "",
): Promise<Page<AttributeRow>> {
  const supabase = await createClient();
  let query = supabase
    .from("attributes")
    .select(
      "id, name, code, data_type, unit, allows_multiple, is_active, updated_at, attribute_values!attribute_values_attribute_id_fkey(count), product_type_attributes(count), product_attributes(count)",
      { count: "exact" },
    )
    .order("name", { ascending: true })
    .order("id", { ascending: true });

  const pattern = searchPattern(params.q);
  if (pattern) query = query.or(`name.ilike.${pattern},code.ilike.${pattern}`);
  if (params.status !== "all") query = query.eq("is_active", params.status === "active");
  if (type) query = query.eq("data_type", type);

  const { data, error, count } = await query.range(...pageRange(params.page, ATTRIBUTE_PAGE_SIZE));
  if (error) fail("attributes", error);

  const rows = data.map(
    ({ attribute_values, product_type_attributes, product_attributes, ...attribute }) => ({
      ...attribute,
      data_type: dataType(attribute.data_type),
      valueCount: countOf(attribute_values),
      typeCount: countOf(product_type_attributes),
      usageCount: countOf(product_attributes),
    }),
  );
  return toPage(rows, count ?? 0, params.page, ATTRIBUTE_PAGE_SIZE);
}

export interface AttributeDetail {
  id: string;
  name: string;
  code: string;
  data_type: AttributeDataType;
  unit: string | null;
  allows_multiple: boolean;
  description: string | null;
  is_active: boolean;
  updated_at: string;
  typeCount: number;
  usageCount: number;
  values: Array<{
    id: string;
    value: string;
    colorHex: string | null;
    isActive: boolean;
    /** Products using this value (a used value can't be deleted). */
    usageCount: number;
  }>;
}

export const getAttribute = cache(async (id: string): Promise<AttributeDetail | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attributes")
    .select(
      `id, name, code, data_type, unit, allows_multiple, description, is_active, updated_at,
       product_type_attributes(count), product_attributes(count),
       values:attribute_values!attribute_values_attribute_id_fkey(id, value, color_hex, is_active, sort_order, product_attributes(count))`,
    )
    .eq("id", id)
    .order("sort_order", { referencedTable: "values", ascending: true })
    .order("value", { referencedTable: "values", ascending: true })
    .maybeSingle();
  if (error) fail("attribute", error);
  if (!data) return null;
  const { product_type_attributes, product_attributes, values, ...attribute } = data;
  return {
    ...attribute,
    data_type: dataType(attribute.data_type),
    typeCount: countOf(product_type_attributes),
    usageCount: countOf(product_attributes),
    values: values.map((value) => ({
      id: value.id,
      value: value.value,
      colorHex: value.color_hex,
      isActive: value.is_active,
      usageCount: countOf(value.product_attributes),
    })),
  };
});

// ---------------------------------------------------------------------------
// Catalog for the product form and the product type editor
// ---------------------------------------------------------------------------

/** Missing table / relation: migration 023 hasn't been applied yet. */
function isMissingSchema(error: { code?: string }) {
  return error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200";
}

/**
 * Every product type (with default attributes) and attribute (with values).
 * Returns null when the attribute tables don't exist yet, so product
 * management keeps working before migration 023 is applied.
 * Not memoised: Server Actions call it for a fresh, authoritative copy.
 */
export async function loadAttributeCatalog(supabase: Supabase): Promise<AttributeCatalog | null> {
  const [types, attributes] = await Promise.all([
    supabase
      .from("product_types")
      .select("id, name, is_active, product_type_attributes(attribute_id, is_required, sort_order)")
      .order("name", { ascending: true })
      .order("sort_order", { referencedTable: "product_type_attributes", ascending: true }),
    supabase
      .from("attributes")
      .select(
        "id, name, code, data_type, unit, allows_multiple, is_active, values:attribute_values!attribute_values_attribute_id_fkey(id, value, color_hex, is_active, sort_order)",
      )
      .order("name", { ascending: true })
      .order("sort_order", { referencedTable: "values", ascending: true })
      .order("value", { referencedTable: "values", ascending: true }),
  ]);
  const error = types.error ?? attributes.error;
  if (error) {
    if (isMissingSchema(error)) {
      console.warn("[attributes] tables missing: apply migration 023 (attributes disabled)");
      return null;
    }
    fail("attribute catalog", error);
  }
  return {
    types: types.data!.map((type) => ({
      id: type.id,
      name: type.name,
      isActive: type.is_active,
      attributes: type.product_type_attributes.map((item) => ({
        attributeId: item.attribute_id,
        isRequired: item.is_required,
      })),
    })),
    attributes: attributes.data!.map((attribute) => ({
      id: attribute.id,
      name: attribute.name,
      code: attribute.code,
      dataType: dataType(attribute.data_type),
      unit: attribute.unit,
      allowsMultiple: attribute.allows_multiple,
      isActive: attribute.is_active,
      values: attribute.values.map((value) => ({
        id: value.id,
        value: value.value,
        colorHex: value.color_hex,
        isActive: value.is_active,
      })),
    })),
  };
}

/** Memoised per request for pages. */
export const getAttributeCatalog = cache(async () => loadAttributeCatalog(await createClient()));

/**
 * A product's type and values, grouped per attribute as the form edits them.
 * null when the attribute tables don't exist yet.
 */
export async function loadProductAttributes(
  supabase: Supabase,
  productId: string,
): Promise<SavedProductAttributes | null> {
  const [product, values] = await Promise.all([
    supabase.from("products").select("product_type_id").eq("id", productId).maybeSingle(),
    supabase
      .from("product_attributes")
      .select(
        "attribute_id, attribute_value_id, value_text, value_number, value_boolean, attribute:attributes!product_attributes_attribute_id_fkey(data_type)",
      )
      .eq("product_id", productId),
  ]);
  const error = product.error ?? values.error;
  if (error) {
    if (isMissingSchema(error) || error.code === "42703") return null;
    fail("product attributes", error);
  }

  const entries = new Map<string, AttributeEntry>();
  for (const row of values.data!) {
    const entry = entries.get(row.attribute_id) ?? {
      attributeId: row.attribute_id,
      valueIds: [],
      text: "",
      number: "",
      boolean: "" as const,
    };
    const type = dataType(row.attribute?.data_type ?? "TEXT");
    if (isChoiceType(type) && row.attribute_value_id) entry.valueIds.push(row.attribute_value_id);
    if (row.value_text !== null) entry.text = row.value_text;
    if (row.value_number !== null) entry.number = String(row.value_number);
    if (row.value_boolean !== null) entry.boolean = row.value_boolean ? "true" : "false";
    entries.set(row.attribute_id, entry);
  }
  return { productTypeId: product.data?.product_type_id ?? null, entries: [...entries.values()] };
}

export const getProductAttributes = cache(async (productId: string) =>
  loadProductAttributes(await createClient(), productId),
);
