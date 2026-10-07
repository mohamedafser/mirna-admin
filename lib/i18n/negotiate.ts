import { isLocale, type Locale } from "@/config/i18n";

/**
 * Picks the best supported locale from an Accept-Language header
 * (e.g. "ar-AE,ar;q=0.9,en;q=0.8" → "ar"). Returns null if none match.
 */
export function matchAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { language: tag.split("-")[0].toLowerCase(), q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((entry) => entry.language && !Number.isNaN(entry.q) && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  const match = ranked.find((entry) => isLocale(entry.language))?.language;
  return isLocale(match) ? match : null;
}
