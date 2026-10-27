/* Gamins de Talus : fonctionne hors ligne. Changer VERSION à chaque mise à jour du code. */
const VERSION = 'gdt-2026-10-27-3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'lib/supabase.js', 'lib/jspdf.umd.min.js', 'lib/qrcode.js',
  'js/calc.js', 'js/core.js', 'js/pdf.js', 'js/m-accueil.js', 'js/m-factures.js', 'js/m-contacts.js', 'js/m-finances.js',
  'js/m-calendrier.js', 'js/m-taches.js', 'js/m-cultures.js', 'js/m-inventaire.js', 'js/m-reglages.js', 'js/main.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'fonts/bricolage-grotesque-latin-600-normal.woff2', 'fonts/bricolage-grotesque-latin-800-normal.woff2',
  'fonts/atkinson-hyperlegible-latin-400-normal.woff2', 'fonts/atkinson-hyperlegible-latin-700-normal.woff2',
  'fonts/ibm-plex-mono-latin-400-normal.woff2', 'fonts/ibm-plex-mono-latin-500-normal.woff2',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; /* les données (Supabase) ne passent jamais par le cache */
  /* Réseau d'abord (pour avoir toujours la dernière version), copie locale si hors ligne. */
  e.respondWith(fetch(req).then((r) => {
    if (r.ok) { const cp = r.clone(); caches.open(VERSION).then((c) => c.put(req.mode === 'navigate' ? 'index.html' : req, cp)); }
    return r;
  }).catch(() => caches.match(req.mode === 'navigate' ? 'index.html' : req).then((hit) => hit || caches.match(req, { ignoreSearch: true }))));
});
