import type { Locale } from "@/config/i18n";
import { activeRegion, type CurrencyCode } from "@/config/region";

/**
 * Centralised Intl formatting. Never hard-code currency symbols, decimal
 * places or date formats in components — call these instead.
 */

/** BCP 47 tag combining UI language with the market, e.g. "ar-AE". */
export function toIntlLocale(locale: Locale, countryCode = activeRegion.countryCode): string {
  return `${locale}-${countryCode}`;
}

/**
 * Formats a monetary amount. `amount` accepts the string form PostgreSQL
 * NUMERIC values may arrive in. Decimal places follow the currency
 * (2 for AED, 3 for KWD, 0 for JPY).
 */
export function formatCurrency(
  amount: number | string,
  currencyCode: CurrencyCode,
  locale: Locale,
): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return new Intl.NumberFormat(toIntlLocale(locale), {
    style: "currency",
    currency: currencyCode,
  }).format(value);
}

/**
 * Formats a timestamp in a timezone. Pages pass the store timezone from
 * Settings (getStoreRegion()); the config/region.ts default is the fallback.
 */
export function formatDateTime(
  date: Date | string,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
  timeZone = activeRegion.timezone,
): string {
  return new Intl.DateTimeFormat(toIntlLocale(locale), { ...options, timeZone }).format(
    typeof date === "string" ? new Date(date) : date,
  );
}
