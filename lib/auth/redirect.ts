import type { Locale } from "@/config/i18n";

/** Query parameter carrying the page a signed-out user tried to open. */
export const REDIRECT_PARAM = "redirect";

/**
 * Returns `target` only if it is a same-origin path inside this locale's admin
 * area; otherwise the admin home. Prevents open redirects via ?redirect=.
 */
export function safeAdminRedirect(target: unknown, locale: Locale): string {
  const fallback = `/${locale}/admin`;
  if (typeof target !== "string") return fallback;
  if (
    target !== fallback &&
    !target.startsWith(`${fallback}/`) &&
    !target.startsWith(`${fallback}?`)
  ) {
    return fallback;
  }
  if (target.includes("//") || target.includes("\\")) return fallback;
  return target;
}
