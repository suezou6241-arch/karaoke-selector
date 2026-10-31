import { Errors } from './errors.js';
import { collapseTracks } from './domain/normalize.js';

const MAX_QUERY_CHARS = 100;
const MAX_RESULTS = 25;

// 検索結果の並べ替え: 原曲らしいものを先に、カラオケ音源・カバー等は後ろへ。
function searchRank(t) {
  if (t.versions.some((v) => ['instrumental', 'cover'].includes(v.id))) return 2;
  if (t.versions.length > 0) return 1;
  return 0;
}

/** 検索語を検証し、制御文字を空白にして前後を整える。 */
export function normalizeQuery(raw) {
  const q = String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (!q) throw Errors.badRequest('検索ワードを入力してください。');
  if ([...q].length > MAX_QUERY_CHARS) throw Errors.badRequest(`検索ワードは${MAX_QUERY_CHARS}文字以内で入力してください。`);
  return q;
}

/** 楽曲を検索し、同一曲をまとめて画面表示用の形にする (FR-01)。 */
export async function searchCatalog({ catalog, query, signal }) {
  const q = normalizeQuery(query);
  const raw = await catalog.searchTracks(q, { limit: 50, signal });
  const results = collapseTracks(raw)
    .map((t, i) => ({ t, i }))
    .sort((a, b) => searchRank(a.t) - searchRank(b.t) || a.i - b.i)
    .slice(0, MAX_RESULTS)
    .map(({ t }) => ({
      trackId: t.trackId,
      title: t.title,
      artistName: t.artistName,
      album: t.album,
      releaseDate: t.releaseDate,
      releaseYear: t.releaseYear,
      versions: t.versions.map((v) => v.label),
      alsoOn: t.alsoOn,
    }));
  return { query: q, results, source: 'iTunes Search API' };
}
