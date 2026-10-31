/*
 * Service Worker: 画面を構成するファイル(アプリ本体)だけを端末に保存し、オフラインでも画面を開けるようにする。
 *
 * - 保存するのは同じオリジンのファイルのみ。iTunes / MusicBrainz への通信はここを通さない
 *   (楽曲データを保存しない方針。提供元の保存条件への配慮)。
 * - 通信できるときは常に最新を取りに行き、できないとき(オフライン・遅すぎる)だけ保存済みのものを使う。
 *   このため、アプリを更新したときに古い画面が残り続けない。
 * - PRECACHE を変更したら CACHE のバージョンも上げる。一覧がファイル構成と一致しているかは scripts/smoke.js が検査する。
 */
const CACHE = 'ks-shell-v1';
const NETWORK_TIMEOUT_MS = 4000;

const PRECACHE = [
  './',
  'index.html',
  'app.css',
  'favicon.svg',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'js/api.js',
  'js/app.js',
  'js/constants.js',
  'js/dom.js',
  'js/search.js',
  'js/storage.js',
  'js/views/home.js',
  'js/views/library.js',
  'js/views/result.js',
  'js/core/create-providers.js',
  'js/core/errors.js',
  'js/core/request.js',
  'js/core/search.js',
  'js/core/domain/normalize.js',
  'js/core/domain/profile.js',
  'js/core/domain/reasons.js',
  'js/core/domain/recommend.js',
  'js/core/domain/similarity.js',
  'js/core/domain/taxonomy.js',
  'js/core/lib/cache.js',
  'js/core/lib/http.js',
  'js/core/lib/sleep.js',
  'js/core/lib/throttle.js',
  'js/core/providers/itunes.js',
  'js/core/providers/musicbrainz.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ks-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function fetchFresh(request) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS);
  try {
    // no-cache: ブラウザの HTTP キャッシュが古くても、必ず最新かどうかを確認する
    return await fetch(request, { signal: controller.signal, cache: 'no-cache' });
  } finally {
    clearTimeout(timer);
  }
}

async function networkFirst(event) {
  const { request } = event;
  const cache = await caches.open(CACHE);
  try {
    const response = await fetchFresh(request);
    if (response.ok) event.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    // 保存していない画面遷移(例: 末尾の違うURL)は、アプリ本体を返す
    if (request.mode === 'navigate') {
      const shell = await cache.match(new URL('index.html', self.registration.scope).href);
      if (shell) return shell;
    }
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return; // 外部API等は素通し
  event.respondWith(networkFirst(event));
});
