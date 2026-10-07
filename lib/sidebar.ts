// Desktop sidebar expanded/collapsed preference. Like the theme it lives in a
// cookie and is applied to <html data-sidebar> by an inline <head> script, so
// the sidebar renders at the right width on first paint (no layout shift) while
// the admin shell stays static. CSS reacts via the `sidebar-collapsed:` variant
// (app/globals.css).

export const SIDEBAR_COOKIE = "sidebar";
export const SIDEBAR_CHANGE_EVENT = "mirna:sidebar-change";

const ONE_YEAR = 60 * 60 * 24 * 365;

export function isSidebarCollapsed(): boolean {
  return document.documentElement.dataset.sidebar === "collapsed";
}

export function setSidebarCollapsed(collapsed: boolean): void {
  const value = collapsed ? "collapsed" : "expanded";
  document.cookie = `${SIDEBAR_COOKIE}=${value}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
  if (collapsed) document.documentElement.dataset.sidebar = "collapsed";
  else delete document.documentElement.dataset.sidebar;
  window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
}

export function subscribeSidebar(onChange: () => void): () => void {
  window.addEventListener(SIDEBAR_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(SIDEBAR_CHANGE_EVENT, onChange);
}

/** Inline <head> script; keep in sync with setSidebarCollapsed(). */
export const sidebarInitScript = `(function(){try{if(/(?:^|; )${SIDEBAR_COOKIE}=collapsed(?:;|$)/.test(document.cookie))document.documentElement.setAttribute("data-sidebar","collapsed")}catch(e){}})()`;
