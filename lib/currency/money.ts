// Multi-currency prices (migration 031): amounts are INTEGER MINOR UNITS in a
// currency's own decimals (1.500 BHD = 1500, 12.50 AED = 1250). Parsing and
// formatting never go through floating point. Self-contained (no imports), so
// `node --test` runs its tests directly.

export interface Currency {
  code: string;
  symbol: string;
  /** 0–3: digits after the decimal point (BHD / KWD 3, most others 2). */
  decimals: number;
  isActive: boolean;
  isDefault: boolean;
}

export type PriceError =
  "priceRequired" | "priceInvalid" | "priceTooManyDecimals" | "priceTooLarge" | "salePriceNotLower";

/** product_prices.price < 10^14 (CHECK in migration 031). */
const MAX_MINOR = BigInt("100000000000000");

/** Accepts Arabic-Indic / Persian digits and the Arabic decimal separator. */
function normalize(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[\s,٬]/g, "");
}

/**
 * "12.5" in a 2-decimal currency → 1250n. Rejects empty, negative, zero,
 * non-numeric input and more decimals than the currency has.
 */
export function parseMinor(
  raw: string,
  decimals: number,
): { ok: true; minor: bigint } | { ok: false; error: PriceError } {
  const input = normalize(raw);
  if (!input) return { ok: false, error: "priceRequired" };
  if (!/^\d+(\.\d+)?$/.test(input)) return { ok: false, error: "priceInvalid" };
  const [integer, fraction = ""] = input.split(".");
  if (fraction.length > decimals) return { ok: false, error: "priceTooManyDecimals" };
  const minor = BigInt(integer + fraction.padEnd(decimals, "0"));
  if (minor <= BigInt(0)) return { ok: false, error: "priceInvalid" };
  if (minor >= MAX_MINOR) return { ok: false, error: "priceTooLarge" };
  return { ok: true, minor };
}

/** 1500n with 3 decimals → "1.500" (always every decimal, for inputs and CSV). */
export function minorToDecimal(minor: bigint | number | string, decimals: number): string {
  const digits = BigInt(minor)
    .toString()
    .padStart(decimals + 1, "0");
  return decimals > 0 ? `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}` : digits;
}

/**
 * Formats minor units with Intl.NumberFormat, showing exactly the currency's
 * decimals ("BHD 1.500", "₹1,234.56"). The decimal string is passed to Intl,
 * so no precision is lost.
 */
export function formatMinor(
  minor: bigint | number | string,
  currency: Pick<Currency, "code" | "decimals">,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.code,
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  }).format(minorToDecimal(minor, currency.decimals) as Intl.StringNumericLiteral);
}

/**
 * One price row (regular price + optional sale price). Both empty = no price
 * in this currency (`minor: null`). A sale price must be lower than the price.
 */
export function parsePriceRow(
  price: string,
  salePrice: string,
  decimals: number,
):
  | { ok: true; minor: { price: bigint; salePrice: bigint | null } | null }
  | { ok: false; errors: { price?: PriceError; salePrice?: PriceError } } {
  if (!normalize(price) && !normalize(salePrice)) return { ok: true, minor: null };
  const parsedPrice = parseMinor(price, decimals);
  const parsedSale = normalize(salePrice) ? parseMinor(salePrice, decimals) : null;
  const errors: { price?: PriceError; salePrice?: PriceError } = {};
  if (!parsedPrice.ok) errors.price = parsedPrice.error;
  if (parsedSale && !parsedSale.ok) errors.salePrice = parsedSale.error;
  if (parsedPrice.ok && parsedSale?.ok && parsedSale.minor >= parsedPrice.minor) {
    errors.salePrice = "salePriceNotLower";
  }
  if (!parsedPrice.ok || (parsedSale && !parsedSale.ok) || errors.salePrice) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    minor: { price: parsedPrice.minor, salePrice: parsedSale?.ok ? parsedSale.minor : null },
  };
}
