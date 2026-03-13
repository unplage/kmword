const CACHE_NAME = 'word-learner-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// 安装时缓存静态资源
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .catch((err) => console.error('[SW] Cache failed:', err))
    );
    self.skipWaiting();
});

// 激活时清理旧缓存
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        })
    );
    self.clients.claim();
});

// 拦截请求
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // API 请求使用网络优先策略
    if (url.hostname === 'api.dictionaryapi.dev') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    // 缓存成功的 API 响应
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, clone);
                    });
                    return response;
                })
                .catch(() => {
                    return caches.match(request);
                })
        );
        return;
    }

    // 静态资源使用缓存优先策略
    event.respondWith(
        caches.match(request).then((response) => {
            if (response) {
                return response;
            }
            return fetch(request).then((fetchResponse) => {
                // 缓存新获取的资源
                if (fetchResponse.status === 200) {
                    const clone = fetchResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, clone);
                    });
                }
                return fetchResponse;
            });
        })
    );
});
