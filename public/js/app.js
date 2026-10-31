import { announce, toast } from './dom.js';
import { MODES } from './constants.js';
import * as store from './storage.js';
import { recommend, ApiError } from './api.js';
import { createSearchDialog } from './search.js';
import { renderHome } from './views/home.js';
import { renderResult } from './views/result.js';
import { renderLibrary } from './views/library.js';

const TRACK_ID = /^itunes:\d{1,12}$/;
const $ = (id) => document.getElementById(id);
const roots = { home: $('view-home'), result: $('view-result'), library: $('view-library') };

// ---------- 状態 ----------
const state = {
  view: 'home',
  seeds: [null, null],
  mode: 'balanced',
  count: 5,
  session: null,
  viewingSaved: false,
  loading: null, // { kind: 'recommend' | 'resuggest', startedAt, controller }
  error: null, // { message, retryable }
  resuggestNotice: null,
  libraryTab: 'history',
};

const slim = (t) => ({
  trackId: t.trackId,
  title: String(t.title),
  artistName: String(t.artistName),
  album: t.album ?? null,
  releaseDate: t.releaseDate ?? null,
  releaseYear: t.releaseYear ?? null,
  versions: Array.isArray(t.versions) ? t.versions.map(String) : [],
});

const validTrack = (t) =>
  t && typeof t === 'object' && TRACK_ID.test(String(t.trackId)) && typeof t.title === 'string' && typeof t.artistName === 'string';

function validSession(s) {
  return (
    s && typeof s === 'object' && typeof s.id === 'string' &&
    Array.isArray(s.seeds) && s.seeds.length === 2 && s.seeds.every(validTrack) &&
    Array.isArray(s.items) && s.summary && Array.isArray(s.summary.lines) &&
    Array.isArray(s.notes) && Array.isArray(s.shownIds) && MODES.some((m) => m.id === s.mode)
  );
}

function restoreDraft() {
  const d = store.loadDraft();
  if (!d) return;
  if (Array.isArray(d.seeds)) state.seeds = [0, 1].map((i) => (validTrack(d.seeds[i]) ? slim(d.seeds[i]) : null));
  if (MODES.some((m) => m.id === d.mode)) state.mode = d.mode;
  if (d.count === 5 || d.count === 10) state.count = d.count;
}

const persistDraft = () => store.saveDraft({ seeds: state.seeds, mode: state.mode, count: state.count });

// ---------- 進行表示 ----------
let ticker = null;
function progressMessage(sec) {
  if (sec < 8) return `曲の情報を取得しています…（${sec}秒）`;
  if (sec < 20) return `2曲の特徴を調べ、候補のアーティストを探しています…（${sec}秒）`;
  return `候補の曲を集めて比較しています…（${sec}秒）初回は30秒ほどかかることがあります`;
}
function startTicker() {
  stopTicker();
  const tick = () => {
    const el = $('progress-text');
    if (el && state.loading) el.textContent = progressMessage(Math.floor((Date.now() - state.loading.startedAt) / 1000));
  };
  tick();
  ticker = setInterval(tick, 1000);
}
function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

// ---------- 描画・画面遷移 ----------
function render() {
  renderHome(roots.home, ctx);
  renderResult(roots.result, ctx);
  renderLibrary(roots.library, ctx);
  if (state.loading) startTicker();
}

function navigate(view, { push = true, focus = true } = {}) {
  if (view !== state.view) {
    state.error = null;
    if (view !== 'result') state.resuggestNotice = null;
  }
  state.view = view;
  for (const [name, el] of Object.entries(roots)) el.hidden = name !== view;
  for (const btn of document.querySelectorAll('[data-nav]')) {
    const active = btn.dataset.nav === 'library' ? view === 'library' : view !== 'library';
    if (active) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  if (push) history.pushState({ view }, '');
  render();
  if (focus) {
    window.scrollTo(0, 0);
    roots[view].querySelector('h2')?.focus({ preventScroll: true });
  }
}

window.addEventListener('popstate', (e) => navigate(e.state?.view ?? 'home', { push: false }));
for (const btn of document.querySelectorAll('[data-nav]')) btn.addEventListener('click', () => navigate(btn.dataset.nav));

// ---------- 推薦の実行 ----------
async function execute(kind, payload) {
  const controller = new AbortController();
  state.loading = { kind, startedAt: Date.now(), controller };
  state.error = null;
  render();
  announce('おすすめ曲を探しています');
  try {
    return await recommend(payload, controller.signal);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'cancelled') {
      announce('キャンセルしました');
      return null;
    }
    state.error = {
      message: err instanceof ApiError ? err.message : '予期しないエラーが発生しました。もう一度お試しください。',
      retryable: err instanceof ApiError ? err.retryable : true,
    };
    announce(state.error.message);
    return null;
  } finally {
    state.loading = null;
    stopTicker();
  }
}

const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

async function startRecommend() {
  const [a, b] = state.seeds;
  if (state.loading || !a || !b || a.trackId === b.trackId) return;
  state.resuggestNotice = null;
  const data = await execute('recommend', { trackIds: [a.trackId, b.trackId], mode: state.mode, count: state.count });
  if (!data) {
    render(); // 入力は state に残したまま、エラーを表示する
    return;
  }
  const session = {
    id: newId(),
    createdAt: new Date().toISOString(),
    seeds: [slim(a), slim(b)],
    mode: data.mode,
    count: data.count,
    summary: data.summary,
    items: data.items,
    notes: data.notes,
    shortage: data.shortage,
    shownIds: data.items.map((i) => i.track.trackId),
    rounds: 1,
  };
  state.session = session;
  state.viewingSaved = false;
  if (session.items.length > 0 && !store.saveSession(session)) toast('履歴を保存できませんでした（端末の容量を確認してください）');
  announce(session.items.length ? `${session.items.length}曲のおすすめが見つかりました` : '候補が見つかりませんでした');
  navigate('result');
}

async function resuggest() {
  const s = state.session;
  if (!s || state.loading) return;
  state.resuggestNotice = null;
  const data = await execute('resuggest', {
    trackIds: s.seeds.map((t) => t.trackId),
    mode: s.mode,
    count: s.count,
    excludeTrackIds: s.shownIds.slice(-200),
  });
  if (!data) {
    render();
    return;
  }
  if (data.items.length === 0) {
    // 表示中の候補は残し、不足の理由と条件を広げる提案だけを出す
    state.resuggestNotice = data.shortage ?? {
      message: 'これ以上、新しい候補は見つかりませんでした。',
      suggestions: ['参考曲をどちらか別の曲に変更する', '推薦モードを変更する'],
    };
    render();
    announce(state.resuggestNotice.message);
    return;
  }
  s.items = data.items;
  s.summary = data.summary;
  s.notes = data.notes;
  s.shortage = data.shortage;
  s.shownIds = [...s.shownIds, ...data.items.map((i) => i.track.trackId)];
  s.rounds = (s.rounds ?? 1) + 1;
  state.viewingSaved = false;
  if (!store.saveSession(s)) toast('履歴を更新できませんでした');
  render();
  announce(`別の候補を${data.items.length}曲表示しました`);
  window.scrollTo(0, 0);
  roots.result.querySelector('h2')?.focus({ preventScroll: true });
}

// ---------- 検索ダイアログ ----------
let pendingSlot = 0;
const searchDialog = createSearchDialog($('search-dialog'), {
  onPick(track) {
    setSeed(pendingSlot, slim(track));
  },
});

function setSeed(i, track) {
  state.seeds[i] = track;
  state.error = null;
  store.addRecent(track);
  persistDraft();
  render();
  const other = state.seeds[1 - i];
  if (other && other.trackId === track.trackId) toast('同じ曲が2回選ばれています。別の曲に変更してください。');
  else announce(`参考曲${i + 1}に「${track.title}」を選びました`);
}

// ---------- 画面から呼ばれる操作 ----------
const ctx = {
  state,
  startRecommend,
  resuggest,
  cancel: () => state.loading?.controller.abort(),
  goHome: () => navigate('home'),
  openSearch(i) {
    pendingSlot = i;
    searchDialog.open(`参考曲${i + 1}`);
  },
  clearSeed(i) {
    state.seeds[i] = null;
    state.error = null;
    persistDraft();
    render();
    announce(`参考曲${i + 1}を解除しました`);
  },
  setMode(id) {
    state.mode = id;
    persistDraft();
  },
  setCount(n) {
    state.count = n;
    persistDraft();
  },
  getRecent: () => store.getRecent().filter(validTrack),
  useRecent(t) {
    const i = state.seeds.findIndex((s) => !s);
    if (i === -1) return toast('先に参考曲を1つ解除してください');
    setSeed(i, slim(t));
  },
  isFavorite: store.isFavorite,
  toggleFavorite(track, btn) {
    const added = store.toggleFavorite(track);
    if (added === null) return toast('お気に入りを保存できませんでした（端末の容量を確認してください）');
    btn.setAttribute('aria-pressed', String(added));
    btn.textContent = added ? '★' : '☆';
    toast(added ? `「${track.title}」をお気に入りに追加しました` : `「${track.title}」をお気に入りから外しました`);
  },
  // 履歴・お気に入り
  libraryTab: () => state.libraryTab,
  setLibraryTab(tab) {
    state.libraryTab = tab;
    renderLibrary(roots.library, ctx);
    roots.library.querySelector(`.subtabs .tab[aria-current="page"]`)?.focus();
  },
  getHistory: () => store.getHistory().filter(validSession),
  getFavorites: () => store.getFavorites().filter(validTrack),
  openSession(s) {
    state.session = structuredClone(s);
    state.viewingSaved = true;
    state.resuggestNotice = null;
    navigate('result');
  },
  deleteSession(id) {
    store.deleteSession(id);
    renderLibrary(roots.library, ctx);
    toast('履歴を削除しました');
  },
  clearHistory() {
    if (!confirm('履歴をすべて削除します。よろしいですか？')) return;
    store.clearHistory();
    renderLibrary(roots.library, ctx);
    toast('履歴をすべて削除しました');
  },
  removeFavorite(id) {
    store.removeFavorite(id);
    renderLibrary(roots.library, ctx);
    toast('お気に入りから削除しました');
  },
  clearFavorites() {
    if (!confirm('お気に入りをすべて削除します。よろしいですか？')) return;
    store.clearFavorites();
    renderLibrary(roots.library, ctx);
    toast('お気に入りをすべて削除しました');
  },
};

// ---------- オフライン対応 (画面を構成するファイルを端末に保存する) ----------
// 接続状態が変わったら、ホームのオフライン案内を更新する
for (const type of ['online', 'offline']) window.addEventListener(type, () => render());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker を登録できませんでした', err));
  });
}

// ---------- 起動 ----------
restoreDraft();
history.replaceState({ view: 'home' }, '');
navigate('home', { push: false, focus: false });
