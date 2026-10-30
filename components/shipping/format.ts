import { formatMinor } from "@/lib/currency/money";
import { format, type Messages } from "@/lib/i18n/messages";

type ShippingMessages = Messages["shipping"];

/** "Same day", "1 day", "3 days", "3–5 days". */
export function deliveryDays(t: ShippingMessages, min: number, max: number): string {
  if (min === max) {
    if (min === 0) return t.days.sameDay;
    return min === 1 ? t.days.one : format(t.days.other, { count: min });
  }
  return format(t.days.range, { min, max });
}

/** A method's charge: "Free" for 0, else the amount in the country's currency. */
export function rateLabel(
  t: ShippingMessages,
  minor: number | bigint,
  currency: { code: string; decimals: number },
  locale: string,
): string {
  return BigInt(minor) === BigInt(0) ? t.free : formatMinor(minor, currency, locale);
}

/** Country name in the UI language ("AE" → "United Arab Emirates"). */
export function countryLabel(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
