// PayFlow Pro — service worker
//
// Purpose #1: this is what actually makes "Add to Home Screen" install
// a real standalone app instead of a browser shortcut. Chrome/Edge
// only fire `beforeinstallprompt` (see app.js) once a manifest AND a
// registered service worker are both present — this file is that
// second requirement.
//
// Purpose #2: a small app-shell cache so the static UI (HTML/CSS/JS)
// still opens on a flaky connection.
//
// Deliberately network-first and same-origin-only: Firebase Auth/
// Firestore, Razorpay checkout, the Vercel /api/* billing functions,
// and Google Fonts must ALWAYS hit the live network. Caching any of
// those would risk showing stale wallet balances or broken auth/
// payment flows, so this worker never touches them.
const CACHE_NAME = 'payflow-pro-shell-v1';
const APP_SHELL = ['./', './index.html', './style.css', './app.js', './manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => { /* offline-first cache warm is best-effort only */ })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only ever intercept same-origin GETs for the static app shell.
  // Everything else (billing API, Firebase, Razorpay, fonts, etc.)
  // is left completely untouched and goes straight to the network.
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
