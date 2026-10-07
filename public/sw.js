/*
 * Mirna Admin service worker — Phase 1 foundation.
 *
 * Caching policy (server-authoritative admin):
 *   CACHED   · same-origin, content-hashed build assets (/_next/static/*)
 *            · app icons (/icons/*) and the offline fallback page
 *   NEVER    · HTML pages / RSC payloads (contain private admin data)
 *            · Server Actions, API routes, any non-GET request
 *            · any cross-origin request — including Supabase (auth tokens,
 *              REST, Storage), which is passed straight to the network
 *   OFFLINE  · failed page navigations show /offline.html
 *
 * Bump VERSION to drop old caches on deploy.
 */
const VERSION = "v1";
const CACHE = `mirna-admin-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("mirna-admin-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheableAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never touch cross-origin traffic (Supabase Auth/REST/Storage, fonts, …).
  if (url.origin !== self.location.origin) return;

  // Pages: always network (private, per-user HTML); offline page on failure.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Immutable build assets: cache-first.
  if (isCacheableAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok && response.type === "basic") {
              const copy = response.clone();
              event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
            }
            return response;
          }),
      ),
    );
  }
  // Everything else falls through to the network untouched.
});
