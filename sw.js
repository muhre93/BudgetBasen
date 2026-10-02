// Service worker: gør BudgetBasen installerbar og åbner hurtigt / offline.
// Data synkroniseres af Firestore selv (offline-cache) — her caches kun app-filerne.
// Hæv VERSION når du uploader nye filer, så telefonerne henter den nye udgave.
const VERSION = 'bb-v9';
const SHELL = [
  './', './index.html', './style.css', './app.js', './firebase-config.js', './manifest.json',
  './js/firebase.js', './js/calc.js', './js/ui.js', './js/state.js', './js/data.js', './js/files.js', './js/forms.js',
  './js/views/budget.js', './js/views/cashflow.js', './js/views/receipts.js', './js/views/documents.js',
  './js/views/admin.js', './js/views/share.js', './js/views/compare.js', './js/export.js', './js/help.js', './js/demo.js', './js/prefs.js', './js/views/simple.js', './js/config.js', './js/bank.js', './js/bankmatch.js', './js/categorize.js', './js/import.js', './js/importparse.js', './js/views/bank.js', './js/views/owner.js', './js/views/bilag.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Egne filer: netværk først (så nye versioner slår igennem), cache som fallback offline.
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // Firebase SDK, eksport-biblioteker og Google Fonts: cache først (de ændrer sig ikke for en fast version).
  if (url.hostname === 'www.gstatic.com' || url.hostname === 'cdn.sheetjs.com' || url.hostname === 'cdnjs.cloudflare.com' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    })));
  }
  // Alt andet (Firestore, Storage, Auth) går direkte til nettet.
});
