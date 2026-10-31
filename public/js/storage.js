import { LIMITS } from './constants.js';

// 端末内(localStorage)だけに保存する。アカウントも外部送信もない。
const PREFIX = 'ks.v1.';

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const readArray = (key) => {
  const v = read(key, []);
  return Array.isArray(v) ? v : [];
};

// ---- 入力中の状態(再読み込みしても保持) ----
export const loadDraft = () => {
  const d = read('draft', null);
  return d && typeof d === 'object' ? d : null;
};
export const saveDraft = (draft) => write('draft', draft);

// ---- 最近使った曲 ----
export const getRecent = () => readArray('recent');
export function addRecent(track) {
  const list = getRecent().filter((t) => t.trackId !== track.trackId);
  list.unshift(track);
  write('recent', list.slice(0, LIMITS.recent));
}
export const clearRecent = () => write('recent', []);

// ---- 履歴 ----
export const getHistory = () =>
  readArray('history').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

export function saveSession(session) {
  const others = readArray('history').filter((s) => s.id !== session.id);
  let list = [session, ...others].slice(0, LIMITS.history);
  if (!write('history', list)) {
    // 容量超過時は古い履歴を減らして再試行
    list = list.slice(0, Math.max(1, Math.floor(list.length / 2)));
    return write('history', list);
  }
  return true;
}
export const deleteSession = (id) => write('history', readArray('history').filter((s) => s.id !== id));
export const clearHistory = () => write('history', []);

// ---- お気に入り ----
export const getFavorites = () =>
  readArray('favorites').sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)));
export const isFavorite = (trackId) => readArray('favorites').some((f) => f.trackId === trackId);

/** 追加なら true、解除なら false を返す。保存に失敗したら null。 */
export function toggleFavorite(track) {
  const list = readArray('favorites');
  const exists = list.some((f) => f.trackId === track.trackId);
  const next = exists
    ? list.filter((f) => f.trackId !== track.trackId)
    : [
        {
          trackId: track.trackId,
          title: track.title,
          artistName: track.artistName,
          album: track.album ?? null,
          releaseYear: track.releaseYear ?? null,
          addedAt: new Date().toISOString(),
        },
        ...list,
      ].slice(0, LIMITS.favorites);
  return write('favorites', next) ? !exists : null;
}
export const removeFavorite = (trackId) =>
  write('favorites', readArray('favorites').filter((f) => f.trackId !== trackId));
export const clearFavorites = () => write('favorites', []);
