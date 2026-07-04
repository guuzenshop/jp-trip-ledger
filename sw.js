/* 旅行記帳 — Service Worker（離線可用）
   策略：app 本體（index.html）網路優先、離線回退快取；
   匯率等跨源請求一律放行，離線失敗時由 App 既有 try-catch 優雅降級。 */
// ⚠️ 改動 shell 資產（manifest/icon）時順手 +1 版本號，確保舊快取被清除
const CACHE = 'jp-ledger-v13';
const SHELL = ['./', './index.html', './manifest.json', './icon.svg', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 跨源（匯率 API 等）不攔截，交給瀏覽器；離線時 App 自行降級
  if (url.origin !== self.location.origin) return;

  // 導覽 / HTML 文件：網路優先，更新快取；離線回退快取
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(
      fetch(req)
        .then(res => {
          // 只在「App 本體導覽」成功時回寫 index.html 快取；其他導覽（含 blob:）不誤覆蓋
          if (res && res.ok && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html'))) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // 其他同源資源（manifest / icon 等）：stale-while-revalidate
  // 先回快取（快），背景抓新版回寫 → 下次造訪即更新，shell 資產不會永久陳舊
  e.respondWith(
    caches.match(req).then(cached => {
      const fetching = fetch(req).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => cached);
      return cached || fetching;
    })
  );
});
