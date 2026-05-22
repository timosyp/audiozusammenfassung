// Service Worker – PWA-Grundgerüst + Share-Target-Empfang
// Speichert geteilte Audios im Cache und leitet zur App weiter.

const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const SHARED_CACHE = "shared-audio";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== STATIC_CACHE && k !== SHARED_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Share-Target: nimmt die geteilte Datei entgegen.
  if (url.pathname === "/share-target" && event.request.method === "POST") {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // API-Calls niemals cachen.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Navigationen: network-first, sonst Cache.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match("/index.html", { ignoreSearch: true })
      )
    );
    return;
  }

  // Statisches: cache-first, dann Netz.
  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request).then((res) => {
          if (res.ok && event.request.method === "GET" && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        })
    )
  );
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("audio");

    if (file && typeof file !== "string") {
      const cache = await caches.open(SHARED_CACHE);
      const headers = new Headers({
        "Content-Type": file.type || "audio/ogg",
        "X-Filename": file.name || "geteilte-aufnahme.audio",
      });
      const response = new Response(file, { headers });
      await cache.put("/__shared-audio", response);
    }
  } catch (err) {
    // Fehler ignorieren — App zeigt regulären Upload-Screen
  }

  return Response.redirect("/?shared=1", 303);
}
