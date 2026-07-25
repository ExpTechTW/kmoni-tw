// GitHub Pages 一律回 cache-control: max-age=600 且無法設定，但 Vite 產生的
// /assets/ 檔名都帶內容雜湊、內容不會變，因此在這裡自行做長期快取。
//
// 順帶的好處是離線時仍能開啟畫面（只是沒有觀測資料）—— 對災時很重要。
//
// 改動這個檔案時請一併提高 VERSION，舊快取才會被清掉。
const VERSION = 'v1'
const SHELL = `shell-${VERSION}` // index.html
const ASSETS = `assets-${VERSION}` // 帶內容雜湊的檔案

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== SHELL && k !== ASSETS).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // 觀測資料與震動等級每秒更新，一律不攔截，讓它們照常走網路。
  if (url.origin !== self.location.origin) return

  // 檔名帶內容雜湊 = 不可變，直接 cache-first。
  if (url.pathname.includes('/assets/')) {
    e.respondWith(cacheFirst(req))
    return
  }

  // index.html 走 network-first：永遠先問網路，才不會卡在舊版本；
  // 網路不通時才用快取，這樣離線也開得起來。
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req))
  }
})

async function cacheFirst(req) {
  const cache = await caches.open(ASSETS)
  const hit = await cache.match(req)
  if (hit) return hit

  const res = await fetch(req)
  if (res.ok) cache.put(req, res.clone())
  return res
}

async function networkFirst(req) {
  const cache = await caches.open(SHELL)
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch (err) {
    const hit = await cache.match(req)
    if (hit) return hit
    throw err
  }
}
