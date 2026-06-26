// ============================================================
// 夹子 Service Worker - 离线缓存
// 每次升级要改 CACHE_VERSION，旧缓存会自动清除
// ============================================================

const CACHE_VERSION = 'v1.0.0';
const CACHE_NAME = `jiazi-${CACHE_VERSION}`;

// 预缓存的核心文件
const PRECACHE_URLS = [
    './',
    './index.html',
    './manifest.json',

    // CSS
    './css/styles.css',

    // 核心 JS
    './js/app.js',
    './js/backup-engine.js',
    './js/config.js',
    './js/core.js',
    './js/data.js',
    './js/features.js',
    './js/games.js',
    './js/listeners.js',
    './js/onboarding.js',
    './js/state.js',
    './js/utils.js',

    // 功能模块
    './js/features/call.js',
    './js/features/chuanci.js',
    './js/features/envelope.js',
    './js/features/group-chat.js',
    './js/features/mood.js',
    './js/features/reply-library.js',
    './js/features/theme-editor.js',

    // 图标
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/favicon-32.png',
];

// 安装阶段：预缓存所有核心文件
self.addEventListener('install', (event) => {
    console.log('[SW] install', CACHE_VERSION);
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                // 一次性缓存所有核心文件
                // 用 addAll 失败一次全失败，改用 add 逐个，失败也不阻塞
                return Promise.allSettled(
                    PRECACHE_URLS.map((url) =>
                        cache.add(new Request(url, { cache: 'reload' }))
                            .catch((err) => console.warn('[SW] precache fail:', url, err))
                    )
                );
            })
            .then(() => self.skipWaiting()) // 立即激活新 SW
    );
});

// 激活阶段：清理旧版本缓存
self.addEventListener('activate', (event) => {
    console.log('[SW] activate', CACHE_VERSION);
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys
                    .filter((key) => key.startsWith('jiazi-') && key !== CACHE_NAME)
                    .map((key) => {
                        console.log('[SW] delete old cache:', key);
                        return caches.delete(key);
                    })
            );
        }).then(() => self.clients.claim()) // 立即接管所有页面
    );
});

// 拦截网络请求：缓存优先策略
self.addEventListener('fetch', (event) => {
    const req = event.request;

    // 只处理 GET 请求
    if (req.method !== 'GET') return;

    const url = new URL(req.url);

    // 不缓存：跨域 API 请求（AI 接口）、Range 请求等
    if (url.origin !== self.location.origin) return;

    // 缓存优先 + 网络回填策略
    event.respondWith(
        caches.match(req).then((cached) => {
            if (cached) {
                // 后台静默更新缓存（stale-while-revalidate）
                fetch(req).then((freshResp) => {
                    if (freshResp && freshResp.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(req, freshResp.clone());
                        });
                    }
                }).catch(() => {});
                return cached;
            }
            // 缓存没有 → 走网络 → 顺便缓存起来
            return fetch(req).then((resp) => {
                if (resp && resp.status === 200 && resp.type === 'basic') {
                    const clone = resp.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
                }
                return resp;
            }).catch(() => {
                // 完全无网络 + 缓存也没有 → 返回降级响应
                if (req.headers.get('accept')?.includes('text/html')) {
                    return caches.match('./index.html');
                }
                return new Response('', { status: 504, statusText: 'Offline' });
            });
        })
    );
});

// 接收主线程的"清缓存"指令
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
    if (event.data && event.data.type === 'CLEAR_CACHE') {
        caches.keys().then((keys) => {
            keys.forEach((k) => caches.delete(k));
        });
    }
});
