import {
  GENRES,
  MOODS,
  INSTRUMENTATION,
  GENRE_MOOD_PRIOR,
  GENRE_INSTR_PRIOR,
  VOCAL_LABELS,
  genreKeyFromTag,
  moodKeyFromTag,
  instrKeyFromTag,
} from './taxonomy.js';
import { artistKey } from './normalize.js';

// 特徴を表さないタグ。アーティスト近さの計算から除外する。
const NOISE_TAGS = new Set([
  'japanese', 'japan', 'seen live', 'jpop', 'male vocalists', 'female vocalists', 'vocalist',
  'multiple vgmdb profiles', 'qi-western releases', 'clean up', 'doujin', 'yakousei',
]);

function put(vec, key, weight) {
  if (weight > (vec[key] ?? 0)) vec[key] = Math.min(1, weight);
}

function tagWeight(count, maxCount) {
  return 0.4 + 0.6 * (maxCount > 0 ? count / maxCount : 0);
}

/** アーティストのタグだけからジャンルベクトルを作る(候補アーティストの順位付け用)。 */
export function artistGenreVector(artist) {
  const vec = {};
  const tags = artist?.tags ?? [];
  const max = Math.max(0, ...tags.map((t) => t.count));
  for (const t of tags) {
    const k = genreKeyFromTag(t.name);
    if (k) put(vec, k, tagWeight(t.count, max));
  }
  return vec;
}

function vocalFromArtist(artist) {
  if (!artist) return null;
  const names = new Set((artist.tags ?? []).map((t) => t.name));
  if (artist.type === 'Group') return { type: 'group', label: VOCAL_LABELS.group, inferred: true };
  if (artist.type === 'Person' || !artist.type) {
    if (artist.gender === 'male') return { type: 'male_solo', label: VOCAL_LABELS.male_solo, inferred: true };
    if (artist.gender === 'female') return { type: 'female_solo', label: VOCAL_LABELS.female_solo, inferred: true };
    if (names.has('male vocalists') && !names.has('female vocalists'))
      return { type: 'male_solo', label: VOCAL_LABELS.male_solo, inferred: true };
    if (names.has('female vocalists') && !names.has('male vocalists'))
      return { type: 'female_solo', label: VOCAL_LABELS.female_solo, inferred: true };
    if (artist.type === 'Person') return { type: 'solo', label: VOCAL_LABELS.solo, inferred: true };
  }
  return null;
}

/**
 * 楽曲+アーティスト情報から比較用のプロファイルを作る。
 * 取得できない項目は空/ null のまま残し(推測で埋めない)、missing に記録する。
 * moods / instr のうちジャンルから導いた値は inferred=true として区別する。
 */
export function buildProfile({ track, artist }) {
  const genres = {};
  const moods = {};
  const instr = {};
  const rawTags = {};

  const itunesKey = genreKeyFromTag(track?.genre);
  if (itunesKey) put(genres, itunesKey, 1);

  const tags = artist?.tags ?? [];
  const maxCount = Math.max(0, ...tags.map((t) => t.count));
  let explicitMood = false;
  let explicitInstr = false;
  for (const t of tags) {
    const w = tagWeight(t.count, maxCount);
    const g = genreKeyFromTag(t.name);
    if (g) put(genres, g, w);
    const m = moodKeyFromTag(t.name);
    if (m) {
      put(moods, m, w);
      explicitMood = true;
    }
    const i = instrKeyFromTag(t.name);
    if (i) {
      put(instr, i, w);
      explicitInstr = true;
    }
    if (!NOISE_TAGS.has(t.name)) rawTags[t.name] = maxCount > 0 ? t.count / maxCount : 0;
  }

  // ジャンルから曲調・編成を推定する(明示タグより弱く扱う)
  for (const [g, gw] of Object.entries(genres)) {
    for (const [m, w] of Object.entries(GENRE_MOOD_PRIOR[g] ?? {})) put(moods, m, w * gw * 0.5);
    for (const [i, w] of Object.entries(GENRE_INSTR_PRIOR[g] ?? {})) put(instr, i, w * gw * 0.7);
  }

  const vocal = vocalFromArtist(artist);
  const year = track?.releaseYear ?? null;

  const missing = [];
  if (!year) missing.push('releaseYear');
  if (Object.keys(genres).length === 0) missing.push('genres');
  if (!artist) missing.push('artistInfo');
  else if (tags.length === 0) missing.push('artistTags');
  if (!vocal) missing.push('vocal');

  return {
    year,
    genres,
    moods,
    instr,
    vocal,
    rawTags,
    artistKey: artistKey(track?.artistName ?? artist?.name ?? ''),
    country: artist?.country ?? null,
    flags: { moodInferred: !explicitMood, instrInferred: !explicitInstr },
    missing,
  };
}

/** 親ジャンルを半分の重みで加えたベクトル(J-ROCK は ロック にも部分一致させる)。 */
export function expandGenres(genres) {
  const out = { ...genres };
  const visit = (key, weight, depth) => {
    if (depth > 3) return;
    for (const parent of GENRES.get(key)?.parents ?? []) {
      put(out, parent, weight * 0.5);
      visit(parent, weight * 0.5, depth + 1);
    }
  };
  for (const [k, w] of Object.entries(genres)) visit(k, w, 0);
  return out;
}

export const genreLabel = (key) => GENRES.get(key)?.label ?? key;
export const moodLabel = (key) => MOODS.get(key)?.label ?? key;
export const instrLabel = (key) => INSTRUMENTATION.get(key)?.label ?? key;

/** 重みが threshold 以上のキーを、重みの大きい順に返す。 */
export function topKeys(vec, threshold = 0.5, limit = 4) {
  return Object.entries(vec)
    .filter(([, w]) => w >= threshold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

/** 複数ベクトルのすべてで threshold 以上のキー(共通項目)。 */
export function sharedKeys(vecs, threshold = 0.5) {
  if (vecs.length === 0) return [];
  const first = Object.keys(vecs[0]);
  return first
    .filter((k) => vecs.every((v) => (v[k] ?? 0) >= threshold))
    .sort((a, b) => Math.min(...vecs.map((v) => v[b])) - Math.min(...vecs.map((v) => v[a])));
}
