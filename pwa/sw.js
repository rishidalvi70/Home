// Service worker: caches the whole app so it opens and works with no internet.
// VERSION and the file list between the markers are rewritten by `npm run build` (scripts/build-sw.mjs).
const VERSION = "15a772f4ce30";
const CACHE = `home-finance-${VERSION}`;
// ASSETS:START
const ASSETS = [
  "./",
  "./css/app.css",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon.svg",
  "./index.html",
  "./js/cascadeDelete.js",
  "./js/constants.js",
  "./js/db.js",
  "./js/domain/bills.js",
  "./js/domain/cascade.js",
  "./js/domain/commitments.js",
  "./js/domain/dashboard.js",
  "./js/domain/receipts.js",
  "./js/domain/rent.js",
  "./js/domain/reports.js",
  "./js/lib/csv.js",
  "./js/lib/dates.js",
  "./js/lib/files.js",
  "./js/lib/html.js",
  "./js/lib/money.js",
  "./js/lib/zip.js",
  "./js/main.js",
  "./js/theme.js",
  "./js/ui/charts.js",
  "./js/ui/core.js",
  "./js/views/backup.js",
  "./js/views/bills.js",
  "./js/views/common.js",
  "./js/views/dashboard.js",
  "./js/views/payments.js",
  "./js/views/personal.js",
  "./js/views/properties.js",
  "./js/views/receipts.js",
  "./js/views/rent.js",
  "./manifest.webmanifest",
  "./vendor/bootstrap-icons.min.css",
  "./vendor/bootstrap.bundle.min.js",
  "./vendor/bootstrap.min.css",
  "./vendor/chart.umd.js",
  "./vendor/fonts/bootstrap-icons.woff2"
];
// ASSETS:END

self.addEventListener("install", (event) => {
  // No skipWaiting here: a new version waits until the user taps "Update now" so it never swaps mid-edit.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("home-finance-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => { if (event.data === "SKIP_WAITING") self.skipWaiting(); });

// Android "Share" target: files shared to the app are parked here (not in the main cache, so updates never delete them)
// until the page imports them into the phone's storage.
async function receiveShared(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open("hf-inbox");
    let i = 0;
    for (const f of form.getAll("files")) {
      if (!(f instanceof File) || !f.size) continue;
      await cache.put(new Request(`./inbox/${Date.now()}-${i++}`), new Response(f, {
        headers: { "content-type": f.type || "application/octet-stream", "x-filename": encodeURIComponent(f.name || "shared") } }));
    }
  } catch (e) { /* nothing usable was shared - just open the app */ }
  return Response.redirect(new URL("./#/receipts", self.registration.scope).href, 303);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method === "POST" && url.origin === self.location.origin && url.pathname === new URL("./share-target", self.registration.scope).pathname) {
    event.respondWith(receiveShared(req));
    return;
  }
  if (req.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Every page load is the single-page shell; the hash decides what to show.
    const hit = await cache.match(req.mode === "navigate" ? "./index.html" : req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return req.mode === "navigate" ? (await cache.match("./index.html")) || Response.error() : Response.error();
    }
  })());
});
