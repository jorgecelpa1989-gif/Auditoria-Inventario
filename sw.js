// Guarda la app y la lista de productos en el celular para que funcionen sin señal.
const CACHE = "conteo-bodega-v27";
const FILES = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Red primero, saltándose la caché del navegador (así una versión nueva subida a GitHub se ve al tiro);
// sin señal, usa la copia guardada.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;               // Supabase, fuentes, etc.: directo
  const req = e.request.mode === "navigate" ? fetch(url.href, { cache: "no-cache", credentials: "same-origin" }) : fetch(e.request, { cache: "no-cache" });
  e.respondWith(
    req.then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(url.pathname, copy)); }
      return r;
    }).catch(async () => {
      const hit = await caches.match(url.pathname, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    })
  );
});
