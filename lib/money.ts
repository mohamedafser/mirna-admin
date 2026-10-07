import type { CurrencyCode } from "@/config/region";

/**
 * Money input parsing without floating-point arithmetic. Amounts stay decimal
 * strings end to end (PostgreSQL NUMERIC(14,3) via the money_amount domain);
 * comparisons use BigInt minor units. Display goes through formatCurrency()
 * in lib/format.ts.
 */

/** money_amount is NUMERIC(14, 3): 11 integer digits, 3 decimals. */
const MAX_INTEGER_DIGITS = 11;
const DB_SCALE = 3;

export type MoneyError =
  "moneyRequired" | "moneyInvalid" | "moneyTooManyDecimals" | "moneyTooLarge";

export type ParsedMoney =
  { ok: true; value: string; minor: bigint } | { ok: false; error: MoneyError };

/** Decimal places a currency uses (AED 2, KWD 3, JPY 0). */
export function currencyFractionDigits(currencyCode: CurrencyCode): number {
  try {
    return (
      new Intl.NumberFormat("en", { style: "currency", currency: currencyCode }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Accepts Arabic-Indic / Persian digits and the Arabic decimal separator. */
export function normalizeNumberInput(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[\s,٬]/g, "");
}

export function parseMoney(raw: string, currencyCode: CurrencyCode): ParsedMoney {
  const input = normalizeNumberInput(raw);
  if (!input) return { ok: false, error: "moneyRequired" };
  if (!/^\d+(\.\d+)?$/.test(input)) return { ok: false, error: "moneyInvalid" };

  const [rawInteger, fraction = ""] = input.split(".");
  const integer = rawInteger.replace(/^0+(?=\d)/, "");
  if (integer.length > MAX_INTEGER_DIGITS) return { ok: false, error: "moneyTooLarge" };
  if (fraction.length > Math.min(currencyFractionDigits(currencyCode), DB_SCALE)) {
    return { ok: false, error: "moneyTooManyDecimals" };
  }

  return {
    ok: true,
    value: fraction ? `${integer}.${fraction}` : integer,
    minor: BigInt(integer + fraction.padEnd(DB_SCALE, "0")),
  };
}

/** Value for an <input> from a NUMERIC string, without float rounding. */
export function moneyInputValue(
  amount: string | number | null,
  currencyCode: CurrencyCode,
): string {
  if (amount === null) return "";
  const [integer, fraction = ""] = String(amount).split(".");
  const digits = currencyFractionDigits(currencyCode);
  return digits > 0 ? `${integer}.${fraction.padEnd(digits, "0").slice(0, digits)}` : integer;
}
