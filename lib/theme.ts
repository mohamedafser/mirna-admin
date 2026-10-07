export const themes = ["light", "dark", "system"] as const;
export type Theme = (typeof themes)[number];

// Stored in a cookie (not localStorage) so it is shared by the browser tab and
// the installed PWA, and can be read before first paint.
export const THEME_COOKIE = "theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (themes as readonly string[]).includes(value);
}

const ONE_YEAR = 60 * 60 * 24 * 365;
const CHANGE_EVENT = "mirna:theme-change";

/** Saved theme (client only). */
export function readTheme(): Theme {
  const match = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`));
  const value = match ? decodeURIComponent(match[1]) : null;
  return isTheme(value) ? value : "system";
}

/** For useSyncExternalStore: notifies every theme control of changes. */
export function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}

export function setTheme(theme: Theme): void {
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  applyTheme(theme);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/**
 * Applies a theme to <html>. "light"/"dark" set data-theme; "system" removes
 * it so the prefers-color-scheme media query in globals.css takes over.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/**
 * Inline <head> script: applies the saved theme before first paint to avoid a
 * flash of the wrong theme. Keep in sync with applyTheme().
 */
export const themeInitScript = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)(?:;|$)/);if(m)document.documentElement.setAttribute("data-theme",m[1])}catch(e){}})()`;
