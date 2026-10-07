"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js in production builds only, so development never serves
 * stale assets. See public/sw.js for what is (and is never) cached.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => console.error("[pwa] service worker registration failed", error));
  }, []);

  return null;
}
