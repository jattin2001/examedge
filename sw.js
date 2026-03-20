// ExamEdge Service Worker
const CACHE = "examedge-v1";
const STATIC = [
  "/",
  "/index.html",
  "/login.html",
  "/exams.html",
  "/exam.html",
  "/profile.html",
  "/style.css",
  "/script.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

// Install: cache static assets
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC)));
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

// Fetch: network first, fallback to cache
self.addEventListener("fetch", (e) => {
  // Skip non-GET and Firebase/external requests
  if (e.request.method !== "GET") return;
  if (!e.request.url.startsWith(self.location.origin)) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        // Cache successful responses
        if (res && res.status === 200) {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
