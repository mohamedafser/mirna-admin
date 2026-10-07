// Supported UI locales. Adding a language = add it here + messages/<code>.json.
export const locales = ["en", "ar"] as const;

export type Locale = (typeof locales)[number];
export type Direction = "ltr" | "rtl";

export const defaultLocale: Locale = "en";

// Persists the user's language choice across visits (read by proxy.ts).
export const LOCALE_COOKIE = "NEXT_LOCALE";

export const localeConfig: Record<
  Locale,
  { nativeName: string; shortName: string; dir: Direction }
> = {
  en: { nativeName: "English", shortName: "EN", dir: "ltr" },
  ar: { nativeName: "العربية", shortName: "ع", dir: "rtl" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function getDirection(locale: Locale): Direction {
  return localeConfig[locale].dir;
}
