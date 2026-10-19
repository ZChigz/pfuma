// Pfuma service worker: lets the attendance register and the mark entry grid open and be filled in without signal.
// It keeps only what they need: the app's own scripts, those pages and their data.
// Marks and registers themselves are saved on the phone (IndexedDB) by the page, and sent when the signal returns.
const CACHE = 'pfuma-register-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE && key.startsWith('pfuma-register-')) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  // The page asks to forget everything on a shared phone (when someone logs out).
  if (event.data === 'clear') event.waitUntil(caches.delete(CACHE));
});

const isRegisterRoute = (p) =>
  p.startsWith('/academics/attendance') || p === '/exams/marks' || p.startsWith('/exams/marks/') ||
  p === '/api/academics/attendance/register' || p === '/api/academics/attendance/lesson' || p === '/api/academics/attendance/due' || p === '/api/academics/attendance/lessons';

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected && response.type === 'basic') cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_next/static/')) return void event.respondWith(cacheFirst(request));
  if (isRegisterRoute(url.pathname)) event.respondWith(networkFirst(request));
});
