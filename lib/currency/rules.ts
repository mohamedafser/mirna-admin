// "Add currency" rules, shared by the dialog (instant feedback) and the
// Server Action (the authority). Limits mirror migration 031's checks.
// Self-contained, so `node --test` runs its tests directly.

export interface CurrencyInput {
  code: string;
  symbol: string;
  decimals: string;
  isActive: boolean;
}

export type CurrencyFieldError =
  | "codeRequired"
  | "codeInvalid"
  | "codeTaken"
  | "symbolRequired"
  | "symbolTooLong"
  | "decimalsInvalid";

export type CurrencyFieldErrors = Partial<
  Record<"code" | "symbol" | "decimals", CurrencyFieldError>
>;

export const SYMBOL_MAX_LENGTH = 8;

/** ISO 4217 codes this runtime knows (Intl), for the code picker and validation. */
export function isoCurrencyCodes(): string[] {
  try {
    return Intl.supportedValuesOf("currency");
  } catch {
    return [];
  }
}

/** Intl's suggestions for a code: a short symbol and its decimals (editable in the dialog). */
export function currencyDefaults(code: string): { symbol: string; decimals: number } | null {
  try {
    const format = new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    });
    const symbol = format.formatToParts(1).find((part) => part.type === "currency")?.value;
    return {
      symbol: (symbol ?? code).slice(0, SYMBOL_MAX_LENGTH),
      decimals: Math.min(3, format.resolvedOptions().maximumFractionDigits ?? 2),
    };
  } catch {
    return null;
  }
}

export function readCurrencyInput(data: FormData): CurrencyInput {
  const text = (name: string) => String(data.get(name) ?? "").trim();
  return {
    code: text("code").toUpperCase(),
    symbol: text("symbol"),
    decimals: text("decimals"),
    isActive: data.get("isActive") === "on",
  };
}

/** `existing`: codes already added (the code must be new). */
export function validateCurrencyInput(
  input: CurrencyInput,
  existing: readonly string[],
): CurrencyFieldErrors {
  const errors: CurrencyFieldErrors = {};
  const known = isoCurrencyCodes();
  if (!input.code) errors.code = "codeRequired";
  else if (!/^[A-Z]{3}$/.test(input.code) || (known.length > 0 && !known.includes(input.code))) {
    errors.code = "codeInvalid";
  } else if (existing.includes(input.code)) errors.code = "codeTaken";
  if (!input.symbol) errors.symbol = "symbolRequired";
  else if (input.symbol.length > SYMBOL_MAX_LENGTH) errors.symbol = "symbolTooLong";
  if (!/^[0-3]$/.test(input.decimals)) errors.decimals = "decimalsInvalid";
  return errors;
}
