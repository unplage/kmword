// ==================== 配置区域（每个 PWA 必须修改）====================
const PWA_NAME = 'kmword';  // ← 修改为你的 PWA 名称
const CACHE_VERSION = 'v4';  // 每次更新时递增
const CACHE_NAME = `${PWA_NAME}-${CACHE_VERSION}`;  // 例如：kmword-v3

// 当前 PWA 的路径（自动检测）
const CURRENT_PATH = self.location.pathname.replace(/\/sw\.js$/, '');  // /kmword
const CURRENT_ORIGIN = self.location.origin;  // https://unplage.github.io

// 只缓存当前 PWA 路径下的资源
const STATIC_ASSETS = [
    `${CURRENT_PATH}/`,           // /kmword/
    `${CURRENT_PATH}/index.html`, // /kmword/index.html
    // CDN 资源可以保留
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css'
];

// ==================== Service Worker 核心代码 ====================

// 安装时缓存静态资源
self.addEventListener('install', (event) => {
    console.log(`[SW:${PWA_NAME}] Installing...`);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log(`[SW:${PWA_NAME}] Caching assets for ${CURRENT_PATH}`);
                // 使用 addAll 并捕获失败，避免一个失败导致全部失败
                return Promise.all(
                    STATIC_ASSETS.map(url => 
                        cache.add(url).catch(err => {
                            console.warn(`[SW:${PWA_NAME}] Failed to cache: ${url}`, err);
                        })
                    )
                );
            })
            .then(() => {
                console.log(`[SW:${PWA_NAME}] Install complete`);
                return self.skipWaiting();
            })
    );
});

// 激活时清理旧缓存（只清理当前 PWA 的缓存）
self.addEventListener('activate', (event) => {
    console.log(`[SW:${PWA_NAME}] Activating...`);
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => {
                        // 只删除当前 PWA 的旧版本缓存
                        // 匹配规则：以 PWA_NAME 开头，但不是当前版本
                        const isMyCache = name.startsWith(`${PWA_NAME}-`);
                        const isOldVersion = name !== CACHE_NAME;
                        return isMyCache && isOldVersion;
                    })
                    .map((name) => {
                        console.log(`[SW:${PWA_NAME}] Deleting old cache: ${name}`);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            console.log(`[SW:${PWA_NAME}] Claiming clients`);
            return self.clients.claim();
        })
    );
});

// 拦截请求（只处理当前 PWA 路径下的请求）
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // 只拦截当前 PWA 路径下的请求
    const isMyPath = url.pathname.startsWith(`${CURRENT_PATH}/`) || 
                       url.pathname === `${CURRENT_PATH}`;
    
    // CDN 资源也处理
    const isCDN = url.hostname === 'cdnjs.cloudflare.com';
    
    if (!isMyPath && !isCDN) {
        // 不拦截其他路径的请求
        return;
    }

    // API 请求使用网络优先策略
    if (url.hostname === 'api.dictionaryapi.dev') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, clone);
                        });
                    }
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
                if (fetchResponse.status === 200) {
                    const clone = fetchResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, clone);
                    });
                }
                return fetchResponse;
            }).catch(err => {
                console.error(`[SW:${PWA_NAME}] Fetch failed:`, err);
                // 可以返回离线页面
                return new Response('Offline', { status: 503 });
            });
        })
    );
});

// 可选：处理消息（用于 clear.html 通信）
self.addEventListener('message', (event) => {
    if (event.data === 'skipWaiting') {
        self.skipWaiting();
    }
});
