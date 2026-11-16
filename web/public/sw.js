/* FarmSmart service worker (wave U9): offline use in the field. Registered by src/main.tsx in production builds only.
   - App shell: the page itself (network first, cached copy when offline) and the built files under /assets/ and the
     other same-origin static files (cache first: their names change when their content does).
   - API answers: GET /api/... is network first, with the saved copy when the network fails. POST /api/fields/{id}/compare
     and /money are kept by URL + a SHA-256 hash of the request body, so each set of farm settings has its own copy.
   - Every saved answer carries x-fs-saved-at (ISO time), so the page can say "showing results saved on {date}".
   Nothing is invented here: offline, a request that was never saved fails as it would without the worker. */
const VERSION = "u9.1";
const SHELL_CACHE = `fs-shell-${VERSION}`;
const API_CACHE = "fs-api-v1"; // also in src/components/OfflineBar.tsx; kept across worker updates
const SAVED_HEADER = "x-fs-saved-at";
const MAX_API_ENTRIES = 600;
const SHELL_URLS = ["/", "/manifest.webmanifest", "/favicon.svg", "/icons/icon-192.png", "/icons/icon-512.png"];

/** API paths never kept: searches, job polling, health, alert sign-up and history, map tiles, PDFs. */
const API_SKIP = /^\/api\/(search|jobs\/|health|alerts\/|tiles\/)|\.pdf$/;
/** POST answers kept by body hash. */
const API_POST_KEEP = /^\/api\/fields\/[^/]+\/(compare|money)$/;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const c = await caches.open(SHELL_CACHE);
      // The page and the files it loads first (script and style tags of the built index.html).
      try {
        const res = await fetch("/", { cache: "no-store" });
        if (res.ok) {
          const html = await res.clone().text();
          await c.put("/", res);
          const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
          await Promise.allSettled(assets.map((u) => c.add(u)));
        }
      } catch {
        /* offline at install: the shell is cached on the next visit */
      }
      await Promise.allSettled(SHELL_URLS.filter((u) => u !== "/").map((u) => c.add(u)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith("fs-shell-") && n !== SHELL_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A copy of the response with the time it was saved. */
async function stamped(res) {
  const headers = new Headers(res.headers);
  headers.set(SAVED_HEADER, new Date().toISOString());
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
}

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length <= MAX_API_ENTRIES) return;
  // Oldest first (Cache keys keep insertion order).
  await Promise.all(keys.slice(0, keys.length - MAX_API_ENTRIES).map((k) => cache.delete(k)));
}

/** Network first; on success keep a stamped copy under `key`; on failure answer with the kept copy. */
async function networkFirst(request, key) {
  const cache = await caches.open(API_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) {
      const copy = await stamped(res.clone());
      await cache.put(key, copy);
      void trim(cache);
    }
    return res;
  } catch (err) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw err;
  }
}

async function apiPost(request) {
  const url = new URL(request.url);
  const body = await request.clone().text();
  const hash = await sha256(body);
  url.searchParams.set("__fsbody", hash);
  return networkFirst(request, new Request(url.toString(), { method: "GET" }));
}

async function page(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put("/", res.clone());
    return res;
  } catch (err) {
    const hit = (await cache.match("/")) || (await cache.match(request));
    if (hit) return hit;
    throw err;
  }
}

/** Built files (names carry a content hash): cache first. Other public files: the saved copy at once, refreshed in the
    background, so a changed file shows on the next visit. */
async function staticFile(request, hashed) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit && hashed) return hit;
  const refresh = fetch(request)
    .then(async (res) => {
      if (res.ok && res.status === 200 && res.type === "basic") await cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (hit) return hit;
  const res = await refresh;
  return res || Response.error();
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // map tiles, fonts and other sites: the browser as usual
  if (request.headers.has("range")) return; // video and partial requests
  if (url.pathname.startsWith("/api/")) {
    if (API_SKIP.test(url.pathname)) return;
    if (request.method === "GET") {
      event.respondWith(networkFirst(request, request));
    } else if (request.method === "POST" && API_POST_KEEP.test(url.pathname)) {
      event.respondWith(apiPost(request));
    }
    return;
  }
  if (request.method !== "GET") return;
  if (request.mode === "navigate") {
    event.respondWith(page(request));
    return;
  }
  if (url.pathname === "/sw.js") return;
  // Built files and public files (Cesium workers, icons, images): cache first.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(staticFile(request, true));
  } else if (/^\/(cesium|icons)\//.test(url.pathname) || /\.(svg|png|jpg|jpeg|webp|woff2?|webmanifest|json)$/.test(url.pathname)) {
    event.respondWith(staticFile(request, false));
  }
});
