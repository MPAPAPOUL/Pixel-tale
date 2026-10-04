// Service worker de Pixelfe : permet l'installation sur Android (PWA) et
// accélère les lancements suivants. Stratégies :
//  - page et scripts : réseau d'abord (les mises à jour du jeu arrivent tout de
//    suite), cache en secours hors ligne ;
//  - images : cache d'abord, rafraîchies en arrière-plan ;
//  - audio, API et WebSocket : jamais interceptés.
const VERSION = "pixelfe-v1";
const COQUILLE = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || /\.(mp3|ogg|wav)$/i.test(url.pathname) || req.headers.has("range")) return;
  const estImage = /\.(png|webp|jpg|jpeg|gif|svg)$/i.test(url.pathname);
  if (estImage) {
    e.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const enCache = await cache.match(req);
        const reseau = fetch(req).then((rep) => { if (rep.ok) cache.put(req, rep.clone()); return rep; }).catch(() => enCache);
        return enCache || reseau;
      })
    );
    return;
  }
  // Page, scripts, manifeste : réseau d'abord.
  e.respondWith(
    fetch(req).then((rep) => {
      if (rep.ok) { const copie = rep.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); }
      return rep;
    }).catch(() => caches.match(req).then((r) => r || caches.match("/")))
  );
});
