/* Travel — service worker
   策略是 stale-while-revalidate：先給快取（離線也開得起來），
   背景再抓新版寫回去，所以改版後「第二次開」才會看到新的。
   注意：同一個 github.io 網域下還有別的 PWA，
   清快取時只能刪自己這支的（travel- 開頭），不能 keys() 全刪。 */
const CACHE = 'travel-v10';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './maskable-512.png',
  './apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(
        ks.filter(k => k.startsWith('travel-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  /* Supabase 與 Google 的請求絕不進快取：拿到舊的行程比拿不到更糟。 */
  if (url.origin !== self.location.origin) return;
  /* jeremyl861225.github.io 底下每個 repo 共用同一個 origin。
     只攔自己子路徑的請求，否則會插手 todo-app、Clinical-Tools 的資源。 */
  if (!url.pathname.startsWith(new URL('./', self.location.href).pathname)) return;

  e.respondWith(
    caches.open(CACHE).then(async cache => {
      const hit = await cache.match(req);
      const net = fetch(req).then(res => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
