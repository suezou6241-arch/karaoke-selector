import { h, mount, fmtDateTime, trackSub } from '../dom.js';
import { modeName, MATCH_LABELS } from '../constants.js';
import { progressCard, errorNotice } from './home.js';

const dots = (n) => '●'.repeat(n) + '○'.repeat(5 - n);

export function renderResult(root, ctx) {
  const { state } = ctx;
  const session = state.session;
  if (!session) {
    mount(
      root,
      h('h2', { id: 'result-heading', class: 'view-heading', tabindex: '-1' }, 'おすすめ曲'),
      h('p', { class: 'muted' }, 'まだ推薦結果がありません。ホームで2曲を選んでください。'),
      h('button', { type: 'button', class: 'btn btn-primary', onclick: ctx.goHome }, 'ホームへ'),
    );
    return;
  }

  const busy = state.loading?.kind === 'resuggest';
  const [a, b] = session.seeds;

  const card = (item) => {
    const t = item.track;
    const fav = ctx.isFavorite(t.trackId);
    const favBtn = h('button', {
      type: 'button',
      class: 'btn fav-btn',
      'aria-pressed': String(fav),
      'aria-label': `${t.title}をお気に入り`,
      onclick: () => ctx.toggleFavorite(t, favBtn),
    }, fav ? '★' : '☆');

    return h(
      'li',
      { class: 'card' },
      h(
        'div',
        { class: 'rec-head' },
        h('div', { class: 'rank', 'aria-hidden': 'true' }, String(item.rank)),
        h(
          'div',
          { class: 'rec-main' },
          h('h3', { class: 'rec-title' }, h('span', { class: 'visually-hidden' }, `${item.rank}位 `), t.title),
          h('div', { class: 'song-sub' }, trackSub(t)),
        ),
        favBtn,
      ),
      h('p', { class: 'reason' }, item.reason),
      h(
        'div',
        { class: 'badges' },
        item.badges.map((b2) => h('span', { class: `badge ${b2.startsWith('情報不足') ? 'badge-warn' : 'badge-accent'}` }, b2)),
        // 配信状況は確認していない。「未確認」であって「配信なし」ではない。
        h('span', { class: 'badge' }, item.karaoke.label),
      ),
      h(
        'dl',
        { class: 'meters' },
        h('div', {}, h('dt', {}, '2曲との共通性の目安'), h('dd', {}, h('span', { class: 'dots', 'aria-hidden': 'true' }, dots(item.matchLevel)), ` ${MATCH_LABELS[item.matchLevel]}`)),
        item.closeness.map((c, i) => h('div', {}, h('dt', {}, `「${session.seeds[i].title}」との近さ`), h('dd', {}, c.label))),
      ),
    );
  };

  const seedChip = (t, i) =>
    h('div', { class: 'seed-chip' }, h('div', { class: 'card-title' }, `参考曲${i + 1}`), h('div', { class: 'song-title' }, t.title), h('div', { class: 'song-sub' }, trackSub(t)));

  const sh = session.shortage;
  const resuggestNotice = state.resuggestNotice;

  mount(
    root,
    h('h2', { id: 'result-heading', class: 'view-heading', tabindex: '-1' }, 'おすすめ曲'),
    state.viewingSaved && h('div', { class: 'notice' }, h('p', {}, `保存した履歴を表示しています（${fmtDateTime(session.createdAt)}）。`)),
    h('div', { class: 'seed-chips' }, seedChip(a, 0), seedChip(b, 1)),
    h(
      'section',
      { class: 'card', 'aria-labelledby': 'summary-heading' },
      h('h3', { id: 'summary-heading', class: 'card-title' }, `2曲の共通点（${session.summary.label}）`),
      h('ul', { class: 'summary-list' }, session.summary.lines.map((l) => h('li', {}, l))),
      h('div', { class: 'badges' }, h('span', { class: 'badge' }, modeName(session.mode)), h('span', { class: 'badge' }, `${session.count}曲`)),
    ),
    sh &&
      h(
        'div',
        { class: 'notice notice-warn' },
        h('p', {}, sh.message),
        h('p', { class: 'small' }, '条件を広げるには:'),
        h('ul', {}, sh.suggestions.map((s) => h('li', {}, s))),
      ),
    session.items.length > 0 && h('ol', { class: 'rec-list', 'aria-label': 'おすすめ曲の一覧' }, session.items.map(card)),
    resuggestNotice &&
      h(
        'div',
        { class: 'notice notice-warn', role: 'alert' },
        h('p', {}, resuggestNotice.message),
        h('p', { class: 'small' }, '条件を広げるには:'),
        h('ul', {}, resuggestNotice.suggestions.map((s) => h('li', {}, s))),
      ),
    state.error && errorNotice(state.error, ctx.resuggest),
    busy
      ? progressCard({ id: 'progress-text', onCancel: ctx.cancel })
      : h(
          'div',
          { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: ctx.resuggest }, '別の候補を表示'),
          h('button', { type: 'button', class: 'btn', onclick: ctx.goHome }, '条件を変更'),
        ),
    h(
      'ul',
      { class: 'muted small' },
      session.notes.map((n) => h('li', {}, n)),
    ),
  );
}
