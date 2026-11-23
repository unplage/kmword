// ==================== 配置区域（每个 PWA 必须修改）====================
const PWA_NAME = 'kmword';  // ← 修改为你的 PWA 名称
const CACHE_VERSION = 'v56';  // 每次更新时递增
const CACHE_NAME = `${PWA_NAME}-${CACHE_VERSION}`;  // 例如：kmword-v3

// 当前 PWA 的路径（自动检测）
const CURRENT_PATH = self.location.pathname.replace(/\/sw\.js$/, '');  // /kmword
const CURRENT_ORIGIN = self.location.origin;  // https://unplage.github.io

// 只缓存当前 PWA 路径下的资源
const STATIC_ASSETS = [
    `${CURRENT_PATH}/`,           // /kmword/
    `${CURRENT_PATH}/index.html`, // /kmword/index.html
    `${CURRENT_PATH}/styles.css`,
    `${CURRENT_PATH}/js/fsrs.js`,
    `${CURRENT_PATH}/js/word-freq.js`,
    `${CURRENT_PATH}/js/wiktionary.js`,
    `${CURRENT_PATH}/js/ecdict.js`,
    `${CURRENT_PATH}/js/dictionary-api.js`,
    `${CURRENT_PATH}/js/stats.js`,
    `${CURRENT_PATH}/js/mw-parser.js`,
    `${CURRENT_PATH}/js/ecdict-worker.js`,
    `${CURRENT_PATH}/js/db.js`,
    `${CURRENT_PATH}/js/novel-processor.js`,
    `${CURRENT_PATH}/js/tts-generator.js`,
    `${CURRENT_PATH}/js/app.js`,
    `${CURRENT_PATH}/manifest.json`,
    `${CURRENT_PATH}/icons/icon.svg`,
    `${CURRENT_PATH}/icons/icon-192.png`,
    `${CURRENT_PATH}/icons/icon-512.png`,
    `${CURRENT_PATH}/icons/icon-maskable-512.png`,
    `${CURRENT_PATH}/icons/apple-touch-icon.png`,
    `${CURRENT_PATH}/icons/favicon-32.png`,
    // CDN 资源可以保留
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-solid-900.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/fa-brands-400.woff2',
    'https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/dompurify/3.1.6/purify.min.js'
];

// ==================== Service Worker 核心代码 ====================

// API 响应缓存：24 小时过期，最多保留 300 条带时间戳的响应
const API_CACHE_TTL = 24 * 60 * 60 * 1000;
const API_CACHE_MAX = 300;

// 只在本项目缓存内查找，避免跨 PWA 误命中同名资源
function matchOwnCache(request) {
    return caches.open(CACHE_NAME).then(cache => cache.match(request));
}

// probe() 的探测请求（freedictionaryapi.com/test、datamuse 的 sp=test）不缓存
function isProbeRequest(url) {
    if (url.hostname === 'freedictionaryapi.com' && url.pathname.toLowerCase().includes('test')) return true;
    return url.hostname === 'api.datamuse.com' && url.searchParams.get('sp') === 'test';
}

function matchOwnApiCache(request) {
    return matchOwnCache(request).then(response => {
        if (!response) return null;
        const cachedAt = Number(response.headers.get('sw-cached-at'));
        if (cachedAt && Date.now() - cachedAt > API_CACHE_TTL) {
            caches.open(CACHE_NAME).then(cache => cache.delete(request)).catch(() => {});
            return null;
        }
        return response;
    });
}

function cacheApiResponse(request, response) {
    if (request.method !== 'GET' || !response || !response.ok) return Promise.resolve();
    if (isProbeRequest(new URL(request.url))) return Promise.resolve();
    // fetch 返回的 Headers 不可写，复制一份再打时间戳
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', String(Date.now()));
    const clone = new Response(response.clone().body, {
        status: response.status,
        statusText: response.statusText,
        headers
    });
    return caches.open(CACHE_NAME).then(async (cache) => {
        await cache.put(request, clone);
        const keys = await cache.keys();
        const timestamped = [];
        for (const key of keys) {
            const cached = await cache.match(key);
            const cachedAt = cached ? Number(cached.headers.get('sw-cached-at')) : 0;
            if (cachedAt && Date.now() - cachedAt > API_CACHE_TTL) {
                await cache.delete(key);
            } else if (cachedAt) {
                timestamped.push({ key, cachedAt });
            }
        }
        if (timestamped.length > API_CACHE_MAX) {
            timestamped.sort((a, b) => a.cachedAt - b.cachedAt)
                .slice(0, timestamped.length - API_CACHE_MAX)
                .forEach(item => cache.delete(item.key));
        }
    });
}

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

    // API 请求使用网络优先策略（在 scope filter 之前，因为 API 是跨域）
    const apiHosts = ['freedictionaryapi.com', 'api.dictionaryapi.dev', 'api.datamuse.com', 'www.dictionaryapi.com', 'en.wiktionary.org'];
    if (apiHosts.includes(url.hostname)) {
        if (isProbeRequest(url)) {
            event.respondWith(fetch(request));
            return;
        }
        event.respondWith(
            fetch(request)
                .then((response) => {
                    cacheApiResponse(request, response).catch(() => {});
                    return response;
                })
                .catch(async () => {
                    const cached = await matchOwnApiCache(request);
                    return cached || new Response('Offline', { status: 503 });
                })
        );
        return;
    }

    // 只拦截当前 PWA 路径下的请求
    const isMyPath = url.pathname.startsWith(`${CURRENT_PATH}/`) || 
                       url.pathname === `${CURRENT_PATH}`;
    
    // CDN 资源也处理
    const isCDN = url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net';
    
    if (!isMyPath && !isCDN) {
        // 不拦截其他路径的请求
        return;
    }

    // 静态资源使用缓存优先策略
    event.respondWith(
        matchOwnCache(request).then((response) => {
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
