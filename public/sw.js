/*
 * CarbonTree Payout Desk — service worker.
 *
 * Two jobs: make the app installable, and make it usable on a warehouse floor
 * with one bar of signal. It caches the app shell and static assets only.
 *
 * It deliberately does NOT touch Firestore, Auth or Storage traffic — those are
 * cross-origin and the Firebase SDK has its own offline cache, which is both
 * smarter than anything here and the thing that queues a payout marked paid
 * while the phone is offline. Caching them here would fight it.
 */

const VERSION = "v1";
const SHELL = `ct-shell-${VERSION}`;
const ASSETS = `ct-assets-${VERSION}`;

const SHELL_URLS = [
  "/ledger",
  "/pay",
  "/upload",
  "/activity",
  "/offline",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // One failed URL must not sink the whole install.
      .then((cache) => Promise.allSettled(SHELL_URLS.map((u) => cache.add(u))))
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
            .filter((k) => k.startsWith("ct-") && k !== SHELL && k !== ASSETS)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Firebase, fonts, anything external
  if (url.pathname.startsWith("/api/")) return;

  // Pages: try the network so a deploy is picked up, fall back to whatever
  // copy we hold, and only then to the offline notice.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request, { ignoreSearch: true });
          return cached || (await caches.match("/offline")) || Response.error();
        }),
    );
    return;
  }

  // Build output is content-hashed, so a cache hit is always correct.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            const copy = response.clone();
            caches.open(ASSETS).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // Everything else same-origin: serve what we have, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(ASSETS).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    }),
  );
});
