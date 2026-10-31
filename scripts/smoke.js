// オフラインのスモークテスト (外部APIには接続しない)。 `npm run check` で実行する。
// 仕様書の受入テストのうち、提供元の応答に依存せず確認できるもの (AT-04/08/12/13 ほか) を検証する。
import http from 'node:http';
import { createApp } from '../server/app.js';
import { createRecommender } from '../public/js/core/domain/recommend.js';
import { Errors } from '../public/js/core/errors.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -> ${detail}` : ''}`);
};

// ---- テスト用データ ----
const mk = (id, title, artist, year) => ({
  trackId: `itunes:${id}`,
  title,
  artists: [artist],
  artistName: artist,
  album: 'alb',
  releaseDate: year ? `${year}-04-01` : null,
  releaseYear: year,
  genre: 'J-Pop',
  versions: [],
  source: 'itunes',
});
const art = (name, tags) => ({
  sourceId: name,
  name,
  sortName: name,
  country: 'JP',
  type: 'Group',
  gender: null,
  beginYear: 1990,
  tags: tags.map(([n, c]) => ({ name: n, count: c })),
  searchScore: 100,
  source: 'musicbrainz',
});

const seedA = mk(1, 'SeedA', 'ArtistA', 1998);
const seedB = mk(2, 'SeedB', 'ArtistB', null); // 発売年が不明
const catalogData = {
  ArtistA: [seedA],
  ArtistB: [seedB],
  ArtistC: [mk(10, 'C1', 'ArtistC', 1997), mk(11, 'C2', 'ArtistC', null)],
  ArtistD: [mk(20, 'D1', 'ArtistD', 1999)],
};
const artistInfo = {
  ArtistA: art('ArtistA', [['j-rock', 5], ['j-pop', 4]]),
  ArtistB: art('ArtistB', [['j-rock', 5], ['j-pop', 3]]),
  ArtistC: art('ArtistC', [['j-rock', 6], ['j-pop', 3]]),
  ArtistD: art('ArtistD', [['j-rock', 4], ['j-pop', 4]]),
};
const makeProviders = (over = {}) => ({
  catalog: {
    searchTracks: async () => [seedA, seedB],
    lookupTracks: async (ids) => [seedA, seedB].filter((t) => ids.includes(t.trackId)),
    artistTracks: async (name) => catalogData[name] ?? [],
    ...over.catalog,
  },
  artists: {
    findArtist: async (name) => artistInfo[name] ?? null,
    findArtistsByStyle: async () => [artistInfo.ArtistC, artistInfo.ArtistD],
    ...over.artists,
  },
});
const input = { trackIds: [seedA.trackId, seedB.trackId], mode: 'balanced', count: 5, deadlineMs: 20000 };

// ---- AT-08 / AT-13: 不明情報の扱いと候補不足 ----
{
  const rec = createRecommender({ providers: makeProviders() });
  const r = await rec.recommend(input);
  check('AT-13 shortage reported instead of padding', r.items.length < 5 && r.shortage?.returned === r.items.length, r.shortage?.message);
  check('AT-13 every item exists in the catalog', r.items.every((i) => Object.values(catalogData).flat().some((t) => t.trackId === i.track.trackId)));
  check('AT-13 shortage offers ways to widen the search', r.shortage?.suggestions.length >= 2);
  check('seed tracks are excluded', r.items.every((i) => ![seedA.trackId, seedB.trackId].includes(i.track.trackId)));
  const unknown = r.items.find((i) => i.track.releaseYear === null);
  check('AT-08 unknown-year candidate flagged as 情報不足', !unknown || unknown.badges.some((b) => b.startsWith('情報不足')));
  check('AT-08 unknown-year reason does not assert a year', !unknown || (/未確認/.test(unknown.reason) && !/\d{4}年/.test(unknown.reason)), unknown?.reason);
  check('AT-08 summary admits the unknown year', r.summary.lines.some((l) => l.includes('不明')));
  check('AT-08 seed profile lists releaseYear as missing', r.seeds[1].profile.missing.includes('releaseYear'));
  const known = r.items.find((i) => i.track.releaseYear);
  check('known-year candidate ranks above unknown-year candidate', !unknown || !known || r.items.indexOf(known) < r.items.indexOf(unknown));
  check('karaoke status is "unconfirmed", never "unavailable"', r.items.every((i) => i.karaoke.status === 'unconfirmed'));
}

// ---- AT-09: 再提案で候補が尽きた場合 ----
{
  const rec = createRecommender({ providers: makeProviders() });
  const first = await rec.recommend(input);
  const again = await rec.recommend({ ...input, excludeTrackIds: first.items.map((i) => i.track.trackId) });
  check('exhausted resuggest returns 0 items with explanation', again.items.length === 0 && /これ以上|見つかりませんでした/.test(again.shortage?.message ?? ''), again.shortage?.message);
}

// ---- AT-12 / FR-10: 外部API失敗 ----
{
  const failing = createRecommender({
    providers: makeProviders({ catalog: { artistTracks: async () => { throw Errors.upstreamLimited(new Error('HTTP 403')); } } }),
  });
  let err;
  try { await failing.recommend(input); } catch (e) { err = e; }
  check('AT-12 upstream limit surfaces as a retryable AppError', err?.code === 'upstream_rate_limited' && err.retryable === true, err?.userMessage);

  let fail = true;
  const flaky = createRecommender({
    providers: makeProviders({ catalog: { artistTracks: async (n) => { if (fail) throw Errors.timeout(); return catalogData[n] ?? []; } } }),
  });
  let e2;
  try { await flaky.recommend(input); } catch (e) { e2 = e; }
  fail = false;
  const ok = await flaky.recommend(input);
  check('AT-12 recovers on retry after a transient failure', e2?.code === 'upstream_timeout' && ok.items.length > 0, `items=${ok.items.length}`);

  const degraded = createRecommender({
    providers: makeProviders({ artists: { findArtist: async () => { throw Errors.upstream(new Error('mb down')); } } }),
  });
  let r, e3;
  try { r = await degraded.recommend(input); } catch (e) { e3 = e; }
  check('FR-10 artist-lookup failure degrades gracefully', !e3 && r.meta.degraded.length > 0 && r.notes.some((n) => n.includes('取得できなかった')), e3?.message);
}

// ---- HTTP 層 ----
function raw(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}
const postJson = (port, obj) =>
  raw(port, 'POST', '/api/recommend', { headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });

{
  const server = createApp({
    providers: makeProviders({ catalog: { artistTracks: async () => { throw Errors.network(new Error('ECONNRESET')); } } }),
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const down = await postJson(port, { trackIds: ['itunes:1', 'itunes:2'] });
    const downBody = JSON.parse(down.text);
    check('AT-12 HTTP: upstream failure -> 502, Japanese message, retryable', down.status === 502 && downBody.error.retryable === true && /接続できませんでした/.test(downBody.error.message), JSON.stringify(downBody.error));

    const one = await postJson(port, { trackIds: ['itunes:1'] });
    check('AT-04 HTTP: one seed song is rejected (400)', one.status === 400);
    const same = await postJson(port, { trackIds: ['itunes:1', 'itunes:1'] });
    check('FR-02 HTTP: the same song twice is rejected (400)', same.status === 400);
    const bad = await postJson(port, { trackIds: ['itunes:1', 'x; drop'] });
    check('HTTP: malformed track id is rejected (400)', bad.status === 400);
    const wrongType = await raw(port, 'POST', '/api/recommend', { headers: { 'content-type': 'text/plain' }, body: '{}' });
    check('HTTP: non-JSON content type is rejected (400)', wrongType.status === 400);
    const empty = await raw(port, 'GET', '/api/search?q=');
    check('AT-01 HTTP: empty search word is rejected (400)', empty.status === 400);

    const search = await raw(port, 'GET', `/api/search?q=${encodeURIComponent('テスト')}`);
    const searchBody = JSON.parse(search.text);
    check('AT-01 HTTP: search returns normalized results', search.status === 200 && searchBody.results.length > 0 && 'artistName' in searchBody.results[0]);

    const index = await raw(port, 'GET', '/');
    check('static: index served with CSP and nosniff', index.status === 200 && Boolean(index.headers['content-security-policy']) && index.headers['x-content-type-options'] === 'nosniff');
    const traversal = await raw(port, 'GET', '/..%2fpackage.json');
    check('static: path traversal is refused', traversal.status === 404, `status=${traversal.status}`);
    const traversal2 = await raw(port, 'GET', '/../package.json');
    check('static: raw ../ path is refused', traversal2.status !== 200, `status=${traversal2.status}`);
    const dot = await raw(port, 'GET', '/.env');
    check('static: dotfiles are not served', dot.status === 404, `status=${dot.status}`);
    const post = await raw(port, 'POST', '/index.html');
    check('static: non-GET methods get 405', post.status === 405);
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

// ---- ブラウザ版の窓口 (public/js/api.js): fetch だけを偽物にして、本物の Throttle / fetchJson / 推薦ロジックを通す ----
{
  const { createApi, ApiError } = await import('../public/js/api.js');
  const { createProviders } = await import('../public/js/core/create-providers.js');

  const itunesRec = (t) => ({
    wrapperType: 'track', kind: 'song', trackId: Number(t.trackId.split(':')[1]), trackName: t.title,
    artistName: t.artistName, collectionName: t.album, primaryGenreName: t.genre,
    releaseDate: t.releaseYear ? `${t.releaseYear}-04-01T07:00:00Z` : undefined,
  });
  const allTracks = Object.values(catalogData).flat();
  const mbRec = (a) => ({ id: a.sourceId, name: a.name, 'sort-name': a.name, country: a.country, type: a.type, tags: a.tags, score: 100 });

  const realFetch = globalThis.fetch;
  const wait = (ms, signal) =>
    new Promise((resolve, reject) => {
      const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      if (signal?.aborted) return fail();
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => { clearTimeout(timer); fail(); }, { once: true });
    });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  function stubFetch({ delayMs = 0, status = 200, throwNetwork = false } = {}) {
    const calls = [];
    globalThis.fetch = async (url, init = {}) => {
      const u = new URL(url);
      calls.push({ host: u.host, href: u.href, headers: init.headers ?? {} });
      if (throwNetwork) throw new TypeError('Failed to fetch');
      await wait(delayMs, init.signal);
      if (status !== 200) return json({ error: 'stub' }, status);
      if (u.host === 'itunes.apple.com') {
        if (u.pathname.endsWith('/lookup')) {
          const ids = u.searchParams.get('id').split(',').map((v) => `itunes:${v}`);
          return json({ results: allTracks.filter((t) => ids.includes(t.trackId)).map(itunesRec) });
        }
        if (u.searchParams.get('attribute') === 'artistTerm') {
          return json({ results: (catalogData[u.searchParams.get('term')] ?? []).map(itunesRec) });
        }
        return json({ results: [seedA, seedB].map(itunesRec) });
      }
      if (u.host === 'musicbrainz.org') {
        const query = u.searchParams.get('query');
        const named = /^artist:"([^"]+)"/.exec(query);
        if (named) return json({ artists: artistInfo[named[1]] ? [mbRec(artistInfo[named[1]])] : [] });
        return json({ artists: [artistInfo.ArtistC, artistInfo.ArtistD].map(mbRec) });
      }
      return json({}, 404);
    };
    return calls;
  }
  const fastApi = () => createApi({ providers: createProviders({ itunesMinIntervalMs: 5, mbMinIntervalMs: 5 }) });
  const setOnline = (online) =>
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: online }, configurable: true, writable: true });
  const code = async (p) => { try { await p; return null; } catch (e) { return e; } };
  const payload = { trackIds: [seedA.trackId, seedB.trackId], mode: 'balanced', count: 5 };

  try {
    // 検索と推薦。通信先は提供元の2ホストだけで、自前の /api は使わない
    let calls = stubFetch();
    const api = fastApi();
    const found = await api.searchTracks('テスト');
    check('PWA search: returns normalized results from the catalog', found.results.length === 2 && found.results[0].trackId === seedA.trackId, found.results.map((r) => r.title).join(','));
    const rec = await api.recommend(payload);
    check('PWA recommend: items come from the stubbed catalog, seeds excluded', rec.items.length > 0 && rec.items.every((i) => allTracks.some((t) => t.trackId === i.track.trackId) && ![seedA.trackId, seedB.trackId].includes(i.track.trackId)), `items=${rec.items.length}`);
    check('PWA recommend: shortage is reported instead of padding', rec.shortage?.returned === rec.items.length);
    check('PWA: only iTunes and MusicBrainz are contacted (no own /api)', calls.every((c) => ['itunes.apple.com', 'musicbrainz.org'].includes(c.host)), [...new Set(calls.map((c) => c.host))].join(','));
    check('PWA: no User-Agent header is set (browsers cannot set it)', calls.every((c) => !Object.keys(c.headers).some((k) => k.toLowerCase() === 'user-agent')));

    // 入力検証 (サーバー版と同じ規則)
    const one = await code(api.recommend({ trackIds: [seedA.trackId] }));
    check('PWA: one seed song is rejected', one instanceof ApiError && one.code === 'bad_request' && !one.retryable, one?.message);
    const dup = await code(api.recommend({ trackIds: [seedA.trackId, seedA.trackId] }));
    check('PWA: the same song twice is rejected', dup instanceof ApiError && dup.code === 'bad_request');
    const blank = await code(api.searchTracks('   '));
    check('PWA: blank search word is rejected', blank instanceof ApiError && blank.code === 'bad_request');

    // キャンセル: 中断後は新しい通信を始めず、直後の再実行も遅れず成功する
    calls = stubFetch({ delayMs: 80 });
    const cancelApi = fastApi();
    const ac = new AbortController();
    const pending = code(cancelApi.recommend(payload, ac.signal));
    await new Promise((r) => setTimeout(r, 150));
    const atAbort = calls.length;
    const t0 = Date.now();
    ac.abort();
    const cancelled = await pending;
    const abortMs = Date.now() - t0;
    await new Promise((r) => setTimeout(r, 400));
    check('PWA cancel: rejects with code "cancelled" immediately', cancelled instanceof ApiError && cancelled.code === 'cancelled' && abortMs < 300, `${abortMs}ms ${cancelled?.code}`);
    check('PWA cancel: no new requests start after the abort', calls.length === atAbort, `at abort=${atAbort}, later=${calls.length}`);
    calls = stubFetch();
    const t1 = Date.now();
    const again = await cancelApi.recommend(payload);
    check('PWA cancel: an immediate retry succeeds and is not delayed by the old run', again.items.length > 0 && Date.now() - t1 < 2000, `${Date.now() - t1}ms`);

    // オフライン: 通信を試みず、分かる言葉で再試行可能として返す
    calls = stubFetch();
    setOnline(false);
    const off = await code(fastApi().recommend(payload));
    const offSearch = await code(fastApi().searchTracks('abc'));
    setOnline(true);
    check('PWA offline: recommend fails with a retryable message and no request', off instanceof ApiError && off.code === 'offline' && off.retryable && /接続/.test(off.message) && calls.length === 0, off?.message);
    check('PWA offline: search fails the same way', offSearch?.code === 'offline');

    // 提供元の失敗 (FR-10 / AT-12)
    stubFetch({ status: 503 });
    const limited = await code(fastApi().recommend(payload));
    check('PWA AT-12: upstream 503 -> retryable "利用制限" message', limited instanceof ApiError && limited.retryable && limited.code === 'upstream_rate_limited', limited?.message);
    stubFetch({ throwNetwork: true });
    const net = await code(fastApi().searchTracks('abc'));
    check('PWA AT-12: network failure -> retryable "接続できませんでした" message', net instanceof ApiError && net.retryable && /接続できませんでした/.test(net.message), net?.message);
  } finally {
    globalThis.fetch = realFetch;
    setOnline(true);
  }
}

// ---- PWA の配信物 (manifest / Service Worker / index.html) ----
{
  const { readFile, readdir, stat } = await import('node:fs/promises');
  const path = await import('node:path');
  const publicDir = path.resolve(import.meta.dirname, '../public');
  const read = (rel) => readFile(path.join(publicDir, rel), 'utf8');
  const exists = (rel) => stat(path.join(publicDir, rel)).then(() => true, () => false);
  async function walk(dir, base = '') {
    const out = [];
    for (const e of await readdir(path.join(dir, base), { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...(await walk(dir, rel)));
      else out.push(rel);
    }
    return out;
  }

  // Service Worker の先読み一覧 = public/ の実ファイル (sw.js 自身を除く)
  const swSource = await read('sw.js');
  const listed = [...swSource.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((p) => p !== './');
  const actual = (await walk(publicDir)).filter((f) => f !== 'sw.js');
  const missingFromList = actual.filter((f) => !listed.includes(f));
  const staleInList = listed.filter((f) => !actual.includes(f));
  check('SW: every file in public/ is precached (so the app opens offline)', missingFromList.length === 0, missingFromList.join(', '));
  check('SW: precache list has no files that do not exist', staleInList.length === 0, staleInList.join(', '));
  check('SW: only same-origin GET requests are handled (music data is never stored)', /origin !== self\.location\.origin\) return/.test(swSource) && /method !== 'GET'\) return/.test(swSource));

  // manifest
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  check('manifest: standalone display with relative start_url/scope (works under a sub-path)', manifest.display === 'standalone' && manifest.start_url === './' && manifest.scope === './');
  const iconChecks = await Promise.all(manifest.icons.map((i) => exists(i.src)));
  check('manifest: every icon file exists', iconChecks.every(Boolean));
  check('manifest: has 192px and 512px icons plus a maskable one', ['192x192', '512x512'].every((s) => manifest.icons.some((i) => i.sizes === s && i.purpose === 'any')) && manifest.icons.some((i) => i.purpose === 'maskable'));

  // index.html
  const html = await read('index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith('#'));
  check('index.html: every href/src is relative (no leading "/" or external URL)', refs.every((r) => !r.startsWith('/') && !/^[a-z]+:/i.test(r)), refs.filter((r) => r.startsWith('/') || /^[a-z]+:/i.test(r)).join(', '));
  const refExists = await Promise.all(refs.map((r) => exists(r)));
  check('index.html: every referenced file exists', refExists.every(Boolean), refs.filter((_, i) => !refExists[i]).join(', '));

  // CSP: index.html の meta とサーバーのヘッダーが同じ (frame-ancestors は meta では無効なので比較から除く)
  const metaCsp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
  const directives = (csp) => new Set(csp.split(';').map((d) => d.trim()).filter((d) => d && !d.startsWith('frame-ancestors')));
  const server = createApp({ providers: makeProviders() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const port = server.address().port;
    const page = await raw(port, 'GET', '/');
    const headerCsp = page.headers['content-security-policy'] ?? '';
    const a = directives(metaCsp);
    const b = directives(headerCsp);
    check('CSP: index.html meta matches the server header', a.size > 0 && a.size === b.size && [...a].every((d) => b.has(d)), `meta=${[...a].filter((d) => !b.has(d))} header=${[...b].filter((d) => !a.has(d))}`);
    check('CSP: connect-src allows exactly iTunes and MusicBrainz (plus self)', /connect-src 'self' https:\/\/itunes\.apple\.com https:\/\/musicbrainz\.org(;|$)/.test(metaCsp));
    check('CSP: scripts are same-origin only (no inline / eval)', /script-src 'self'(;|$)/.test(metaCsp) && !/unsafe-/.test(metaCsp));

    const mf = await raw(port, 'GET', '/manifest.webmanifest');
    check('server: manifest is served as application/manifest+json', mf.status === 200 && /application\/manifest\+json/.test(mf.headers['content-type']));
    const sw = await raw(port, 'GET', '/sw.js');
    check('server: sw.js is served as JavaScript and not cached by the browser', sw.status === 200 && /javascript/.test(sw.headers['content-type']) && /no-cache/.test(sw.headers['cache-control']));
    const icon = await raw(port, 'GET', '/icons/icon-192.png');
    check('server: PNG icons are served as image/png', icon.status === 200 && icon.headers['content-type'] === 'image/png');
    const core = await raw(port, 'GET', '/js/core/domain/recommend.js');
    check('server: shared core modules are served to the browser', core.status === 200 && /javascript/.test(core.headers['content-type']));
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
