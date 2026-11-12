// Guarda la app y la lista de productos en el celular para que funcionen sin señal.
const CACHE = "conteo-bodega-08d890dc14";
const FILES = ["./", "./manifest.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
// Cloudflare redirige /index.html → / . Safari y Chrome NO aceptan que el service worker entregue
// una respuesta redirigida al abrir una página ("Response served by service worker has redirections"),
// así que se entrega una copia limpia (mismo contenido, sin la marca de redirección).
const limpia = async r => r.redirected ? new Response(await r.blob(), { status: r.status, statusText: r.statusText, headers: r.headers }) : r;
// La página siempre se guarda bajo "./" (index.html y / son la misma app).
const clave = url => /\/(index\.html)?$/.test(url.pathname) ? new URL("./", self.registration.scope).pathname : url.pathname;
// Red primero, saltándose la caché del navegador (así una versión nueva se ve al tiro);
// sin señal, usa la copia guardada.
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;               // Supabase, fuentes, etc.: directo
  const nav = e.request.mode === "navigate";
  const req = nav ? fetch(url.href, { cache: "no-cache", credentials: "same-origin" }) : fetch(e.request, { cache: "no-cache" });
  e.respondWith(
    req.then(limpia).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(clave(url), copy)); }
      return r;
    }).catch(async () => {
      const hit = await caches.match(clave(url), { ignoreSearch: true });
      if (hit) return limpia(hit);
      if (nav) { const home = await caches.match(new URL("./", self.registration.scope).pathname); if (home) return limpia(home); }
      return Response.error();
    })
  );
});
