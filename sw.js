// 改 APP_VERSION 时同步 +1，强制清旧缓存
const SW_VERSION = "1";
const CACHE_NAME = "moyu-v" + SW_VERSION;

function cacheable(req, res) {
  if (req.method !== "GET") return false;
  if (!res || res.status !== 200) return false;
  if (res.type === "opaque") return false;

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/event-stream")) return false;
  if (ct.includes("application/json")) return false;

  return true;
}

async function tryCache(req, res) {
  if (!cacheable(req, res)) return;
  try {
    const c = await caches.open(CACHE_NAME);
    await c.put(req, res.clone());
  } catch (_) { /* clone 失败静默跳过（流式/锁定的 Response）*/ }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    await tryCache(req, res);
    return res;
  } catch (_) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw _;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  await tryCache(req, res);
  return res;
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // 导航（HTML）→ 网络优先
  if (e.request.mode === "navigate") {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // 同源静态资源（JS/CSS/fonts/images）→ 缓存优先
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(e.request));
    return;
  }

  // CDN 第三方库 → 网络优先
  e.respondWith(networkFirst(e.request));
});
