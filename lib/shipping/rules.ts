// Country shipping configuration rules, shared by the form (instant feedback)
// and the Server Action (the authority). Limits mirror migrations 037 / 038.
// Amounts are INTEGER MINOR UNITS of the country's currency and weights are
// GRAMS, both parsed without floating point. Self-contained for `node --test`.

import { parseMinor, type PriceError } from "../currency/money.ts";

export const SHIPPING_METHOD_CODES = ["STANDARD", "EXPRESS"] as const;
export type ShippingMethodCode = (typeof SHIPPING_METHOD_CODES)[number];

/**
 * FLAT: one charge per order. ORDER_BASED: bands of the order subtotal.
 * WEIGHT_BASED: bands of the parcel weight (sum of quantity × the variant's,
 * else the product's weight).
 */
export const SHIPPING_RATE_TYPES = ["FLAT", "WEIGHT_BASED", "ORDER_BASED"] as const;
export type ShippingRateType = (typeof SHIPPING_RATE_TYPES)[number];
export type TieredRateType = Exclude<ShippingRateType, "FLAT">;

export const MAX_DELIVERY_DAYS = 365;
/** Same cap as save_shipping_country() (migration 038). */
export const MAX_BANDS = 20;
/** products / product_variants.weight_grams: 1 g – 1,000 kg. */
export const MAX_WEIGHT_GRAMS = 1_000_000;

/** Defaults for a method that has never been saved (matches add_shipping_country()). */
export const DEFAULT_DELIVERY_DAYS: Record<ShippingMethodCode, [min: number, max: number]> = {
  STANDARD: [3, 7],
  EXPRESS: [1, 3],
};

/**
 * One band of a tiered rate: [minValue, maxValue) of the basis (subtotal in
 * minor units, or grams), maxValue null = no upper bound.
 */
export interface ShippingBand {
  minValue: number;
  maxValue: number | null;
  /** Minor units (0 = free delivery in this band). */
  amount: number;
}

export interface ShippingMethodConfig {
  code: ShippingMethodCode;
  rateType: ShippingRateType;
  isActive: boolean;
  /** FLAT: the rate in minor units (0 = free delivery). */
  amount: number;
  /** ORDER_BASED / WEIGHT_BASED: contiguous bands from 0, the last unbounded. */
  bands: ShippingBand[];
  /** Minor units; null = never free. */
  freeShippingThreshold: number | null;
  minDeliveryDays: number;
  maxDeliveryDays: number;
}

export interface ShippingCountryConfig {
  countryCode: string;
  currencyCode: string;
  isActive: boolean;
  /** Version token for save_shipping_country()'s stale-save check. */
  updatedAt: string;
  /** Always one per code, STANDARD first. */
  methods: ShippingMethodConfig[];
}

export function isShippingMethodCode(value: unknown): value is ShippingMethodCode {
  return SHIPPING_METHOD_CODES.includes(value as ShippingMethodCode);
}

export function isShippingRateType(value: unknown): value is ShippingRateType {
  return SHIPPING_RATE_TYPES.includes(value as ShippingRateType);
}

export function isTiered(type: ShippingRateType): type is TieredRateType {
  return type !== "FLAT";
}

/** Whether delivery to the country can actually be checked out. */
export function isDeliverable(config: Pick<ShippingCountryConfig, "isActive" | "methods">) {
  return config.isActive && config.methods.some((method) => method.isActive);
}

/** Whether a method's price depends on product weights. */
export function usesWeight(config: Pick<ShippingCountryConfig, "isActive" | "methods">) {
  return (
    config.isActive &&
    config.methods.some((method) => method.isActive && method.rateType === "WEIGHT_BASED")
  );
}

// ---------------------------------------------------------------------------
// Weights (entered in kg, stored in grams)
// ---------------------------------------------------------------------------

function normalizeDigits(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[\s,٬]/g, "");
}

export type WeightError = "weightInvalid" | "weightTooManyDecimals" | "weightTooLarge";

/** "1.25" kg → 1250 g. Rejects empty, zero, negative and sub-gram input. */
export function parseWeightGrams(
  raw: string,
): { ok: true; grams: number } | { ok: false; error: WeightError } {
  const input = normalizeDigits(raw);
  if (!/^\d+(\.\d+)?$/.test(input)) return { ok: false, error: "weightInvalid" };
  const [integer, fraction = ""] = input.split(".");
  if (fraction.length > 3) return { ok: false, error: "weightTooManyDecimals" };
  if (integer.replace(/^0+/, "").length > 4) return { ok: false, error: "weightTooLarge" };
  const grams = Number(integer) * 1000 + Number(fraction.padEnd(3, "0"));
  if (grams <= 0) return { ok: false, error: "weightInvalid" };
  if (grams > MAX_WEIGHT_GRAMS) return { ok: false, error: "weightTooLarge" };
  return { ok: true, grams };
}

/** 1250 g → "1.25" (kg, no trailing zeros). */
export function gramsToKg(grams: number): string {
  const kg = Math.trunc(grams / 1000);
  const rest = String(grams % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return rest ? `${kg}.${rest}` : String(kg);
}

/** An optional weight field: "" (or no value at all) → null (no weight). */
export function parseOptionalWeight(
  raw: string | null | undefined,
): { ok: true; grams: number | null } | { ok: false; error: WeightError } {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value ? parseWeightGrams(value) : { ok: true, grams: null };
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

export type ShippingFieldError =
  | Exclude<PriceError, "salePriceNotLower">
  | WeightError
  | "daysRequired"
  | "daysInvalid"
  | "daysOrder"
  | "rateTypeUnsupported"
  | "bandsRequired"
  | "bandsTooMany"
  | "upToRequired"
  | "upToNotHigher";

export type ShippingFormError = "noActiveMethod";

/** Field names: "isActive", and "<CODE>.<field>" per method. */
export type MethodField =
  "isActive" | "rateType" | "amount" | "bands" | "freeShippingThreshold" | "minDays" | "maxDays";

export function methodFieldName(code: ShippingMethodCode, field: MethodField): string {
  return `${code}.${field}`;
}

/** A band's error key: "<CODE>.bands.<index>.upTo" / ".amount". */
export function bandFieldName(
  code: ShippingMethodCode,
  index: number,
  field: "upTo" | "amount",
): string {
  return `${code}.bands.${index}.${field}`;
}

/**
 * A band as typed: its upper bound ("" for the last band, which has none) and
 * its rate. Each band starts where the previous one ends; the first at 0.
 */
export interface BandInput {
  upTo: string;
  amount: string;
}

export interface ShippingMethodInput {
  isActive: boolean;
  rateType: string;
  amount: string;
  bands: BandInput[];
  freeShippingThreshold: string;
  minDays: string;
  maxDays: string;
}

export interface ShippingFormInput {
  isActive: boolean;
  methods: Record<ShippingMethodCode, ShippingMethodInput>;
}

/** What save_shipping_country() receives for one method (minor units / grams as strings). */
export interface ShippingMethodPayload {
  code: ShippingMethodCode;
  is_active: boolean;
  rate_type: ShippingRateType;
  /** FLAT only. */
  amount?: string;
  /** ORDER_BASED / WEIGHT_BASED only. */
  rates?: { min_value: string; max_value: string | null; amount: string }[];
  free_shipping_threshold: string | null;
  min_delivery_days: number;
  max_delivery_days: number;
}

export type ShippingValidation =
  | { ok: true; isActive: boolean; methods: ShippingMethodPayload[] }
  | {
      ok: false;
      fieldErrors: Partial<Record<string, ShippingFieldError>>;
      formError?: ShippingFormError;
    };

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** The bands field is JSON ([{upTo, amount}]); anything malformed reads as no bands. */
function readBands(raw: string): BandInput[] {
  try {
    const parsed: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_BANDS + 1).map((band) => ({
      upTo: typeof band?.upTo === "string" ? band.upTo.trim() : "",
      amount: typeof band?.amount === "string" ? band.amount.trim() : "",
    }));
  } catch {
    return [];
  }
}

export function readShippingForm(data: FormData): ShippingFormInput {
  const methods = Object.fromEntries(
    SHIPPING_METHOD_CODES.map((code) => [
      code,
      {
        isActive: data.get(methodFieldName(code, "isActive")) === "on",
        rateType: text(data, methodFieldName(code, "rateType")) || "FLAT",
        amount: text(data, methodFieldName(code, "amount")),
        bands: readBands(text(data, methodFieldName(code, "bands"))),
        freeShippingThreshold: text(data, methodFieldName(code, "freeShippingThreshold")),
        minDays: text(data, methodFieldName(code, "minDays")),
        maxDays: text(data, methodFieldName(code, "maxDays")),
      },
    ]),
  ) as Record<ShippingMethodCode, ShippingMethodInput>;
  return { isActive: data.get("isActive") === "on", methods };
}

/** "3", "٣" → 3; null for anything that isn't a whole number of days. */
export function parseDays(raw: string): number | null {
  const input = normalizeDigits(raw);
  if (!/^\d{1,3}$/.test(input)) return null;
  const days = Number(input);
  return days <= MAX_DELIVERY_DAYS ? days : null;
}

/** A band bound in the method's basis: minor units (order value) or grams (weight). */
export function parseBound(
  raw: string,
  type: TieredRateType,
  decimals: number,
): { ok: true; value: bigint } | { ok: false; error: ShippingFieldError } {
  if (type === "WEIGHT_BASED") {
    const weight = parseWeightGrams(raw);
    return weight.ok ? { ok: true, value: BigInt(weight.grams) } : weight;
  }
  const minor = parseMinor(raw, decimals);
  return minor.ok
    ? { ok: true, value: minor.minor }
    : { ok: false, error: minor.error as ShippingFieldError };
}

/** Bands → payload rows, or the errors by field name. */
function validateBands(
  code: ShippingMethodCode,
  type: TieredRateType,
  bands: BandInput[],
  decimals: number,
  errors: Partial<Record<string, ShippingFieldError>>,
): ShippingMethodPayload["rates"] | null {
  if (bands.length === 0) {
    errors[methodFieldName(code, "bands")] = "bandsRequired";
    return null;
  }
  if (bands.length > MAX_BANDS) {
    errors[methodFieldName(code, "bands")] = "bandsTooMany";
    return null;
  }
  const rates: NonNullable<ShippingMethodPayload["rates"]> = [];
  let from = BigInt(0);
  let valid = true;
  bands.forEach((band, index) => {
    const last = index === bands.length - 1;
    const amount = parseMinor(band.amount, decimals, { allowZero: true });
    if (!amount.ok) {
      errors[bandFieldName(code, index, "amount")] = amount.error as ShippingFieldError;
      valid = false;
    }
    // The last band is open-ended, so every order can be priced.
    let upTo: bigint | null = null;
    if (!last) {
      if (!band.upTo) {
        errors[bandFieldName(code, index, "upTo")] = "upToRequired";
        valid = false;
      } else {
        const bound = parseBound(band.upTo, type, decimals);
        if (!bound.ok) {
          errors[bandFieldName(code, index, "upTo")] = bound.error;
          valid = false;
        } else if (bound.value <= from) {
          errors[bandFieldName(code, index, "upTo")] = "upToNotHigher";
          valid = false;
        } else {
          upTo = bound.value;
        }
      }
    }
    if (valid && amount.ok) {
      rates.push({
        min_value: from.toString(),
        max_value: upTo === null ? null : upTo.toString(),
        amount: amount.minor.toString(),
      });
    }
    if (upTo !== null) from = upTo;
  });
  return valid ? rates : null;
}

/**
 * Validates every method (also inactive ones: their values are kept) in the
 * country's currency `decimals`. An active country needs an active method.
 */
export function validateShippingForm(
  input: ShippingFormInput,
  decimals: number,
): ShippingValidation {
  const fieldErrors: Partial<Record<string, ShippingFieldError>> = {};
  const methods: ShippingMethodPayload[] = [];

  for (const code of SHIPPING_METHOD_CODES) {
    const method = input.methods[code];
    const field = (name: MethodField) => methodFieldName(code, name);
    const before = Object.keys(fieldErrors).length;

    const rateType = isShippingRateType(method.rateType) ? method.rateType : null;
    if (!rateType) fieldErrors[field("rateType")] = "rateTypeUnsupported";

    let price: Pick<ShippingMethodPayload, "amount" | "rates"> = {};
    if (rateType === "FLAT") {
      const amount = parseMinor(method.amount, decimals, { allowZero: true });
      if (!amount.ok) fieldErrors[field("amount")] = amount.error as ShippingFieldError;
      else price = { amount: amount.minor.toString() };
    } else if (rateType) {
      const rates = validateBands(code, rateType, method.bands, decimals, fieldErrors);
      if (rates) price = { rates };
    }

    const threshold = method.freeShippingThreshold
      ? parseMinor(method.freeShippingThreshold, decimals)
      : null;
    if (threshold && !threshold.ok) {
      fieldErrors[field("freeShippingThreshold")] = threshold.error as ShippingFieldError;
    }

    const minDays = parseDays(method.minDays);
    const maxDays = parseDays(method.maxDays);
    if (minDays === null) {
      fieldErrors[field("minDays")] = method.minDays ? "daysInvalid" : "daysRequired";
    }
    if (maxDays === null) {
      fieldErrors[field("maxDays")] = method.maxDays ? "daysInvalid" : "daysRequired";
    } else if (minDays !== null && minDays > maxDays) {
      fieldErrors[field("maxDays")] = "daysOrder";
    }

    if (Object.keys(fieldErrors).length === before && rateType) {
      methods.push({
        code,
        is_active: method.isActive,
        rate_type: rateType,
        ...price,
        free_shipping_threshold: threshold?.ok ? threshold.minor.toString() : null,
        min_delivery_days: minDays ?? 0,
        max_delivery_days: maxDays ?? 0,
      });
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  if (input.isActive && !methods.some((method) => method.is_active)) {
    return { ok: false, fieldErrors: {}, formError: "noActiveMethod" };
  }
  return { ok: true, isActive: input.isActive, methods };
}
