import { h, mount, fmtDateTime, trackSub } from '../dom.js';
import { modeName } from '../constants.js';

/** 履歴・お気に入り (FR-09 / 6.4)。端末内保存のみ。 */
export function renderLibrary(root, ctx) {
  const tab = ctx.state.libraryTab;
  const history = ctx.getHistory();
  const favorites = ctx.getFavorites();

  const historyList = () =>
    history.length === 0
      ? [h('p', { class: 'muted' }, 'まだ履歴がありません。おすすめを探すと、ここに保存されます。')]
      : [
          h(
            'ul',
            { class: 'list' },
            history.map((s) =>
              h(
                'li',
                { class: 'card' },
                h('div', { class: 'card-title' }, fmtDateTime(s.createdAt)),
                h('div', { class: 'song-title' }, `${s.seeds[0].title} × ${s.seeds[1].title}`),
                h('div', { class: 'song-sub' }, `${s.seeds[0].artistName} / ${s.seeds[1].artistName}`),
                h('div', { class: 'badges' }, h('span', { class: 'badge' }, modeName(s.mode)), h('span', { class: 'badge' }, `${s.count}曲`)),
                h('p', { class: 'muted small' }, s.items.length ? s.items.slice(0, 3).map((i) => i.track.title).join('、') + (s.items.length > 3 ? ' ほか' : '') : '候補なし'),
                h(
                  'div',
                  { class: 'item-actions' },
                  h('button', { type: 'button', class: 'btn btn-small btn-primary', onclick: () => ctx.openSession(s) }, '結果を開く'),
                  h('button', { type: 'button', class: 'btn btn-small btn-danger', 'aria-label': `${s.seeds[0].title}と${s.seeds[1].title}の履歴を削除`, onclick: () => ctx.deleteSession(s.id) }, '削除'),
                ),
              ),
            ),
          ),
          h('button', { type: 'button', class: 'btn btn-danger btn-block', onclick: ctx.clearHistory }, '履歴をすべて削除'),
        ];

  const favoriteList = () =>
    favorites.length === 0
      ? [h('p', { class: 'muted' }, 'お気に入りはまだありません。おすすめ一覧の☆を押すと追加できます。')]
      : [
          h(
            'ul',
            { class: 'list' },
            favorites.map((f) =>
              h(
                'li',
                { class: 'card' },
                h('div', { class: 'song-title' }, f.title),
                h('div', { class: 'song-sub' }, trackSub(f)),
                f.album && h('div', { class: 'song-sub small' }, f.album),
                h('p', { class: 'muted small' }, 'カラオケ配信未確認'),
                h('div', { class: 'item-actions' }, h('button', { type: 'button', class: 'btn btn-small btn-danger', 'aria-label': `${f.title}をお気に入りから削除`, onclick: () => ctx.removeFavorite(f.trackId) }, '削除')),
              ),
            ),
          ),
          h('button', { type: 'button', class: 'btn btn-danger btn-block', onclick: ctx.clearFavorites }, 'お気に入りをすべて削除'),
        ];

  const subtab = (id, label, count) =>
    h('button', { type: 'button', class: 'tab', 'aria-current': tab === id ? 'page' : null, onclick: () => ctx.setLibraryTab(id) }, `${label}（${count}）`);

  mount(
    root,
    h('h2', { id: 'library-heading', class: 'view-heading', tabindex: '-1' }, '履歴・お気に入り'),
    h('p', { class: 'muted small' }, 'この端末のブラウザ内にだけ保存されます。ブラウザのデータを消去すると失われます。'),
    h('div', { class: 'subtabs', role: 'group', 'aria-label': '表示の切り替え' }, subtab('history', '履歴', history.length), subtab('favorites', 'お気に入り', favorites.length)),
    tab === 'history' ? historyList() : favoriteList(),
  );
}
