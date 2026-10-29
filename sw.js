// Guarda la app y la lista de productos en el celular para que funcionen sin señal.
const CACHE = "conteo-bodega-v14";
const FILES = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Red primero (así llegan las actualizaciones y el maestro nuevo); sin señal, usa la copia guardada.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && url.origin === location.origin) {
        const copy = r.clone(); caches.open(CACHE).then(c => c.put(url.pathname, copy));
      }
      return r;
    }).catch(async () => {
      const hit = await caches.match(url.pathname, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    })
  );
});
