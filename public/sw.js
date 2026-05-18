const VERSION = 'panda-desiiignare-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;
const AUDIO_CACHE = `${VERSION}-audio`;
const IMAGE_CACHE = `${VERSION}-image`;

const PRECACHE = ['/', '/ashton.html', '/offline.html', '/site.webmanifest', '/favicon.ico', '/apple-touch-icon.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isAudio(url) {
  return url.pathname.startsWith('/audio/') || /\.(mp3|m4a|ogg|wav)$/i.test(url.pathname);
}
function isImage(url) {
  return url.pathname.startsWith('/art/') || /\.(png|jpe?g|webp|avif|svg|gif)$/i.test(url.pathname);
}
function isHTML(req) {
  return req.headers.get('accept')?.includes('text/html');
}

async function networkFirst(request, cacheName, timeoutMs = 3000) {
  const cache = await caches.open(cacheName);
  try {
    const network = await Promise.race([
      fetch(request),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
    ]);
    cache.put(request, network.clone());
    return network;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (isHTML(request)) {
      const offline = await caches.match('/offline.html');
      if (offline) return offline;
    }
    throw new Error('offline');
  }
}

async function cacheFirst(request, cacheName, maxEntries = 60) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const network = await fetch(request);
  cache.put(request, network.clone());
  trimCache(cacheName, maxEntries);
  return network;
}

async function staleWhileRevalidate(request, cacheName, maxEntries = 80) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(res => {
      cache.put(request, res.clone());
      trimCache(cacheName, maxEntries);
      return res;
    })
    .catch(() => null);
  return cached || (await networkPromise) || (await caches.match('/offline.html'));
}

async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  for (const key of keys.slice(0, keys.length - maxEntries)) await cache.delete(key);
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (url.pathname === '/health' || url.pathname.startsWith('/api/')) return;

  if (isAudio(url)) return event.respondWith(cacheFirst(req, AUDIO_CACHE, 40));
  if (isImage(url)) return event.respondWith(staleWhileRevalidate(req, IMAGE_CACHE, 80));
  if (isHTML(req) || url.pathname === '/' || url.pathname.endsWith('.html'))
    return event.respondWith(networkFirst(req, SHELL_CACHE));
  if (/\.(css|js|woff2?|ttf|json)$/i.test(url.pathname))
    return event.respondWith(staleWhileRevalidate(req, RUNTIME_CACHE, 60));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { title: 'bZ', body: event.data?.text() || 'Tap to listen.' }; }
  const title = data.title || 'bZ — new drop';
  const body = data.body || 'Tap to listen.';
  const url = data.url || '/';
  const icon = data.icon || '/art/icon-192.png';
  const badge = data.badge || '/art/icon-192.png';
  const image = data.image;
  const tag = data.tag || 'bz-broadcast';
  const options = {
    body, icon, badge, tag, image,
    data: { url },
    renotify: true,
    requireInteraction: false,
    actions: [{ action: 'open', title: 'Listen' }, { action: 'dismiss', title: 'Later' }]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const target = event.notification.data?.url || '/';
  const absolute = new URL(target, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin)) {
          c.focus();
          return c.navigate(absolute).catch(() => null);
        }
      }
      return self.clients.openWindow(absolute);
    })
  );
});

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    const reg = self.registration;
    const oldSub = event.oldSubscription;
    const appServerKey = oldSub?.options?.applicationServerKey;
    if (!appServerKey) return;
    try {
      const newSub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appServerKey });
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSub.toJSON())
      });
    } catch { /* user revoked or service unavailable */ }
  })());
});
