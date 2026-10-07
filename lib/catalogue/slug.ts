/** Same rule as the categories/products slug CHECK constraints. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 200;

/**
 * URL-safe slug from a name: "Men's Shoes" → "mens-shoes",
 * "Crème Brûlée & Co" → "creme-brulee-and-co". Non-Latin names (e.g. Arabic)
 * produce "" and the admin types the slug instead.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’‘`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}
