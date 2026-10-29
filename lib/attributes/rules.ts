// Product type & attribute rules, shared by the client forms (instant feedback)
// and the Server Actions (authoritative). The database (migration 023:
// constraints, triggers and the set_* functions) remains the final protection.

import { isUuid } from "@/lib/catalogue/validation";
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from "@/lib/catalogue/slug";
import { normalizeNumberInput } from "@/lib/money";

export const ATTRIBUTE_DATA_TYPES = ["SELECT", "TEXT", "NUMBER", "BOOLEAN", "COLOR"] as const;
export type AttributeDataType = (typeof ATTRIBUTE_DATA_TYPES)[number];

export const NAME_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const CODE_MAX_LENGTH = 100;
export const UNIT_MAX_LENGTH = 20;
export const VALUE_MAX_LENGTH = 200;
export const TEXT_VALUE_MAX_LENGTH = 500;
export const MAX_VALUES = 200;
/** Same bounds as product_attributes.value_number (numeric(14,4), ±1e9). */
const NUMBER_PATTERN = /^-?\d{1,10}(\.\d{1,4})?$/;
const NUMBER_LIMIT = 1e9;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export function isAttributeDataType(value: unknown): value is AttributeDataType {
  return ATTRIBUTE_DATA_TYPES.includes(value as AttributeDataType);
}

/** SELECT and COLOR pick from reusable values; the others store a value per product. */
export function isChoiceType(type: AttributeDataType): boolean {
  return type === "SELECT" || type === "COLOR";
}

export type AttributeFieldError =
  | "nameRequired"
  | "nameTooLong"
  | "slugRequired"
  | "slugInvalid"
  | "slugTaken"
  | "codeRequired"
  | "codeInvalid"
  | "codeTaken"
  | "dataTypeInvalid"
  | "dataTypeLocked"
  | "multipleInUse"
  | "unitTooLong"
  | "descriptionTooLong"
  | "valuesInvalid"
  | "valueRequired"
  | "valueTooLong"
  | "valueDuplicate"
  | "colorInvalid"
  | "valueInUse"
  | "tooManyValues"
  | "attributesInvalid";

const text = (data: FormData, name: string) => String(data.get(name) ?? "").trim();

function compact<T extends Record<string, unknown>>(errors: T): T {
  for (const key of Object.keys(errors)) if (errors[key] === undefined) delete errors[key];
  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

function nameError(name: string): AttributeFieldError | undefined {
  if (!name) return "nameRequired";
  if (name.length > NAME_MAX_LENGTH) return "nameTooLong";
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Product types
// ---------------------------------------------------------------------------

/** One default attribute of a type, in display order. */
export interface TypeAttributeInput {
  attributeId: string;
  isRequired: boolean;
}

export interface ProductTypeInput {
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
  attributes: TypeAttributeInput[];
}

export type ProductTypeFieldErrors = Partial<Record<keyof ProductTypeInput, AttributeFieldError>>;

export function readProductType(data: FormData): ProductTypeInput {
  const raw = parseJson(text(data, "attributes"));
  const attributes = Array.isArray(raw)
    ? raw.map((item: { attributeId?: unknown; isRequired?: unknown }) => ({
        attributeId: String(item?.attributeId ?? ""),
        isRequired: item?.isRequired === true,
      }))
    : [];
  return {
    name: text(data, "name"),
    slug: text(data, "slug"),
    description: text(data, "description"),
    isActive: data.get("isActive") === "on",
    attributes,
  };
}

export function validateProductType(input: ProductTypeInput): ProductTypeFieldErrors {
  const errors: ProductTypeFieldErrors = {};
  errors.name = nameError(input.name);
  if (!input.slug) errors.slug = "slugRequired";
  else if (input.slug.length > SLUG_MAX_LENGTH || !SLUG_PATTERN.test(input.slug)) {
    errors.slug = "slugInvalid";
  }
  if (input.description.length > DESCRIPTION_MAX_LENGTH) errors.description = "descriptionTooLong";
  const ids = input.attributes.map((item) => item.attributeId);
  if (!ids.every(isUuid) || new Set(ids).size !== ids.length) {
    errors.attributes = "attributesInvalid";
  }
  return compact(errors);
}

// ---------------------------------------------------------------------------
// Attributes
// ---------------------------------------------------------------------------

/** A reusable value being edited; `id` is "" for a new one. */
export interface ValueInput {
  id: string;
  value: string;
  colorHex: string;
  isActive: boolean;
}

export interface AttributeInput {
  name: string;
  code: string;
  dataType: string;
  unit: string;
  allowsMultiple: boolean;
  /** Choice types: customers pick it (one variant per value), else a detail only. */
  createsVariants: boolean;
  description: string;
  isActive: boolean;
  values: ValueInput[];
}

export type AttributeFormErrors = Partial<
  Record<Exclude<keyof AttributeInput, "values"> | "values", AttributeFieldError>
> & {
  /** Per-row errors for the values list, by row index. */
  valueRows?: Record<number, AttributeFieldError>;
};

export function readAttribute(data: FormData): AttributeInput {
  const raw = parseJson(text(data, "values"));
  const values = Array.isArray(raw)
    ? raw.map((item: Partial<Record<keyof ValueInput, unknown>>) => ({
        id: String(item?.id ?? ""),
        value: String(item?.value ?? "").trim(),
        colorHex: String(item?.colorHex ?? "").trim(),
        isActive: item?.isActive !== false,
      }))
    : [];
  return {
    name: text(data, "name"),
    code: text(data, "code"),
    dataType: text(data, "dataType"),
    unit: text(data, "unit"),
    allowsMultiple: data.get("allowsMultiple") === "on",
    createsVariants: data.get("createsVariants") === "on",
    description: text(data, "description"),
    isActive: data.get("isActive") === "on",
    values,
  };
}

export function validateAttribute(input: AttributeInput): AttributeFormErrors {
  const errors: AttributeFormErrors = {};
  errors.name = nameError(input.name);
  if (!input.code) errors.code = "codeRequired";
  else if (input.code.length > CODE_MAX_LENGTH || !SLUG_PATTERN.test(input.code)) {
    errors.code = "codeInvalid";
  }
  if (!isAttributeDataType(input.dataType)) {
    errors.dataType = "dataTypeInvalid";
    return compact(errors);
  }
  if (input.unit.length > UNIT_MAX_LENGTH) errors.unit = "unitTooLong";
  if (input.description.length > DESCRIPTION_MAX_LENGTH) errors.description = "descriptionTooLong";

  if (isChoiceType(input.dataType)) {
    if (input.values.length > MAX_VALUES) errors.values = "tooManyValues";
    const rows: Record<number, AttributeFieldError> = {};
    const seen = new Set<string>();
    input.values.forEach((row, index) => {
      const key = row.value.toLocaleLowerCase();
      if (row.id && !isUuid(row.id)) rows[index] = "valuesInvalid";
      else if (!row.value) rows[index] = "valueRequired";
      else if (row.value.length > VALUE_MAX_LENGTH) rows[index] = "valueTooLong";
      else if (seen.has(key)) rows[index] = "valueDuplicate";
      else if (input.dataType === "COLOR" && !COLOR_PATTERN.test(row.colorHex)) {
        rows[index] = "colorInvalid";
      }
      seen.add(key);
    });
    if (Object.keys(rows).length > 0) errors.valueRows = rows;
  }
  return compact(errors);
}

// ---------------------------------------------------------------------------
// Product values
// ---------------------------------------------------------------------------

/** What the product form needs to know about an attribute. */
export interface AttributeDefinition {
  id: string;
  name: string;
  code: string;
  dataType: AttributeDataType;
  unit: string | null;
  allowsMultiple: boolean;
  isActive: boolean;
  values: Array<{ id: string; value: string; colorHex: string | null; isActive: boolean }>;
}

export interface ProductTypeDefinition {
  id: string;
  name: string;
  isActive: boolean;
  /** Default attributes, in display order. */
  attributes: TypeAttributeInput[];
}

export interface AttributeCatalog {
  types: ProductTypeDefinition[];
  attributes: AttributeDefinition[];
}

/**
 * One attribute's value as edited in the product form. Only the field that
 * matches the attribute's type is used; "" means "not set".
 */
export interface AttributeEntry {
  attributeId: string;
  valueIds: string[];
  text: string;
  number: string;
  boolean: "" | "true" | "false";
}

/** What the product currently has (inactive choices it already uses stay valid). */
export interface SavedProductAttributes {
  productTypeId: string | null;
  entries: AttributeEntry[];
}

export type ProductAttributeError =
  | "attributeRequired"
  | "attributeNumberInvalid"
  | "attributeTextTooLong"
  | "attributeValueInvalid"
  | "attributeSingleValue"
  | "attributeInactive";

export type ProductTypeError = "productTypeInvalid" | "productTypeInactive";

/** Flat row for set_product_attributes(). */
export interface ProductAttributeRow {
  attribute_id: string;
  attribute_value_id?: string;
  value_text?: string;
  value_number?: string;
  value_boolean?: boolean;
}

export interface ProductAttributesResult {
  typeError?: ProductTypeError;
  /** By attribute id. */
  errors: Record<string, ProductAttributeError>;
  rows: ProductAttributeRow[];
}

export function emptyEntry(attributeId: string): AttributeEntry {
  return { attributeId, valueIds: [], text: "", number: "", boolean: "" };
}

/** Accepts Arabic-Indic digits and ٫; returns a plain decimal string or null. */
export function parseAttributeNumber(raw: string): string | null {
  const value = normalizeNumberInput(raw);
  if (!NUMBER_PATTERN.test(value) || Math.abs(Number(value)) > NUMBER_LIMIT) return null;
  return value;
}

export function isEntryEmpty(entry: AttributeEntry, type: AttributeDataType): boolean {
  switch (type) {
    case "SELECT":
    case "COLOR":
      return entry.valueIds.length === 0;
    case "TEXT":
      return !entry.text.trim();
    case "NUMBER":
      return !entry.number.trim();
    case "BOOLEAN":
      return entry.boolean === "";
  }
}

/** Reads the product form's `productTypeId` and `attributes` (JSON) fields. */
export function readProductAttributes(data: FormData): {
  productTypeId: string;
  entries: AttributeEntry[];
} {
  const raw = parseJson(text(data, "attributes"));
  const entries = Array.isArray(raw)
    ? raw.map((item: Partial<Record<keyof AttributeEntry, unknown>>): AttributeEntry => ({
        attributeId: String(item?.attributeId ?? ""),
        valueIds: Array.isArray(item?.valueIds) ? item.valueIds.map(String) : [],
        text: String(item?.text ?? ""),
        number: String(item?.number ?? ""),
        boolean: item?.boolean === "true" ? "true" : item?.boolean === "false" ? "false" : "",
      }))
    : [];
  return { productTypeId: text(data, "productTypeId"), entries };
}

/**
 * Validates a product's type and attribute values against the catalog and
 * builds the rows to save. Empty optional entries are dropped. Inactive types,
 * attributes and values are refused unless the product already uses them.
 */
export function validateProductAttributes(
  productTypeId: string,
  entries: AttributeEntry[],
  catalog: AttributeCatalog,
  saved: SavedProductAttributes | null,
): ProductAttributesResult {
  const result: ProductAttributesResult = { errors: {}, rows: [] };
  const attributes = new Map(catalog.attributes.map((attribute) => [attribute.id, attribute]));
  const savedEntries = new Map(saved?.entries.map((entry) => [entry.attributeId, entry]));

  const type = productTypeId ? catalog.types.find((item) => item.id === productTypeId) : undefined;
  if (productTypeId && !type) result.typeError = "productTypeInvalid";
  else if (type && !type.isActive && type.id !== saved?.productTypeId) {
    result.typeError = "productTypeInactive";
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    const attribute = attributes.get(entry.attributeId);
    if (!attribute || seen.has(entry.attributeId)) continue;
    seen.add(entry.attributeId);
    if (isEntryEmpty(entry, attribute.dataType)) continue;
    const previous = savedEntries.get(attribute.id);
    const fail = (error: ProductAttributeError) => (result.errors[attribute.id] = error);

    if (!attribute.isActive && !previous) {
      fail("attributeInactive");
      continue;
    }
    switch (attribute.dataType) {
      case "SELECT":
      case "COLOR": {
        const ids = [...new Set(entry.valueIds)];
        const values = new Map(attribute.values.map((value) => [value.id, value]));
        const valid = ids.every((id) => {
          const value = values.get(id);
          return value && (value.isActive || previous?.valueIds.includes(id));
        });
        if (!valid) fail("attributeValueInvalid");
        else if (!attribute.allowsMultiple && ids.length > 1) fail("attributeSingleValue");
        else {
          for (const id of ids) {
            result.rows.push({ attribute_id: attribute.id, attribute_value_id: id });
          }
        }
        break;
      }
      case "TEXT": {
        const value = entry.text.trim();
        if (value.length > TEXT_VALUE_MAX_LENGTH) fail("attributeTextTooLong");
        else result.rows.push({ attribute_id: attribute.id, value_text: value });
        break;
      }
      case "NUMBER": {
        const value = parseAttributeNumber(entry.number);
        if (value === null) fail("attributeNumberInvalid");
        // Sent as a decimal string, so PostgreSQL parses it exactly.
        else result.rows.push({ attribute_id: attribute.id, value_number: value });
        break;
      }
      case "BOOLEAN":
        result.rows.push({ attribute_id: attribute.id, value_boolean: entry.boolean === "true" });
        break;
    }
  }

  // Every required, active attribute of the type needs a value (same rule as
  // set_product_attributes; a deactivated attribute never blocks a save).
  for (const item of type?.attributes ?? []) {
    if (!item.isRequired || result.errors[item.attributeId]) continue;
    if (!attributes.get(item.attributeId)?.isActive) continue;
    if (!result.rows.some((row) => row.attribute_id === item.attributeId)) {
      result.errors[item.attributeId] = "attributeRequired";
    }
  }
  return result;
}
