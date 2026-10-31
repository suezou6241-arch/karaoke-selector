import { fetchJson } from '../lib/http.js';
import { trackFromItunes } from '../domain/normalize.js';

const BASE = 'https://itunes.apple.com';

/**
 * 楽曲カタログ・プロバイダー (iTunes Search API / キー不要 / CORS 対応)。
 *
 * プロバイダーが満たすインターフェース (差し替え可能)。どのメソッドも末尾の signal で中断できる:
 *   searchTracks(query, { limit, signal })        -> Track[]
 *   lookupTracks(trackIds, { signal })            -> Track[]   (存在確認も兼ねる)
 *   artistTracks(artistName, { limit, signal })   -> Track[]   (人気順の目安として提供元の返却順を保持)
 *
 * 利用条件の注意: 検索結果の表示では提供元を明示し、プレビュー音源・アートワークは利用しない。
 */
export function createItunesProvider({ throttle, cache, timeoutMs }) {
  const call = (params, ttlMs, signal) => {
    const url = `${BASE}/${params.endpoint}?${params.qs}`;
    return cache.wrap(`itunes:${url}`, ttlMs, () =>
      throttle.run(() => fetchJson(url, { throttle, timeoutMs, retries: 1, signal }), { signal }),
    );
  };

  const toTracks = (json) => (json?.results ?? []).map(trackFromItunes).filter(Boolean);

  return {
    name: 'itunes',

    async searchTracks(query, { limit = 50, signal } = {}) {
      const qs = new URLSearchParams({
        term: query,
        country: 'JP',
        media: 'music',
        entity: 'song',
        limit: String(limit),
        lang: 'ja_jp',
      }).toString();
      return toTracks(await call({ endpoint: 'search', qs }, 10 * 60_000, signal));
    },

    async lookupTracks(trackIds, { signal } = {}) {
      const ids = trackIds
        .map((id) => /^itunes:(\d{1,12})$/.exec(id)?.[1])
        .filter(Boolean);
      if (ids.length === 0) return [];
      const qs = new URLSearchParams({ id: ids.join(','), country: 'JP', entity: 'song', lang: 'ja_jp' }).toString();
      return toTracks(await call({ endpoint: 'lookup', qs }, 60 * 60_000, signal));
    },

    async artistTracks(artistName, { limit = 50, signal } = {}) {
      const qs = new URLSearchParams({
        term: artistName,
        country: 'JP',
        media: 'music',
        entity: 'song',
        attribute: 'artistTerm',
        limit: String(limit),
        lang: 'ja_jp',
      }).toString();
      return toTracks(await call({ endpoint: 'search', qs }, 6 * 60 * 60_000, signal));
    },
  };
}
