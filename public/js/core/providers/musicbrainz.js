import { fetchJson } from '../lib/http.js';
import { textKey, yearOf } from '../domain/normalize.js';

const BASE = 'https://musicbrainz.org/ws/2';

const lucene = (s) => String(s).replace(/[\\"]/g, '\\$&');

function artistFromMb(a, score) {
  return {
    sourceId: a.id,
    name: a.name,
    sortName: a['sort-name'] ?? null,
    // 改名・旧名義 (例: 荒井由実 → 松任谷由実)。曲の表示名が別名の場合でも同一人物として照合するために使う。
    aliases: (a.aliases ?? []).map((x) => x?.name).filter(Boolean),
    country: a.country ?? null,
    type: a.type ?? null, // Person / Group / Character / Orchestra ...
    gender: a.gender ? String(a.gender).toLowerCase() : null,
    beginYear: yearOf(a['life-span']?.begin),
    tags: (a.tags ?? [])
      .map((t) => ({ name: String(t.name).toLowerCase(), count: Number(t.count) || 0 }))
      .filter((t) => t.count > 0),
    searchScore: Number(score ?? a.score) || 0,
    source: 'musicbrainz',
  };
}

/**
 * アーティスト情報プロバイダー (MusicBrainz / キー不要・1リクエスト/秒)。
 *
 *   findArtist(name, { signal })  -> ArtistInfo | null  (名前・ソート名・別名のいずれかが完全一致した場合のみ)
 *   findArtistsByStyle(criteria)  -> ArtistInfo[]
 *     criteria: { allTags: string[], country?: string, beginFrom?: number, beginTo?: number, offset?: number, limit?: number, signal?: AbortSignal }
 *
 * タグは利用者投票によるもので、欠けや偏りがある。値は「推定」として扱うこと。
 */
export function createMusicBrainzProvider({ throttle, cache, timeoutMs, contact }) {
  // サーバーでは連絡先入りの User-Agent を送る (MusicBrainz の要請)。
  // ブラウザは User-Agent を変更できないため、contact を渡さず、ヘッダーを付けない。
  const headers = contact ? { 'User-Agent': `KaraokeSelector/0.1 ( ${contact} )` } : {};

  const call = (path, qs, ttlMs, signal) => {
    const url = `${BASE}/${path}?${qs}`;
    return cache.wrap(`mb:${url}`, ttlMs, () =>
      throttle.run(() => fetchJson(url, { headers, throttle, timeoutMs, retries: 2, signal }), { signal }),
    );
  };

  async function searchArtists(query, { limit, offset = 0, signal }) {
    const qs = new URLSearchParams({ query, fmt: 'json', limit: String(limit), offset: String(offset) }).toString();
    const json = await call('artist', qs, 24 * 60 * 60_000, signal);
    return (json?.artists ?? []).map((a) => artistFromMb(a));
  }

  return {
    name: 'musicbrainz',

    async findArtist(name, { signal } = {}) {
      const wanted = textKey(name);
      if (!wanted) return null;
      const list = await searchArtists(`artist:"${lucene(name)}" OR alias:"${lucene(name)}"`, { limit: 5, signal });
      const exact = list.find(
        (a) => textKey(a.name) === wanted || textKey(a.sortName) === wanted || a.aliases.some((x) => textKey(x) === wanted),
      );
      if (exact) return exact;
      // 完全一致がなくても、検索スコアが十分高く、かつ名前が包含関係なら同一とみなす
      const top = list[0];
      if (top && top.searchScore >= 95) {
        const k = textKey(top.name);
        if (k.includes(wanted) || wanted.includes(k)) return top;
      }
      return null;
    },

    async findArtistsByStyle({ allTags, country, beginFrom, beginTo, offset = 0, limit = 50, signal }) {
      const clauses = allTags.map((t) => `tag:"${lucene(t)}"`);
      if (country) clauses.push(`country:${lucene(country)}`);
      if (beginFrom && beginTo) clauses.push(`begin:[${beginFrom} TO ${beginTo}]`);
      if (clauses.length === 0) return [];
      return searchArtists(clauses.join(' AND '), { limit, offset, signal });
    },
  };
}
